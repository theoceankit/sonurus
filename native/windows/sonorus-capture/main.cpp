// sonorus-capture.exe — system audio (WASAPI loopback) and the microphone
// for Sonorus on Windows.
//
//   sonorus-capture.exe --list [--input]
//       Active output devices (with --input: input devices) as JSON on stdout:
//       [{"id": "<endpoint id>", "label": "<friendly name>", "default": true|false}, ...]
//
//   sonorus-capture.exe [--input] --device <endpoint id | default> --output <file.wav>
//       Records what the output device plays (with --input: what the input
//       device hears) into a 16-bit PCM WAV at the device's sample rate; an
//       output's channels are folded into stereo at most, an input is mono.
//       Prints READY on stdout once capture runs. Stops on a "stop" line or
//       EOF on stdin (Windows cannot send SIGINT to a child process; EOF also
//       ends the helper when the backend dies).
//
// The track runs in real time: WASAPI delivers no packets while nothing
// plays, so missing time is written as silence (by the packets' timestamps
// and by the clock), and the file is as long as the recording. If an output
// device disappears, a warning goes to stderr and silence is written until
// stop. If an input device disappears, the file is closed and the helper
// exits with code 3: the backend then ends the recording.
// The WAV header is rewritten every second, so the file stays readable even
// if the helper is killed.
//
// Errors before READY: a message on stderr and exit code 2; a microphone the
// user has not allowed desktop apps to use: "ERROR: microphone access denied".
//
//   sonorus-capture.exe --watch-mic
//       Which other apps record from a microphone: one JSON object per line on
//       stdout, the first at start, then one whenever the set changes:
//       {"names": true, "holders": [{"pid": 1234, "app_id": "zoom", "name": "Zoom"}]}
//       A holder is the process of an active audio session on any active input
//       device (the system sounds session and this process left out). app_id
//       is its exe name in lower case without the extension, name the exe's
//       FileDescription (or the exe name). An app hosted in WebView2 is named
//       after the app that hosts it. Session, device and state notifications
//       wake the watch at once; it also looks once a second. Stops on a "stop"
//       line or EOF on stdin, like a recording. Needs no permission: it opens
//       no stream.
// Build: npm run build:capture:win (scripts/build-capture-win.js).

#define WIN32_LEAN_AND_MEAN
#define NOMINMAX
#include <windows.h>
#include <initguid.h>
#include <mmdeviceapi.h>
#include <audioclient.h>
#include <mmreg.h>
#include <audiopolicy.h>
#include <functiondiscoverykeys_devpkey.h>
#include <tlhelp32.h>
#include <winver.h>

#include <algorithm>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cwchar>
#include <cwctype>
#include <map>
#include <set>
#include <string>
#include <utility>
#include <vector>

