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

        // Lazily create the output file on first buffer.
        // Force int16 interleaved WAV — SCK's native float32 non-interleaved format
        // produces a non-standard WAV that ffmpeg/WhisperX cannot reliably read.
        // AVAudioFile auto-converts from its float32 processing format to int16 on write.
        if file == nil,
           let fmt = buffer.formatDescription
        {
            let avFmt = AVAudioFormat(cmAudioFormatDescription: fmt)
            let outputSettings: [String: Any] = [
                AVFormatIDKey: kAudioFormatLinearPCM,
                AVSampleRateKey: avFmt.sampleRate,
                AVNumberOfChannelsKey: avFmt.channelCount,
                AVLinearPCMBitDepthKey: 16,
                AVLinearPCMIsFloatKey: false,
                AVLinearPCMIsBigEndianKey: false,
                AVLinearPCMIsNonInterleaved: false,
            ]
            file = try? AVAudioFile(forWriting: url, settings: outputSettings)
        }
        guard let file else { return }

        if let pcm = buffer.toPCMBuffer(format: file.processingFormat) {
            try? file.write(from: pcm)
        }
    }

    func stream(_ stream: SCStream, didStopWithError error: Error) {
        fputs("Stream error: \(error)\n", stderr)
    }

    func close() { file = nil }
}

// ─── CMSampleBuffer → AVAudioPCMBuffer ────────────────────────────────────────

extension CMSampleBuffer {
    func toPCMBuffer(format: AVAudioFormat) -> AVAudioPCMBuffer? {
        let frames = AVAudioFrameCount(numSamples)
        guard let pcm = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: frames)
        else { return nil }
        pcm.frameLength = frames

        var blockBuffer: CMBlockBuffer?
        // Allocate space for up to 8 channels in the AudioBufferList.
        let ablSize = MemoryLayout<AudioBufferList>.size + MemoryLayout<AudioBuffer>.size * 8
        let ablPtr  = UnsafeMutableRawPointer.allocate(byteCount: ablSize, alignment: 8)
        defer { ablPtr.deallocate() }
        let abl = ablPtr.bindMemory(to: AudioBufferList.self, capacity: 1)

        guard CMSampleBufferGetAudioBufferListWithRetainedBlockBuffer(
            self,
            bufferListSizeNeededOut: nil,
            bufferListOut: abl,
            bufferListSize: ablSize,
            blockBufferAllocator: nil,
            blockBufferMemoryAllocator: nil,
            flags: kCMSampleBufferFlag_AudioBufferList_Assure16ByteAlignment,
            blockBufferOut: &blockBuffer
        ) == noErr else { return nil }

        // SCK delivers non-interleaved float32: one AudioBuffer per channel.
        let mutableABL = UnsafeMutableAudioBufferListPointer(abl)
        if let dest = pcm.floatChannelData {
            for ch in 0..<Int(format.channelCount) where ch < mutableABL.count {
                let src = mutableABL[ch]
                if let srcData = src.mData {
                    memcpy(dest[ch], srcData, Int(src.mDataByteSize))
                }
            }
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
            fputs("No display available\n", stderr)
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

        while keepRunning {
            try await Task.sleep(nanoseconds: 100_000_000)
        }

        try await stream.stopCapture()
    } catch {
        fputs("Capture error: \(error)\n", stderr)
    }
    writer.close()
    sema.signal()
}

sema.wait()
