// sonorus-capture — system audio (a Core Audio tap) and the microphone
// (AVCaptureSession) for Sonorus on macOS 14.2 and newer.
//
//   sonorus-capture --output <file.wav>
//       Records system audio: a Core Audio tap of every process, WAV 16-bit in
//       the tap's rate and channels. Prints READY once capture runs; stops on
//       SIGINT. Under the System Audio Recording permission of the app that
//       started the backend (NSAudioCaptureUsageDescription in its Info.plist):
//       the system asks at the first start; refused, the tap gives zeros and
//       no error, so a recording without one sound ends with a WARNING on
//       stderr. When the output device changes the tap is built again, and the
//       time that took is written as silence, so the track keeps its length
//       against the microphone. A tap that cannot be built again closes the
//       file: "ERROR: system audio was lost", exit 3. One that cannot start:
//       "ERROR: …", exit 2, before READY.
//   sonorus-capture --list-inputs
//       Microphones as JSON on stdout:
//       [{"id": "<uniqueID>", "label": "<name>", "default": true|false}, ...]
//   sonorus-capture --input <uniqueID | default> --output <file.wav>
//       Records the microphone, mono 16-bit PCM at 48 kHz. Asks for microphone
//       access first (the system shows the prompt for the app that started the
//       backend); refused: "ERROR: microphone access denied", exit 2. Prints
//       READY once capture runs; stops on SIGINT. A microphone lost while
//       recording closes the file: "ERROR: the microphone was lost", exit 3.
//   sonorus-capture --watch-mic
//       Which processes use a microphone, read from CoreAudio (no permission
//       needed). One JSON object per line on stdout, the first at start, then
//       one at every change, each the whole current state:
//       {"holders":[{"app_id":"us.zoom.xos","name":"zoom.us","pid":1234}],"names":true}
//       macOS 14.2 and newer name the app of each process (app_id = bundle id
//       of the outermost .app, name = its display name; outside an app both
//       come from the executable). Before 14.2 only "some process uses an
//       input device" is known: one holder {"app_id": "microphone", "name": null,
//       "pid": null}, "names": false.
//       Stops on "stop" on stdin or at EOF.
//
// Build: npm run build:capture.

import AVFoundation
import CoreAudio
import Darwin
import Foundation

// ─── CMSampleBuffer → AVAudioPCMBuffer ────────────────────────────────────────

extension CMSampleBuffer {
    // Copies the samples into a buffer of the given format;
    // CMSampleBufferCopyPCMDataIntoAudioBufferList also reads buffers that carry
    // no per-sample sizes, which CMSampleBufferGetAudioBufferListWithRetainedBlockBuffer
    // refuses (kCMSampleBufferError_BufferHasNoSampleSizes, -12737).
    func toPCMBuffer(format: AVAudioFormat) -> AVAudioPCMBuffer? {
        let numFrames = Int32(numSamples)
        guard numFrames > 0 else { return nil }
        guard let pcm = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: AVAudioFrameCount(numFrames))
        else { return nil }
        pcm.frameLength = AVAudioFrameCount(numFrames)

        let status = CMSampleBufferCopyPCMDataIntoAudioBufferList(
            self, at: 0, frameCount: numFrames, into: pcm.mutableAudioBufferList
        )
        guard status == noErr else {
            fputs("ERROR: CMSampleBufferCopyPCMDataIntoAudioBufferList status=\(status)\n", stderr)
            return nil
        }
        return pcm
    }
}

// ─── System audio: Core Audio tap ─────────────────────────────────────────────

struct CaptureError: Error, CustomStringConvertible {
    let description: String
}

// A gap between two buffers longer than this is written as silence. Buffers
// follow each other within a fraction of a millisecond; a gap is a tap built
// again or a device that stalled.
let gapNanos: UInt64 = 10_000_000
// A gap longer than this is a clock that jumped, not lost audio.
let maxGapNanos: UInt64 = 600_000_000_000