namespace {

constexpr REFERENCE_TIME kBufferDuration = 2000000;  // 200 ms, in 100 ns units
constexpr DWORD kPollMs = 10;
// Silence is added by the clock only for time older than this: packets arrive
// with some delay, and a packet placed before already written silence would
// have to be dropped.
constexpr double kClockLagSec = 0.15;
constexpr double kHeaderEverySec = 1.0;

template <class T> void release(T*& p) { if (p) { p->Release(); p = nullptr; } }

std::string utf8(const wchar_t* w) {
  if (!w || !*w) return {};
  int n = WideCharToMultiByte(CP_UTF8, 0, w, -1, nullptr, 0, nullptr, nullptr);
  std::string s(n > 0 ? n - 1 : 0, '\0');
  if (n > 1) WideCharToMultiByte(CP_UTF8, 0, w, -1, &s[0], n, nullptr, nullptr);
  return s;
}

std::string json_string(const std::string& s) {
  std::string out = "\"";
  for (unsigned char c : s) {
    if (c == '"' || c == '\\') { out += '\\'; out += static_cast<char>(c); }
    else if (c < 0x20) { char buf[8]; std::snprintf(buf, sizeof buf, "\\u%04x", c); out += buf; }
    else out += static_cast<char>(c);
  }
  return out + "\"";
}

int fail(const char* what, HRESULT hr) {
  std::fprintf(stderr, "ERROR: %s (0x%08lx)\n", what, static_cast<unsigned long>(hr));
  return 2;
}

// ── --list ──────────────────────────────────────────────────────────────────

int list_devices(IMMDeviceEnumerator* enumerator, EDataFlow flow) {
  std::wstring default_id;
  IMMDevice* def = nullptr;
  if (SUCCEEDED(enumerator->GetDefaultAudioEndpoint(flow, eConsole, &def))) {
    LPWSTR id = nullptr;
    if (SUCCEEDED(def->GetId(&id))) { default_id = id; CoTaskMemFree(id); }
    release(def);
  }

  IMMDeviceCollection* devices = nullptr;
  HRESULT hr = enumerator->EnumAudioEndpoints(flow, DEVICE_STATE_ACTIVE, &devices);
  if (FAILED(hr)) return fail(flow == eCapture ? "could not list the input devices"
                                               : "could not list the output devices", hr);
  UINT count = 0;
  devices->GetCount(&count);

  std::string json = "[";
  for (UINT i = 0; i < count; ++i) {
    IMMDevice* device = nullptr;
    if (FAILED(devices->Item(i, &device))) continue;
    LPWSTR id = nullptr;
    if (FAILED(device->GetId(&id))) { release(device); continue; }
    std::wstring label;
    IPropertyStore* props = nullptr;
    if (SUCCEEDED(device->OpenPropertyStore(STGM_READ, &props))) {
      PROPVARIANT name;
      PropVariantInit(&name);
      if (SUCCEEDED(props->GetValue(PKEY_Device_FriendlyName, &name)) && name.vt == VT_LPWSTR)
        label = name.pwszVal;
      PropVariantClear(&name);
      release(props);
    }
    if (json.size() > 1) json += ",";
    json += "{\"id\":" + json_string(utf8(id)) +
            ",\"label\":" + json_string(utf8(label.empty() ? id : label.c_str())) +
            ",\"default\":" + (default_id == id ? "true" : "false") + "}";
    CoTaskMemFree(id);
    release(device);
  }
  release(devices);
  json += "]\n";
  std::fwrite(json.data(), 1, json.size(), stdout);
  std::fflush(stdout);
  return 0;
}

// ── WAV writer ──────────────────────────────────────────────────────────────

class WavWriter {
 public:
  bool open(const wchar_t* path, uint16_t channels, uint32_t rate) {
    channels_ = channels;
    rate_ = rate;
    file_ = _wfopen(path, L"wb");
    if (!file_) return false;
    write_header();
    return true;
  }

  void write(const int16_t* samples, uint64_t frames) {
    std::fwrite(samples, sizeof(int16_t) * channels_, static_cast<size_t>(frames), file_);
    frames_ += frames;
  }

  void write_silence(uint64_t frames) {
    static const int16_t zeros[4096] = {};
    const uint64_t chunk = (sizeof zeros / sizeof zeros[0]) / channels_;
    while (frames) {
      uint64_t n = std::min(frames, chunk);
      write(zeros, n);
      frames -= n;
    }
  }

  void update_header() {
    std::fflush(file_);
    std::fseek(file_, 0, SEEK_SET);
    write_header();
    std::fseek(file_, 0, SEEK_END);
    std::fflush(file_);
  }

  void close() {
    if (!file_) return;
    update_header();
    std::fclose(file_);
    file_ = nullptr;
  }

  uint64_t frames() const { return frames_; }

 private:
  void put32(uint32_t v) { std::fwrite(&v, 4, 1, file_); }
  void put16(uint16_t v) { std::fwrite(&v, 2, 1, file_); }

  void write_header() {
    const uint64_t bytes = frames_ * channels_ * 2;
    const uint32_t data = bytes > 0xFFFFFFFFull - 36 ? 0xFFFFFFFFu - 36 : static_cast<uint32_t>(bytes);
    std::fwrite("RIFF", 1, 4, file_); put32(36 + data);
    std::fwrite("WAVE", 1, 4, file_);
    std::fwrite("fmt ", 1, 4, file_); put32(16);
    put16(1);  // PCM
    put16(channels_);
    put32(rate_);
    put32(rate_ * channels_ * 2);
    put16(static_cast<uint16_t>(channels_ * 2));
    put16(16);
    std::fwrite("data", 1, 4, file_); put32(data);
  }

