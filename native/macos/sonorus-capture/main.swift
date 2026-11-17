// sonorus-capture — system audio (ScreenCaptureKit) and the microphone
// (AVCaptureSession) for Sonorus on macOS.
//
//   sonorus-capture --output <file.wav>
//       Records system audio. Prints READY once capture runs; stops on SIGINT.
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
//       input device" is known: one holder with null fields, "names": false.
//       Stops on "stop" on stdin or at EOF.
//
// Build: npm run build:capture.

import AVFoundation
import CoreAudio
import Darwin
import Foundation
import ScreenCaptureKit

// ─── Audio writer ─────────────────────────────────────────────────────────────

final class AudioWriter: NSObject, SCStreamOutput, SCStreamDelegate {
    private var file: AVAudioFile?
    private let url: URL

    init(url: URL) { self.url = url }

    func stream(
        _ stream: SCStream,
        didOutputSampleBuffer buffer: CMSampleBuffer,
        of type: SCStreamOutputType
    ) {
        guard type == .audio else { return }

        if file == nil,
           let fmt = buffer.formatDescription
        {
            let sckFmt = AVAudioFormat(cmAudioFormatDescription: fmt)
            guard let int16Fmt = AVAudioFormat(
                commonFormat: .pcmFormatInt16,
                sampleRate: sckFmt.sampleRate,
                channels: sckFmt.channelCount,
                interleaved: true
            ) else {
                fputs("ERROR: could not construct int16 output format\n", stderr)
                return
            }
            if let f = try? AVAudioFile(forWriting: url, settings: int16Fmt.settings) {
                file = f
            } else {
                fputs("ERROR: AVAudioFile(forWriting:) failed for \(url.path)\n", stderr)
            }
        }
        guard let file else { return }

        if let pcm = buffer.toPCMBuffer(format: file.processingFormat) {
            do {
                try file.write(from: pcm)
            } catch {
                fputs("ERROR: write failed: \(error)\n", stderr)
            }
        }
    }

    func stream(_ stream: SCStream, didStopWithError error: Error) {
        fputs("ERROR: stream stopped: \(error)\n", stderr)
    }

    func close() { file = nil }
}

// ─── CMSampleBuffer → AVAudioPCMBuffer ────────────────────────────────────────

extension CMSampleBuffer {
    // SCK buffers lack per-sample size info, so CMSampleBufferGetAudioBufferListWithRetainedBlockBuffer
    // returns kCMSampleBufferError_BufferHasNoSampleSizes (-12737).
    // CMSampleBufferCopyPCMDataIntoAudioBufferList is the correct API for SCK audio.
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
    return ["pid": Int(pid), "app_id": appID.map { $0 as Any } ?? NSNull(), "name": name.map { $0 as Any } ?? NSNull()]
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
    return running ? [["pid": NSNull(), "app_id": NSNull(), "name": NSNull()]] : []
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

let writer = AudioWriter(url: URL(fileURLWithPath: outputPath))
let sema   = DispatchSemaphore(value: 0)

Task {
    do {
        let content = try await SCShareableContent.current
        guard let display = content.displays.first else {
            fputs("ERROR: no display available\n", stderr)
            exit(1)
        }

        let filter = SCContentFilter(display: display, excludingWindows: [])
        let cfg    = SCStreamConfiguration()
        cfg.capturesAudio               = true
        cfg.excludesCurrentProcessAudio = true
        cfg.minimumFrameInterval        = CMTime(value: 1, timescale: 1)
        cfg.width  = 2
        cfg.height = 2

        let stream = SCStream(filter: filter, configuration: cfg, delegate: writer)
        try stream.addStreamOutput(writer, type: .audio, sampleHandlerQueue: .global())
        try await stream.startCapture()
        print("READY")
        fflush(stdout)

        while keepRunning {
            try await Task.sleep(nanoseconds: 100_000_000)
        }

        try await stream.stopCapture()
    } catch {
        fputs("ERROR: \(error)\n", stderr)
    }
    writer.close()
    sema.signal()
}

sema.wait()
