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
//
// Build: npm run build:capture.

import AVFoundation
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

// ─── CLI argument parsing ─────────────────────────────────────────────────────

var outputPath = ""
var inputID: String? = nil
var listOnly = false
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
    } else {
        idx += 1
    }
}

if listOnly {
    exit(listInputs())
}
guard !outputPath.isEmpty else {
    fputs("Usage: sonorus-capture --list-inputs\n" +
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