  FILE* file_ = nullptr;
  uint16_t channels_ = 2;
  uint32_t rate_ = 48000;
  uint64_t frames_ = 0;
};

// ── stop on stdin ───────────────────────────────────────────────────────────

volatile LONG g_stop = 0;
// Wakes the --watch-mic loop; null while recording.
HANDLE g_wake = nullptr;

void wake() { if (g_wake) SetEvent(g_wake); }

DWORD WINAPI watch_stdin(LPVOID) {
  HANDLE in = GetStdHandle(STD_INPUT_HANDLE);
  std::string line;
  char buf[64];
  DWORD n = 0;
  while (ReadFile(in, buf, sizeof buf, &n, nullptr) && n > 0) {
    line.append(buf, n);
    if (line.find("stop") != std::string::npos) break;
    if (line.size() > 256) line.erase(0, line.size() - 8);
  }
  InterlockedExchange(&g_stop, 1);  // "stop", EOF or a broken pipe
  wake();
  return 0;
}

// ── sample conversion ───────────────────────────────────────────────────────

enum class SampleType { Float32, Int16 };

// KSDATAFORMAT_SUBTYPE_IEEE_FLOAT / _PCM (ksmedia.h); spelled out because
// mingw-w64 does not instantiate the ksmedia GUIDs through initguid.h.
constexpr GUID kSubtypeFloat = {0x00000003, 0x0000, 0x0010, {0x80, 0x00, 0x00, 0xaa, 0x00, 0x38, 0x9b, 0x71}};
constexpr GUID kSubtypePcm   = {0x00000001, 0x0000, 0x0010, {0x80, 0x00, 0x00, 0xaa, 0x00, 0x38, 0x9b, 0x71}};

bool sample_type(const WAVEFORMATEX* wfx, SampleType* type) {
  GUID sub = {};
  if (wfx->wFormatTag == WAVE_FORMAT_EXTENSIBLE && wfx->cbSize >= 22)
    sub = reinterpret_cast<const WAVEFORMATEXTENSIBLE*>(wfx)->SubFormat;
  const bool is_float = wfx->wFormatTag == WAVE_FORMAT_IEEE_FLOAT ||
                        IsEqualGUID(sub, kSubtypeFloat);
  const bool is_pcm = wfx->wFormatTag == WAVE_FORMAT_PCM ||
                      IsEqualGUID(sub, kSubtypePcm);
  if (is_float && wfx->wBitsPerSample == 32) { *type = SampleType::Float32; return true; }
  if (is_pcm && wfx->wBitsPerSample == 16) { *type = SampleType::Int16; return true; }
  return false;
}

int16_t to_int16(float v) {
  v = std::max(-1.0f, std::min(1.0f, v)) * 32767.0f;
  return static_cast<int16_t>(std::lround(v));
}

// Device frames → interleaved int16 with out_ch channels (1 or 2). Extra
// device channels go to left (even) and right (odd), averaged.
void convert(const BYTE* data, UINT32 frames, SampleType type, int in_ch, int out_ch,
             std::vector<int16_t>* out) {
  out->resize(static_cast<size_t>(frames) * out_ch);
  for (UINT32 f = 0; f < frames; ++f) {
    float acc[2] = {0, 0};
    int cnt[2] = {0, 0};
    for (int c = 0; c < in_ch; ++c) {
      const size_t i = static_cast<size_t>(f) * in_ch + c;
      float v = type == SampleType::Float32
                    ? reinterpret_cast<const float*>(data)[i]
                    : reinterpret_cast<const int16_t*>(data)[i] / 32768.0f;
      const int side = out_ch == 1 ? 0 : (c % 2);
      acc[side] += v;
      cnt[side] += 1;
    }
    for (int c = 0; c < out_ch; ++c)
      (*out)[static_cast<size_t>(f) * out_ch + c] = to_int16(cnt[c] ? acc[c] / cnt[c] : 0.0f);
  }
}

// ── recording ───────────────────────────────────────────────────────────────

// The microphone switched off for desktop apps in the privacy settings.
int fail_input(const char* what, HRESULT hr) {
  if (hr == E_ACCESSDENIED) {
    std::fputs("ERROR: microphone access denied\n", stderr);
    return 2;
  }
  return fail(what, hr);
}

int record(IMMDeviceEnumerator* enumerator, const wchar_t* device_id, const wchar_t* output, bool input) {
  const EDataFlow flow = input ? eCapture : eRender;
  auto failed = [&](const char* output_what, const char* input_what, HRESULT hr) {
    return input ? fail_input(input_what, hr) : fail(output_what, hr);
  };
  IMMDevice* device = nullptr;
  HRESULT hr = std::wcscmp(device_id, L"default") == 0
                   ? enumerator->GetDefaultAudioEndpoint(flow, eConsole, &device)
                   : enumerator->GetDevice(device_id, &device);
  if (FAILED(hr)) return failed("the output device is not available", "the microphone is not available", hr);

  IAudioClient* client = nullptr;
  hr = device->Activate(__uuidof(IAudioClient), CLSCTX_ALL, nullptr, reinterpret_cast<void**>(&client));
  if (FAILED(hr)) return failed("could not open the output device", "could not open the microphone", hr);

  WAVEFORMATEX* wfx = nullptr;
  hr = client->GetMixFormat(&wfx);
  if (FAILED(hr)) return fail("could not read the device format", hr);
  SampleType type;
  if (!sample_type(wfx, &type)) {
    std::fprintf(stderr, "ERROR: unsupported device format (tag 0x%04x, %u bits)\n",
                 wfx->wFormatTag, wfx->wBitsPerSample);
    return 2;
  }
  const int in_ch = wfx->nChannels;
  // A microphone is one voice: mono.
  const int out_ch = input ? 1 : (in_ch >= 2 ? 2 : 1);
  const uint32_t rate = wfx->nSamplesPerSec;

  hr = client->Initialize(AUDCLNT_SHAREMODE_SHARED, input ? 0 : AUDCLNT_STREAMFLAGS_LOOPBACK,
                          kBufferDuration, 0, wfx, nullptr);
  if (FAILED(hr)) return failed("could not start loopback capture", "could not start the microphone", hr);
  IAudioCaptureClient* capture = nullptr;
  hr = client->GetService(__uuidof(IAudioCaptureClient), reinterpret_cast<void**>(&capture));
  if (FAILED(hr)) return failed("could not start loopback capture", "could not start the microphone", hr);

  WavWriter wav;
  if (!wav.open(output, static_cast<uint16_t>(out_ch), rate)) {
    std::fprintf(stderr, "ERROR: could not create the output file\n");
    return 2;
  }

  LARGE_INTEGER freq, start;
  QueryPerformanceFrequency(&freq);
  hr = client->Start();
  if (FAILED(hr)) return failed("could not start loopback capture", "could not start the microphone", hr);
  QueryPerformanceCounter(&start);
  // Packet timestamps (u64QPCPosition) are in 100 ns units.
  const double start_100ns = static_cast<double>(start.QuadPart) * 1e7 / freq.QuadPart;

  std::fputs("READY\n", stdout);
  std::fflush(stdout);
  HANDLE watcher = CreateThread(nullptr, 0, watch_stdin, nullptr, 0, nullptr);

  auto elapsed_frames = [&]() -> uint64_t {
    LARGE_INTEGER now;
    QueryPerformanceCounter(&now);
    const double sec = static_cast<double>(now.QuadPart - start.QuadPart) / freq.QuadPart;
    return sec > 0 ? static_cast<uint64_t>(sec * rate) : 0;
  };

  const uint64_t tolerance = rate / 100;  // 10 ms of timestamp jitter
  bool device_lost = false;
  std::vector<int16_t> buf;
  uint64_t next_header = static_cast<uint64_t>(kHeaderEverySec * rate);

  auto drain = [&]() {
    while (!device_lost) {
      UINT32 pending = 0;
      HRESULT r = capture->GetNextPacketSize(&pending);
      if (FAILED(r)) { device_lost = true; break; }
      if (pending == 0) break;

      BYTE* data = nullptr;
      UINT32 frames = 0;
      DWORD flags = 0;
      UINT64 qpc = 0;
      r = capture->GetBuffer(&data, &frames, &flags, nullptr, &qpc);
      if (FAILED(r)) { device_lost = true; break; }

      uint64_t skip = 0;
      if (qpc && !(flags & AUDCLNT_BUFFERFLAGS_TIMESTAMP_ERROR)) {
        const double at = (static_cast<double>(qpc) - start_100ns) * rate / 1e7;
        const uint64_t pos = at > 0 ? static_cast<uint64_t>(at) : 0;
        if (pos > wav.frames() + tolerance) wav.write_silence(pos - wav.frames());
        else if (pos + tolerance < wav.frames()) skip = std::min<uint64_t>(wav.frames() - pos, frames);
      }
      if (skip < frames) {
        const UINT32 n = frames - static_cast<UINT32>(skip);
        if (flags & AUDCLNT_BUFFERFLAGS_SILENT) {
          wav.write_silence(n);
        } else {
          convert(data + skip * wfx->nBlockAlign, n, type, in_ch, out_ch, &buf);
          wav.write(buf.data(), n);
        }
      }
      capture->ReleaseBuffer(frames);
    }
    if (device_lost && !input) {
      static bool warned = false;
      if (!warned) {
        std::fputs("WARNING: the output device was lost; recording silence until stop\n", stderr);
        std::fflush(stderr);
        warned = true;
      }
    }
  };

  const uint64_t lag = static_cast<uint64_t>(kClockLagSec * rate);
  while (!InterlockedCompareExchange(&g_stop, 0, 0)) {
    drain();
    // A lost microphone ends the track: what was recorded is kept.
    if (device_lost && input) break;
    const uint64_t now = elapsed_frames();
    const uint64_t safe = device_lost ? now : (now > lag ? now - lag : 0);
    if (wav.frames() < safe) wav.write_silence(safe - wav.frames());
    if (wav.frames() >= next_header) {
      wav.update_header();
      next_header = wav.frames() + static_cast<uint64_t>(kHeaderEverySec * rate);
    }
    Sleep(kPollMs);
  }

  const bool input_lost = device_lost && input;
  if (!input_lost) {
    drain();
    const uint64_t end = elapsed_frames();
    if (wav.frames() < end) wav.write_silence(end - wav.frames());
  }
  wav.close();

  client->Stop();
  release(capture);
  CoTaskMemFree(wfx);
  release(client);
  release(device);
  if (watcher) CloseHandle(watcher);
  if (input_lost) {
    std::fputs("ERROR: the microphone was lost\n", stderr);
    return 3;
  }
  return 0;
}

// ── --watch-mic ─────────────────────────────────────────────────────────────

constexpr DWORD kWatchPollMs = 1000;

volatile LONG g_devices_changed = 0;

// A COM object that only wakes the watch: reference counting and
// QueryInterface for one interface.
template <class I>
class Sink : public I {
 public:
  ULONG STDMETHODCALLTYPE AddRef() override { return static_cast<ULONG>(InterlockedIncrement(&refs_)); }
  ULONG STDMETHODCALLTYPE Release() override {
    const LONG n = InterlockedDecrement(&refs_);
    if (n == 0) delete this;
    return static_cast<ULONG>(n);
  }
  HRESULT STDMETHODCALLTYPE QueryInterface(REFIID riid, void** out) override {
    if (!out) return E_POINTER;
    if (IsEqualIID(riid, __uuidof(IUnknown)) || IsEqualIID(riid, __uuidof(I))) {
      *out = static_cast<I*>(this);
      AddRef();
      return S_OK;
    }
    *out = nullptr;
    return E_NOINTERFACE;
  }

