// sonorus-capture.exe — system audio for Sonorus on Windows (WASAPI loopback).
//
//   sonorus-capture.exe --list
//       Active output devices as JSON on stdout:
//       [{"id": "<endpoint id>", "label": "<friendly name>", "default": true|false}, ...]
//
//   sonorus-capture.exe --device <endpoint id | default> --output <file.wav>
//       Records what the device plays into a 16-bit PCM WAV (the device's
//       sample rate; more than two channels are folded into stereo).
//       Prints READY on stdout once capture runs. Stops on a "stop" line or
//       EOF on stdin (Windows cannot send SIGINT to a child process; EOF also
//       ends the helper when the backend dies).
//
// The track runs in real time: WASAPI delivers no packets while nothing
// plays, so missing time is written as silence (by the packets' timestamps
// and by the clock), and the file is as long as the recording. If the device
// disappears, a warning goes to stderr and silence is written until stop.
// The WAV header is rewritten every second, so the file stays readable even
// if the helper is killed.
//
// Errors before READY: a message on stderr and exit code 2.
// Build: npm run build:capture:win (scripts/build-capture-win.js).

#define WIN32_LEAN_AND_MEAN
#define NOMINMAX
#include <windows.h>
#include <initguid.h>
#include <mmdeviceapi.h>
#include <audioclient.h>
#include <mmreg.h>
#include <functiondiscoverykeys_devpkey.h>

#include <algorithm>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cwchar>
#include <string>
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

int list_devices(IMMDeviceEnumerator* enumerator) {
  std::wstring default_id;
  IMMDevice* def = nullptr;
  if (SUCCEEDED(enumerator->GetDefaultAudioEndpoint(eRender, eConsole, &def))) {
    LPWSTR id = nullptr;
    if (SUCCEEDED(def->GetId(&id))) { default_id = id; CoTaskMemFree(id); }
    release(def);
  }

  IMMDeviceCollection* devices = nullptr;
  HRESULT hr = enumerator->EnumAudioEndpoints(eRender, DEVICE_STATE_ACTIVE, &devices);
  if (FAILED(hr)) return fail("could not list the output devices", hr);
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

int record(IMMDeviceEnumerator* enumerator, const wchar_t* device_id, const wchar_t* output) {
  IMMDevice* device = nullptr;
  HRESULT hr = std::wcscmp(device_id, L"default") == 0
                   ? enumerator->GetDefaultAudioEndpoint(eRender, eConsole, &device)
                   : enumerator->GetDevice(device_id, &device);
  if (FAILED(hr)) return fail("the output device is not available", hr);

  IAudioClient* client = nullptr;
  hr = device->Activate(__uuidof(IAudioClient), CLSCTX_ALL, nullptr, reinterpret_cast<void**>(&client));
  if (FAILED(hr)) return fail("could not open the output device", hr);

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
  const int out_ch = in_ch >= 2 ? 2 : 1;
  const uint32_t rate = wfx->nSamplesPerSec;

  hr = client->Initialize(AUDCLNT_SHAREMODE_SHARED, AUDCLNT_STREAMFLAGS_LOOPBACK,
                          kBufferDuration, 0, wfx, nullptr);
  if (FAILED(hr)) return fail("could not start loopback capture", hr);
  IAudioCaptureClient* capture = nullptr;
  hr = client->GetService(__uuidof(IAudioCaptureClient), reinterpret_cast<void**>(&capture));
  if (FAILED(hr)) return fail("could not start loopback capture", hr);

  WavWriter wav;
  if (!wav.open(output, static_cast<uint16_t>(out_ch), rate)) {
    std::fprintf(stderr, "ERROR: could not create the output file\n");
    return 2;
  }

  LARGE_INTEGER freq, start;
  QueryPerformanceFrequency(&freq);
  hr = client->Start();
  if (FAILED(hr)) return fail("could not start loopback capture", hr);
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
    if (device_lost) {
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
    const uint64_t now = elapsed_frames();
    const uint64_t safe = device_lost ? now : (now > lag ? now - lag : 0);
    if (wav.frames() < safe) wav.write_silence(safe - wav.frames());
    if (wav.frames() >= next_header) {
      wav.update_header();
      next_header = wav.frames() + static_cast<uint64_t>(kHeaderEverySec * rate);
    }
    Sleep(kPollMs);
  }

  drain();
  const uint64_t end = elapsed_frames();
  if (wav.frames() < end) wav.write_silence(end - wav.frames());
  wav.close();

  client->Stop();
  release(capture);
  CoTaskMemFree(wfx);
  release(client);
  release(device);
  if (watcher) CloseHandle(watcher);
  return 0;
}

int usage() {
  std::fputs("usage: sonorus-capture.exe --list\n"
             "       sonorus-capture.exe --device <id|default> --output <file.wav>\n", stderr);
  return 2;
}

}  // namespace

int wmain(int argc, wchar_t** argv) {
  bool list = false;
  const wchar_t* device = L"default";
  const wchar_t* output = nullptr;
  for (int i = 1; i < argc; ++i) {
    if (std::wcscmp(argv[i], L"--list") == 0) list = true;
    else if (std::wcscmp(argv[i], L"--device") == 0 && i + 1 < argc) device = argv[++i];
    else if (std::wcscmp(argv[i], L"--output") == 0 && i + 1 < argc) output = argv[++i];
    else return usage();
  }
  if (!list && !output) return usage();

  HRESULT hr = CoInitializeEx(nullptr, COINIT_MULTITHREADED);
  if (FAILED(hr)) return fail("could not initialise COM", hr);
  IMMDeviceEnumerator* enumerator = nullptr;
  hr = CoCreateInstance(__uuidof(MMDeviceEnumerator), nullptr, CLSCTX_ALL,
                        __uuidof(IMMDeviceEnumerator), reinterpret_cast<void**>(&enumerator));
  if (FAILED(hr)) return fail("could not open the audio device list", hr);

  const int code = list ? list_devices(enumerator) : record(enumerator, device, output);
  release(enumerator);
  CoUninitialize();
  return code;
}
