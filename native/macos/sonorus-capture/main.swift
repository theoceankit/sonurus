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

// ─── CLI argument parsing ─────────────────────────────────────────────────────

var outputPath = ""
var idx = 1
while idx < Int(CommandLine.argc) {
    let arg = CommandLine.arguments[idx]
    if arg == "--output", idx + 1 < Int(CommandLine.argc) {
        outputPath = CommandLine.arguments[idx + 1]
        idx += 2
    } else {
        idx += 1
    }
}
guard !outputPath.isEmpty else {
    fputs("Usage: sonorus-capture --output <path.wav>\n", stderr)
    exit(1)
}

// ─── Entry point ──────────────────────────────────────────────────────────────

var keepRunning = true
signal(SIGINT)  { _ in keepRunning = false }
signal(SIGTERM) { _ in keepRunning = false }

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