 protected:
  virtual ~Sink() = default;

 private:
  LONG refs_ = 1;
};

class DeviceSink : public Sink<IMMNotificationClient> {
 public:
  HRESULT STDMETHODCALLTYPE OnDeviceStateChanged(LPCWSTR, DWORD) override { return changed(); }
  HRESULT STDMETHODCALLTYPE OnDeviceAdded(LPCWSTR) override { return changed(); }
  HRESULT STDMETHODCALLTYPE OnDeviceRemoved(LPCWSTR) override { return changed(); }
  HRESULT STDMETHODCALLTYPE OnDefaultDeviceChanged(EDataFlow, ERole, LPCWSTR) override { return S_OK; }
  HRESULT STDMETHODCALLTYPE OnPropertyValueChanged(LPCWSTR, const PROPERTYKEY) override { return S_OK; }

 private:
  HRESULT changed() {
    InterlockedExchange(&g_devices_changed, 1);
    wake();
    return S_OK;
  }
};

class SessionCreatedSink : public Sink<IAudioSessionNotification> {
 public:
  HRESULT STDMETHODCALLTYPE OnSessionCreated(IAudioSessionControl*) override { wake(); return S_OK; }
};

class SessionEventsSink : public Sink<IAudioSessionEvents> {
 public:
  HRESULT STDMETHODCALLTYPE OnDisplayNameChanged(LPCWSTR, LPCGUID) override { return S_OK; }
  HRESULT STDMETHODCALLTYPE OnIconPathChanged(LPCWSTR, LPCGUID) override { return S_OK; }
  HRESULT STDMETHODCALLTYPE OnSimpleVolumeChanged(float, BOOL, LPCGUID) override { return S_OK; }
  HRESULT STDMETHODCALLTYPE OnChannelVolumeChanged(DWORD, float[], DWORD, LPCGUID) override { return S_OK; }
  HRESULT STDMETHODCALLTYPE OnGroupingParamChanged(LPCGUID, LPCGUID) override { return S_OK; }
  HRESULT STDMETHODCALLTYPE OnStateChanged(AudioSessionState) override { wake(); return S_OK; }
  HRESULT STDMETHODCALLTYPE OnSessionDisconnected(AudioSessionDisconnectReason) override { wake(); return S_OK; }
};

struct Holder {
  DWORD pid = 0;
  std::string app_id;
  std::string name;
};

std::wstring process_path(DWORD pid) {
  HANDLE process = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, FALSE, pid);
  if (!process) return {};
  wchar_t buf[MAX_PATH * 4];
  DWORD size = sizeof buf / sizeof buf[0];
  std::wstring path;
  if (QueryFullProcessImageNameW(process, 0, buf, &size)) path.assign(buf, size);
  CloseHandle(process);
  return path;
}