// A tap of every process, read through a private aggregate device that holds
// nothing but the tap. The file keeps the format of the first tap; a tap built
// again in another format (the output device changed) is converted to it.
//
// Two serial queues: `control` builds and takes apart the tap (start, stop and
// the output device listener), `io` runs the IOProc and owns what it writes
// with. The IOProc is never blocked by a build, so AudioDeviceStop, which waits
// for a running IOProc, does not wait on the queue that called it.
@available(macOS 14.2, *)
final class TapCapture {
    private let url: URL
    private let control = DispatchQueue(label: "sonorus-capture.tap.control")
    private let io = DispatchQueue(label: "sonorus-capture.tap.io")

    // control
    private var tapID = AudioObjectID(kAudioObjectUnknown)
    private var deviceID = AudioObjectID(kAudioObjectUnknown)
    private var procID: AudioDeviceIOProcID?
    private var listener: AudioObjectPropertyListenerBlock?
    private var stopped = false
    private var lost = false

    // io
    private var file: AVAudioFile?
    private var tapFormat: AVAudioFormat?
    private var converter: AVAudioConverter?
    private var heardSound = false
    // Host time (ns) where the last buffer ended; nil before the first.
    private var expectedNanos: UInt64?
    private var filledNanos: UInt64 = 0

    init(url: URL) { self.url = url }

    var wasLost: Bool { control.sync { lost } }
    var heard: Bool { io.sync { heardSound } }
    // How much silence stood in for gaps, in seconds.
    var filledSeconds: Double { io.sync { Double(filledNanos) / 1e9 } }

    func start() throws {
        try control.sync {
            try build()
            var address = propertyAddress(kAudioHardwarePropertyDefaultOutputDevice)
            let block: AudioObjectPropertyListenerBlock = { [weak self] _, _ in self?.rebuild() }
            if AudioObjectAddPropertyListenerBlock(systemObject, &address, control, block) == noErr {
                listener = block
            } else {
                fputs("WARNING: output device changes will not be followed\n", stderr)
            }
        }
    }

    func stop() {
        control.sync {
            stopped = true
            if let listener {
                var address = propertyAddress(kAudioHardwarePropertyDefaultOutputDevice)
                AudioObjectRemovePropertyListenerBlock(systemObject, &address, control, listener)
                self.listener = nil
            }
            teardown()
        }
        io.sync { file = nil }
    }

    private func check(_ status: OSStatus, _ what: String) throws {
        guard status == noErr else {
            throw CaptureError(description: "could not \(what) (status \(status))")
        }
    }

    // On control.
    private func build() throws {
        let description = CATapDescription(stereoGlobalTapButExcludeProcesses: [])
        description.uuid = UUID()
        description.name = "Sonorus system audio"
        description.isPrivate = true
        description.muteBehavior = .unmuted
        var tap = AudioObjectID(kAudioObjectUnknown)
        try check(AudioHardwareCreateProcessTap(description, &tap), "create the audio tap")
        tapID = tap

        var address = propertyAddress(kAudioTapPropertyFormat)
        var asbd = AudioStreamBasicDescription()
        var size = UInt32(MemoryLayout<AudioStreamBasicDescription>.size)
        try check(AudioObjectGetPropertyData(tapID, &address, 0, nil, &size, &asbd), "read the tap format")
        guard let format = AVAudioFormat(streamDescription: &asbd) else {
            throw CaptureError(description: "the tap has no usable format")
        }

        // The IOProc is not running: nothing writes while the format changes.
        try io.sync {
            if file == nil {
                guard let int16Fmt = AVAudioFormat(
                    commonFormat: .pcmFormatInt16, sampleRate: format.sampleRate,
                    channels: format.channelCount, interleaved: true
                ) else {
                    throw CaptureError(description: "could not construct the output format")
                }
                file = try AVAudioFile(forWriting: url, settings: int16Fmt.settings,
                                       commonFormat: .pcmFormatFloat32, interleaved: format.isInterleaved)
            }
            guard let file else { return }
            if format != file.processingFormat {
                guard let made = AVAudioConverter(from: format, to: file.processingFormat) else {
                    throw CaptureError(description: "could not convert the tap format")
                }
                converter = made
            } else {
                converter = nil
            }
            tapFormat = format
        }

        let aggregate: [String: Any] = [
            kAudioAggregateDeviceNameKey: "Sonorus system audio",
            kAudioAggregateDeviceUIDKey: UUID().uuidString,
            kAudioAggregateDeviceIsPrivateKey: true,
            kAudioAggregateDeviceIsStackedKey: false,
            kAudioAggregateDeviceTapAutoStartKey: true,
            // No physical device: a headset would bring its input streams along.
            kAudioAggregateDeviceSubDeviceListKey: [[String: Any]](),
            kAudioAggregateDeviceTapListKey: [
                [kAudioSubTapUIDKey: description.uuid.uuidString, kAudioSubTapDriftCompensationKey: true],
            ],
        ]
        var device = AudioObjectID(kAudioObjectUnknown)
        try check(AudioHardwareCreateAggregateDevice(aggregate as CFDictionary, &device),
                  "create the capture device")
        deviceID = device

        var proc: AudioDeviceIOProcID?
        try check(AudioDeviceCreateIOProcIDWithBlock(&proc, deviceID, io) { [weak self] _, input, inputTime, _, _ in
            self?.write(input, at: inputTime)
        }, "read the capture device")
        procID = proc
        // The system asks for System Audio Recording here, the first time.
        try check(AudioDeviceStart(deviceID, procID), "start the capture device")
    }