// "C:\\Program Files\\Zoom\\bin\\Zoom.exe" → "Zoom"
std::wstring exe_stem(const std::wstring& path) {
  const size_t slash = path.find_last_of(L"\\/");
  std::wstring name = slash == std::wstring::npos ? path : path.substr(slash + 1);
  const size_t dot = name.find_last_of(L'.');
  if (dot != std::wstring::npos && dot > 0) name.erase(dot);
  return name;
}

std::wstring lower(std::wstring s) {
  for (auto& c : s) c = static_cast<wchar_t>(std::towlower(c));
  return s;
}

std::wstring file_description(const std::wstring& path) {
  DWORD ignored = 0;
  const DWORD size = GetFileVersionInfoSizeW(path.c_str(), &ignored);
  if (!size) return {};
  std::vector<BYTE> data(size);
  if (!GetFileVersionInfoW(path.c_str(), 0, size, data.data())) return {};

  struct LangCodePage { WORD lang; WORD codepage; };
  std::vector<std::wstring> keys;
  LangCodePage* pages = nullptr;
  UINT bytes = 0;
  if (VerQueryValueW(data.data(), L"\\VarFileInfo\\Translation", reinterpret_cast<void**>(&pages), &bytes)) {
    for (UINT i = 0; pages && i < bytes / sizeof(LangCodePage); ++i) {
      wchar_t key[64];
      std::swprintf(key, sizeof key / sizeof key[0], L"\\StringFileInfo\\%04x%04x\\FileDescription",
                    pages[i].lang, pages[i].codepage);
      keys.push_back(key);
    }
  }
  keys.push_back(L"\\StringFileInfo\\040904b0\\FileDescription");
  keys.push_back(L"\\StringFileInfo\\040904e4\\FileDescription");
  for (const auto& key : keys) {
    wchar_t* value = nullptr;
    UINT len = 0;
    if (!VerQueryValueW(data.data(), key.c_str(), reinterpret_cast<void**>(&value), &len) || !value || len < 2)
      continue;
    std::wstring text(value);
    const size_t first = text.find_first_not_of(L" \t");
    const size_t last = text.find_last_not_of(L" \t");
    if (first != std::wstring::npos) return text.substr(first, last - first + 1);
  }
  return {};
}