    // On control.
    private func teardown() {
        if deviceID != kAudioObjectUnknown {
            if let procID {
                AudioDeviceStop(deviceID, procID)
                AudioDeviceDestroyIOProcID(deviceID, procID)
            }
            AudioHardwareDestroyAggregateDevice(deviceID)
        }
        if tapID != kAudioObjectUnknown { AudioHardwareDestroyProcessTap(tapID) }
        procID = nil
        deviceID = AudioObjectID(kAudioObjectUnknown)
        tapID = AudioObjectID(kAudioObjectUnknown)
    }

    // On control: the default output device changed.
    private func rebuild() {
        guard !stopped, !lost else { return }
        teardown()
        do {
            try build()
        } catch {
            fputs("ERROR: \(error)\n", stderr)
            teardown()
            lost = true
            keepRunning = false
        }
    }

    // On io, for every buffer of the capture device.
    private func write(_ input: UnsafePointer<AudioBufferList>, at inputTime: UnsafePointer<AudioTimeStamp>) {
        guard let file, let tapFormat,
              let buffer = AVAudioPCMBuffer(pcmFormat: tapFormat, bufferListNoCopy: input, deallocator: nil),
              buffer.frameLength > 0
        else { return }
        if !heardSound { heardSound = hasSound(input) }
        let stamp = inputTime.pointee
        if stamp.mFlags.contains(.hostTimeValid) {
            let start = AudioConvertHostTimeToNanos(stamp.mHostTime)
            if let expected = expectedNanos, start > expected + gapNanos, start - expected < maxGapNanos {
                writeSilence(nanos: start - expected, to: file)
            }
            expectedNanos = start + UInt64(Double(buffer.frameLength) / tapFormat.sampleRate * 1e9)
        }
        do {
            guard let converter else {
                try file.write(from: buffer)
                return
            }
            let ratio = file.processingFormat.sampleRate / tapFormat.sampleRate
            let capacity = AVAudioFrameCount(Double(buffer.frameLength) * ratio) + 64
            guard let converted = AVAudioPCMBuffer(pcmFormat: file.processingFormat, frameCapacity: capacity)
            else { return }
            var fed = false
            var failure: NSError?
            converter.convert(to: converted, error: &failure) { _, status in
                if fed {
                    status.pointee = .noDataNow
                    return nil
                }
                fed = true
                status.pointee = .haveData
                return buffer
            }
            if let failure { throw failure }
            if converted.frameLength > 0 { try file.write(from: converted) }
        } catch {
            fputs("ERROR: write failed: \(error)\n", stderr)
        }
    }

    // On io: zeros in the file's format for a gap, so the track keeps its
    // length against the microphone.
    private func writeSilence(nanos: UInt64, to file: AVAudioFile) {
        let format = file.processingFormat
        var frames = AVAudioFrameCount(Double(nanos) / 1e9 * format.sampleRate)
        let chunk: AVAudioFrameCount = 4800
        guard frames > 0, let zeros = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: chunk) else { return }
        // The byte sizes of the buffer list follow frameLength.
        zeros.frameLength = chunk
        for buffer in UnsafeMutableAudioBufferListPointer(zeros.mutableAudioBufferList) {
            if let data = buffer.mData { memset(data, 0, Int(buffer.mDataByteSize)) }
        }
        filledNanos += nanos
        do {
            while frames > 0 {
                zeros.frameLength = min(frames, chunk)
                try file.write(from: zeros)
                frames -= zeros.frameLength
            }
        } catch {
            fputs("ERROR: write failed: \(error)\n", stderr)
        }
    }

    private func hasSound(_ input: UnsafePointer<AudioBufferList>) -> Bool {
        for buffer in UnsafeMutableAudioBufferListPointer(UnsafeMutablePointer(mutating: input)) {
            guard let data = buffer.mData else { continue }
            let bytes = UnsafeRawBufferPointer(start: data, count: Int(buffer.mDataByteSize))
            if bytes.contains(where: { $0 != 0 }) { return true }
        }
        return false
    }
}

@available(macOS 14.2, *)
func recordSystemAudio(outputPath: String) -> Int32 {
    let capture = TapCapture(url: URL(fileURLWithPath: outputPath))
    do {
        try capture.start()
    } catch {
        fputs("ERROR: \(error)\n", stderr)
        capture.stop()
        return 2
    }
    print("READY")
    fflush(stdout)
    while keepRunning { Thread.sleep(forTimeInterval: 0.1) }
    let lost = capture.wasLost
    let heard = capture.heard
    let filled = capture.filledSeconds
    capture.stop()
    if filled > 0 {
        fputs(String(format: "INFO: %.2f s of gaps written as silence\n", filled), stderr)
    }
    if lost {
        fputs("ERROR: system audio was lost\n", stderr)
        return 3
    }
    if !heard {
        fputs("WARNING: only silence was captured; if something played, allow System Audio Recording " +
              "in System Settings → Privacy & Security → Screen & System Audio Recording\n", stderr)
    }
    return 0
}

// ─── Microphone writer ────────────────────────────────────────────────────────

// The capture output is asked for mono 32-bit float at 48 kHz, the processing
// format of a mono AVAudioFile, so buffers are written without conversion.
let micRate = 48000.0

final class MicWriter: NSObject, AVCaptureAudioDataOutputSampleBufferDelegate {
    private var file: AVAudioFile?

    init(url: URL) throws {
        guard let int16Fmt = AVAudioFormat(
            commonFormat: .pcmFormatInt16, sampleRate: micRate, channels: 1, interleaved: true
        ) else {
            throw NSError(domain: "sonorus-capture", code: 1,
                          userInfo: [NSLocalizedDescriptionKey: "could not construct the output format"])
        }
        file = try AVAudioFile(forWriting: url, settings: int16Fmt.settings,
                               commonFormat: .pcmFormatFloat32, interleaved: false)
    }

    func captureOutput(
        _ output: AVCaptureOutput,
        didOutput buffer: CMSampleBuffer,
        from connection: AVCaptureConnection
    ) {
        guard let file, let pcm = buffer.toPCMBuffer(format: file.processingFormat) else { return }
        do {
            try file.write(from: pcm)
        } catch {
            fputs("ERROR: write failed: \(error)\n", stderr)
        }
    }

    func close() { file = nil }
}

// ─── Microphones ──────────────────────────────────────────────────────────────

func microphones() -> [AVCaptureDevice] {
    let types: [AVCaptureDevice.DeviceType]
    if #available(macOS 14.0, *) {
        types = [.microphone, .external]
    } else {
        types = [.builtInMicrophone, .externalUnknown]
    }
    return AVCaptureDevice.DiscoverySession(
        deviceTypes: types, mediaType: .audio, position: .unspecified
    ).devices
}

func jsonString(_ s: String) -> String {
    let data = (try? JSONSerialization.data(withJSONObject: [s])) ?? Data("[\"\"]".utf8)
    let array = String(decoding: data, as: UTF8.self)
    return String(array.dropFirst().dropLast())
}