DWORD parent_pid(DWORD pid) {
  HANDLE snapshot = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
  if (snapshot == INVALID_HANDLE_VALUE) return 0;
  PROCESSENTRY32W entry;
  entry.dwSize = sizeof entry;
  DWORD parent = 0;
  for (BOOL ok = Process32FirstW(snapshot, &entry); ok; ok = Process32NextW(snapshot, &entry)) {
    if (entry.th32ProcessID == pid) { parent = entry.th32ParentProcessID; break; }
  }
  CloseHandle(snapshot);
  return parent;
}

// The app a session belongs to; an app built on WebView2 (the new Teams) records
// in an msedgewebview2.exe child, named here after the app that started it.
bool describe(DWORD pid, Holder* holder) {
  std::wstring path = process_path(pid);
  if (path.empty()) return false;
  DWORD host = pid;
  for (int depth = 0; depth < 8 && lower(exe_stem(path)) == L"msedgewebview2"; ++depth) {
    host = parent_pid(host);
    const std::wstring host_path = host ? process_path(host) : std::wstring();
    if (host_path.empty()) break;
    path = host_path;
  }
  const std::wstring stem = exe_stem(path);
  if (stem.empty()) return false;
  const std::wstring description = file_description(path);
  holder->pid = pid;
  holder->app_id = utf8(lower(stem).c_str());
  holder->name = utf8((description.empty() ? stem : description).c_str());
  return true;
}