func listInputs() -> Int32 {
    let defaultID = AVCaptureDevice.default(for: .audio)?.uniqueID
    let items = microphones().map { device in
        "{\"id\":\(jsonString(device.uniqueID)),\"label\":\(jsonString(device.localizedName))," +
        "\"default\":\(device.uniqueID == defaultID ? "true" : "false")}"
    }
    print("[" + items.joined(separator: ",") + "]")
    fflush(stdout)
    return 0
}

// Waits for the user's answer the first time; the backend allows it time.
func microphoneAllowed() -> Bool {
    switch AVCaptureDevice.authorizationStatus(for: .audio) {
    case .authorized:
        return true
    case .notDetermined:
        let answered = DispatchSemaphore(value: 0)
        var granted = false
        AVCaptureDevice.requestAccess(for: .audio) { ok in
            granted = ok
            answered.signal()
        }
        answered.wait()
        return granted
    default:
        return false
    }
}

var keepRunning = true
var microphoneLost = false

func recordMicrophone(id: String, outputPath: String) -> Int32 {
    guard microphoneAllowed() else {
        fputs("ERROR: microphone access denied\n", stderr)
        return 2
    }
    let device = id == "default" ? AVCaptureDevice.default(for: .audio) : AVCaptureDevice(uniqueID: id)
    guard let device else {
        fputs("ERROR: the microphone is not available\n", stderr)
        return 2
    }
    let writer: MicWriter
    let input: AVCaptureDeviceInput
    do {
        writer = try MicWriter(url: URL(fileURLWithPath: outputPath))
        input = try AVCaptureDeviceInput(device: device)
    } catch {
        fputs("ERROR: could not open the microphone: \(error)\n", stderr)
        return 2
    }
    let session = AVCaptureSession()
    let output = AVCaptureAudioDataOutput()
    output.audioSettings = [
        AVFormatIDKey: kAudioFormatLinearPCM,
        AVSampleRateKey: micRate,
        AVNumberOfChannelsKey: 1,
        AVLinearPCMBitDepthKey: 32,
        AVLinearPCMIsFloatKey: true,
        AVLinearPCMIsNonInterleaved: true,
    ]
    let queue = DispatchQueue(label: "sonorus-capture.microphone")
    output.setSampleBufferDelegate(writer, queue: queue)
    guard session.canAddInput(input), session.canAddOutput(output) else {
        fputs("ERROR: could not open the microphone\n", stderr)
        return 2
    }
    session.addInput(input)
    session.addOutput(output)

    let center = NotificationCenter.default
    let lost: (Notification) -> Void = { _ in
        microphoneLost = true
        keepRunning = false
    }
    let observers = [
        center.addObserver(forName: .AVCaptureDeviceWasDisconnected, object: device, queue: nil, using: lost),
        center.addObserver(forName: .AVCaptureSessionRuntimeError, object: session, queue: nil, using: lost),
    ]

    session.startRunning()
    print("READY")
    fflush(stdout)
    while keepRunning {
        RunLoop.current.run(until: Date(timeIntervalSinceNow: 0.1))
    }
    session.stopRunning()
    // The last buffers are written on the delegate queue.
    queue.sync {}
    writer.close()
    for observer in observers { center.removeObserver(observer) }
    if microphoneLost {
        fputs("ERROR: the microphone was lost\n", stderr)
        return 3
    }
    return 0
}

// ─── Microphone watch ─────────────────────────────────────────────────────────

let systemObject = AudioObjectID(kAudioObjectSystemObject)
let watchQueue = DispatchQueue(label: "sonorus-capture.watch-mic")
var watchedProperties = Set<String>()
var lastWatchLine = ""

func propertyAddress(
    _ selector: AudioObjectPropertySelector, scope: AudioObjectPropertyScope = kAudioObjectPropertyScopeGlobal
) -> AudioObjectPropertyAddress {
    // Element 0 is the main element (kAudioObjectPropertyElementMain).
    AudioObjectPropertyAddress(mSelector: selector, mScope: scope, mElement: 0)
}