struct WatchedSession {
  IAudioSessionControl* control = nullptr;
  SessionEventsSink* sink = nullptr;
};

struct WatchedDevice {
  IAudioSessionManager2* manager = nullptr;
  std::map<std::wstring, WatchedSession> sessions;  // by session instance id
};

class MicWatch {
 public:
  explicit MicWatch(IMMDeviceEnumerator* enumerator) : enumerator_(enumerator) {}
  ~MicWatch() {
    close_devices();
    created_->Release();
  }

  void open_devices() {
    close_devices();
    IMMDeviceCollection* collection = nullptr;
    if (FAILED(enumerator_->EnumAudioEndpoints(eCapture, DEVICE_STATE_ACTIVE, &collection))) return;
    UINT count = 0;
    collection->GetCount(&count);
    for (UINT i = 0; i < count; ++i) {
      IMMDevice* device = nullptr;
      if (FAILED(collection->Item(i, &device))) continue;
      IAudioSessionManager2* manager = nullptr;
      if (SUCCEEDED(device->Activate(__uuidof(IAudioSessionManager2), CLSCTX_ALL, nullptr,
                                     reinterpret_cast<void**>(&manager)))) {
        // Session notifications start only once the sessions have been listed.
        IAudioSessionEnumerator* sessions = nullptr;
        if (SUCCEEDED(manager->GetSessionEnumerator(&sessions))) release(sessions);
        manager->RegisterSessionNotification(created_);
        WatchedDevice watched;
        watched.manager = manager;
        devices_.push_back(std::move(watched));
      }
      release(device);
    }
    release(collection);
  }

  std::vector<Holder> scan() {
    std::vector<Holder> holders;
    std::set<DWORD> seen_pids;
    const DWORD self = GetCurrentProcessId();
    for (auto& device : devices_) {
      IAudioSessionEnumerator* sessions = nullptr;
      if (FAILED(device.manager->GetSessionEnumerator(&sessions))) continue;
      int count = 0;
      sessions->GetCount(&count);
      std::set<std::wstring> present;
      for (int i = 0; i < count; ++i) {
        IAudioSessionControl* control = nullptr;
        if (FAILED(sessions->GetSession(i, &control))) continue;
        IAudioSessionControl2* control2 = nullptr;
        if (FAILED(control->QueryInterface(__uuidof(IAudioSessionControl2),
                                           reinterpret_cast<void**>(&control2)))) {
          release(control);
          continue;
        }
        std::wstring key;
        LPWSTR instance = nullptr;
        if (SUCCEEDED(control2->GetSessionInstanceIdentifier(&instance)) && instance) {
          key = instance;
          CoTaskMemFree(instance);
        }
        if (!key.empty()) {
          present.insert(key);
          if (!device.sessions.count(key)) {
            WatchedSession watched;
            watched.sink = new SessionEventsSink;
            if (SUCCEEDED(control->RegisterAudioSessionNotification(watched.sink))) {
              watched.control = control;
              control->AddRef();
              device.sessions[key] = watched;
            } else {
              watched.sink->Release();
            }
          }
        }

        AudioSessionState state = AudioSessionStateInactive;
        DWORD pid = 0;
        if (SUCCEEDED(control->GetState(&state)) && state == AudioSessionStateActive &&
            control2->IsSystemSoundsSession() != S_OK && SUCCEEDED(control2->GetProcessId(&pid)) &&
            pid != 0 && pid != self && !seen_pids.count(pid)) {
          Holder holder;
          if (describe_cached(pid, &holder)) {
            seen_pids.insert(pid);
            holders.push_back(holder);
          }
        }
        release(control2);
        release(control);
      }
      release(sessions);
      for (auto it = device.sessions.begin(); it != device.sessions.end();) {
        if (present.count(it->first)) { ++it; continue; }
        forget(it->second);
        it = device.sessions.erase(it);
      }
    }
    std::sort(holders.begin(), holders.end(), [](const Holder& a, const Holder& b) { return a.pid < b.pid; });
    return holders;
  }

 private:
  bool describe_cached(DWORD pid, Holder* holder) {
    const std::wstring path = process_path(pid);
    if (path.empty()) return false;
    const auto key = std::make_pair(pid, path);
    auto it = names_.find(key);
    if (it != names_.end()) { *holder = it->second; return true; }
    if (!describe(pid, holder)) return false;
    if (names_.size() > 256) names_.clear();
    names_[key] = *holder;
    return true;
  }