func audioObjects(
    _ object: AudioObjectID, _ selector: AudioObjectPropertySelector,
    scope: AudioObjectPropertyScope = kAudioObjectPropertyScopeGlobal
) -> [AudioObjectID] {
    var address = propertyAddress(selector, scope: scope)
    var size: UInt32 = 0
    guard AudioObjectGetPropertyDataSize(object, &address, 0, nil, &size) == noErr, size > 0 else { return [] }
    var ids = [AudioObjectID](repeating: 0, count: Int(size) / MemoryLayout<AudioObjectID>.size)
    guard AudioObjectGetPropertyData(object, &address, 0, nil, &size, &ids) == noErr else { return [] }
    return ids
}

func uint32Property(_ object: AudioObjectID, _ selector: AudioObjectPropertySelector) -> UInt32? {
    var address = propertyAddress(selector)
    var value: UInt32 = 0
    var size = UInt32(MemoryLayout<UInt32>.size)
    return AudioObjectGetPropertyData(object, &address, 0, nil, &size, &value) == noErr ? value : nil
}

func pidProperty(_ object: AudioObjectID, _ selector: AudioObjectPropertySelector) -> pid_t? {
    var address = propertyAddress(selector)
    var value: pid_t = 0
    var size = UInt32(MemoryLayout<pid_t>.size)
    return AudioObjectGetPropertyData(object, &address, 0, nil, &size, &value) == noErr ? value : nil
}

func stringProperty(_ object: AudioObjectID, _ selector: AudioObjectPropertySelector) -> String? {
    var address = propertyAddress(selector)
    var value: Unmanaged<CFString>? = nil
    var size = UInt32(MemoryLayout<Unmanaged<CFString>?>.size)
    guard AudioObjectGetPropertyData(object, &address, 0, nil, &size, &value) == noErr,
          let value else { return nil }
    let string = value.takeRetainedValue() as String
    return string.isEmpty ? nil : string
}

// A listener per object and property, once; it runs on watchQueue.
func listen(_ object: AudioObjectID, _ selector: AudioObjectPropertySelector) {
    let key = "\(object):\(selector)"
    guard !watchedProperties.contains(key) else { return }
    watchedProperties.insert(key)
    var address = propertyAddress(selector)
    AudioObjectAddPropertyListenerBlock(object, &address, watchQueue) { _, _ in reportMicHolders() }
}

func executablePath(_ pid: pid_t) -> String? {
    var buffer = [CChar](repeating: 0, count: Int(MAXPATHLEN) * 4)  // PROC_PIDPATHINFO_MAXSIZE
    guard proc_pidpath(pid, &buffer, UInt32(buffer.count)) > 0 else { return nil }
    return String(cString: buffer)
}

// The app a process belongs to: the outermost .app on its path, so the audio
// helper of a browser counts as the browser.
func outerAppPath(_ path: String) -> String? {
    var parts: [Substring] = []
    for part in path.split(separator: "/") {
        parts.append(part)
        if part.hasSuffix(".app") { return "/" + parts.joined(separator: "/") }
    }
    return nil
}

func appName(_ bundle: Bundle, path: String) -> String {
    if let name = (bundle.localizedInfoDictionary?["CFBundleDisplayName"]
                   ?? bundle.infoDictionary?["CFBundleDisplayName"]) as? String, !name.isEmpty {
        return name
    }
    let shown = FileManager.default.displayName(atPath: path)
    return shown.hasSuffix(".app") ? String(shown.dropLast(4)) : shown
}

func holder(pid: pid_t, bundleID: String?) -> [String: Any] {
    var appID = bundleID
    var name: String? = nil
    if let path = executablePath(pid) {
        if let app = outerAppPath(path), let bundle = Bundle(path: app) {
            appID = bundle.bundleIdentifier ?? appID
            name = appName(bundle, path: app)
        } else {
            name = (path as NSString).lastPathComponent
            appID = appID ?? name
        }
    }
    // A holder needs an app_id; a process whose path cannot be read goes by its pid.
    return ["pid": Int(pid), "app_id": appID ?? "pid \(pid)", "name": name.map { $0 as Any } ?? NSNull()]
}