  static void forget(WatchedSession& session) {
    session.control->UnregisterAudioSessionNotification(session.sink);
    session.sink->Release();
    release(session.control);
  }

  void close_devices() {
    for (auto& device : devices_) {
      for (auto& entry : device.sessions) forget(entry.second);
      device.manager->UnregisterSessionNotification(created_);
      release(device.manager);
    }
    devices_.clear();
  }

  IMMDeviceEnumerator* enumerator_;
  SessionCreatedSink* created_ = new SessionCreatedSink;
  std::vector<WatchedDevice> devices_;
  std::map<std::pair<DWORD, std::wstring>, Holder> names_;
};

std::string holders_line(const std::vector<Holder>& holders) {
  std::string line = "{\"names\": true, \"holders\": [";
  for (size_t i = 0; i < holders.size(); ++i) {
    if (i) line += ", ";
    line += "{\"pid\": " + std::to_string(holders[i].pid) +
            ", \"app_id\": " + json_string(holders[i].app_id) +
            ", \"name\": " + json_string(holders[i].name) + "}";
  }
  return line + "]}\n";
}

int watch_mic(IMMDeviceEnumerator* enumerator) {
  g_wake = CreateEventW(nullptr, FALSE, FALSE, nullptr);
  if (!g_wake) return fail("could not create an event", HRESULT_FROM_WIN32(GetLastError()));
  DeviceSink* devices = new DeviceSink;
  const bool device_events = SUCCEEDED(enumerator->RegisterEndpointNotificationCallback(devices));
  HANDLE watcher = CreateThread(nullptr, 0, watch_stdin, nullptr, 0, nullptr);
  {
    MicWatch watch(enumerator);
    watch.open_devices();
    std::string last;
    while (!InterlockedCompareExchange(&g_stop, 0, 0)) {
      if (InterlockedExchange(&g_devices_changed, 0)) watch.open_devices();
      const std::string line = holders_line(watch.scan());
      if (line != last) {
        std::fwrite(line.data(), 1, line.size(), stdout);
        if (std::fflush(stdout) != 0) break;  // nobody reads any more
        last = line;
      }
      WaitForSingleObject(g_wake, kWatchPollMs);
    }
  }
  if (device_events) enumerator->UnregisterEndpointNotificationCallback(devices);
  devices->Release();
  if (watcher) CloseHandle(watcher);
  CloseHandle(g_wake);
  g_wake = nullptr;
  return 0;
}

int usage() {
  std::fputs("usage: sonorus-capture.exe --list [--input]\n"
             "       sonorus-capture.exe [--input] --device <id|default> --output <file.wav>\n"
             "       sonorus-capture.exe --watch-mic\n", stderr);
  return 2;
}

}  // namespace

int wmain(int argc, wchar_t** argv) {
  bool list = false;
  bool input = false;
  bool watch = false;
  const wchar_t* device = L"default";
  const wchar_t* output = nullptr;
  for (int i = 1; i < argc; ++i) {
    if (std::wcscmp(argv[i], L"--list") == 0) list = true;
    else if (std::wcscmp(argv[i], L"--watch-mic") == 0) watch = true;
    else if (std::wcscmp(argv[i], L"--input") == 0) input = true;
    else if (std::wcscmp(argv[i], L"--device") == 0 && i + 1 < argc) device = argv[++i];
    else if (std::wcscmp(argv[i], L"--output") == 0 && i + 1 < argc) output = argv[++i];
    else return usage();
  }
  if (!list && !watch && !output) return usage();

  HRESULT hr = CoInitializeEx(nullptr, COINIT_MULTITHREADED);
  if (FAILED(hr)) return fail("could not initialise COM", hr);
  IMMDeviceEnumerator* enumerator = nullptr;
  hr = CoCreateInstance(__uuidof(MMDeviceEnumerator), nullptr, CLSCTX_ALL,
                        __uuidof(IMMDeviceEnumerator), reinterpret_cast<void**>(&enumerator));
  if (FAILED(hr)) return fail("could not open the audio device list", hr);

  const int code = watch ? watch_mic(enumerator)
                 : list ? list_devices(enumerator, input ? eCapture : eRender)
                        : record(enumerator, device, output, input);
  release(enumerator);
  CoUninitialize();
  return code;
}