// macOS 14.2 and newer: the processes CoreAudio says use input.
@available(macOS 14.2, *)
func processHolders() -> [[String: Any]] {
    listen(systemObject, kAudioHardwarePropertyProcessObjectList)
    var holders: [[String: Any]] = []
    for process in audioObjects(systemObject, kAudioHardwarePropertyProcessObjectList) {
        listen(process, kAudioProcessPropertyIsRunningInput)
        guard (uint32Property(process, kAudioProcessPropertyIsRunningInput) ?? 0) != 0,
              let pid = pidProperty(process, kAudioProcessPropertyPID), pid > 0, pid != getpid()
        else { continue }
        holders.append(holder(pid: pid, bundleID: stringProperty(process, kAudioProcessPropertyBundleID)))
    }
    return holders.sorted { ($0["pid"] as? Int ?? 0) < ($1["pid"] as? Int ?? 0) }
}

// Before 14.2: only whether some process runs an input device. A device that
// also plays (some headsets) counts while it plays.
func deviceHolders() -> [[String: Any]] {
    listen(systemObject, kAudioHardwarePropertyDevices)
    var running = false
    for device in audioObjects(systemObject, kAudioHardwarePropertyDevices) {
        guard !audioObjects(device, kAudioDevicePropertyStreams, scope: kAudioObjectPropertyScopeInput).isEmpty
        else { continue }
        listen(device, kAudioDevicePropertyDeviceIsRunningSomewhere)
        if (uint32Property(device, kAudioDevicePropertyDeviceIsRunningSomewhere) ?? 0) != 0 { running = true }
    }
    return running ? [["pid": NSNull(), "app_id": "microphone", "name": NSNull()]] : []
}

// Runs on watchQueue; prints the state when it differs from the last line.
func reportMicHolders() {
    let names: Bool
    let holders: [[String: Any]]
    if #available(macOS 14.2, *) {
        names = true
        holders = processHolders()
    } else {
        names = false
        holders = deviceHolders()
    }
    let state: [String: Any] = ["names": names, "holders": holders]
    guard let data = try? JSONSerialization.data(withJSONObject: state, options: [.sortedKeys]) else { return }
    let line = String(decoding: data, as: UTF8.self)
    guard line != lastWatchLine else { return }
    lastWatchLine = line
    print(line)
    fflush(stdout)
}

func watchMicrophone() -> Never {
    watchQueue.async { reportMicHolders() }
    // Listeners carry the changes; a slow look catches what one might miss.
    let timer = DispatchSource.makeTimerSource(queue: watchQueue)
    timer.schedule(deadline: .now() + 2, repeating: 2)
    timer.setEventHandler { reportMicHolders() }
    timer.resume()
    DispatchQueue.global().async {
        while let line = readLine() {
            if line.trimmingCharacters(in: .whitespaces) == "stop" { break }
        }
        exit(0)
    }
    withExtendedLifetime(timer) { dispatchMain() }
}


// ─── CLI argument parsing ─────────────────────────────────────────────────────

var outputPath = ""
var inputID: String? = nil
var listOnly = false
var watchMic = false
var idx = 1
while idx < Int(CommandLine.argc) {
    let arg = CommandLine.arguments[idx]
    if arg == "--output", idx + 1 < Int(CommandLine.argc) {
        outputPath = CommandLine.arguments[idx + 1]
        idx += 2
    } else if arg == "--input", idx + 1 < Int(CommandLine.argc) {
        inputID = CommandLine.arguments[idx + 1]
        idx += 2
    } else if arg == "--list-inputs" {
        listOnly = true
        idx += 1
    } else if arg == "--watch-mic" {
        watchMic = true
        idx += 1
    } else {
        idx += 1
    }
}

if listOnly {
    exit(listInputs())
}
if watchMic {
    watchMicrophone()
}
guard !outputPath.isEmpty else {
    fputs("Usage: sonorus-capture --list-inputs\n" +
          "       sonorus-capture --watch-mic\n" +
          "       sonorus-capture [--input <uniqueID|default>] --output <path.wav>\n", stderr)
    exit(1)
}

// ─── Entry point ──────────────────────────────────────────────────────────────

signal(SIGINT)  { _ in keepRunning = false }
signal(SIGTERM) { _ in keepRunning = false }

if let inputID {
    exit(recordMicrophone(id: inputID, outputPath: outputPath))
}
if #available(macOS 14.2, *) {
    exit(recordSystemAudio(outputPath: outputPath))
}
fputs("ERROR: system audio needs macOS 14.2 or newer\n", stderr)
exit(2)
