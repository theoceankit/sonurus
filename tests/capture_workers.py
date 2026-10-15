"""Stand-in for the Windows capture helper (sonorus-capture.exe).

Runs as a real child process in tests, so the Windows driver's handshake and
stdin stop are exercised on any OS. No app imports.

    capture_workers.py --list
        prints FAKE_CAPTURE_DEVICES (JSON) or exits 1 if FAKE_CAPTURE_LIST_FAILS is set
    capture_workers.py --device <id> --output <path>
        device "broken" → error on stderr, exit 2 before READY;
        otherwise writes a WAV, prints READY, records until "stop" or EOF on stdin
"""
import json
import os
import struct
import sys

RATE, CHANNELS = 48000, 2


def _wav_header(data_bytes: int) -> bytes:
    return (b"RIFF" + struct.pack("<I", 36 + data_bytes) + b"WAVE"
            + b"fmt " + struct.pack("<IHHIIHH", 16, 1, CHANNELS, RATE, RATE * CHANNELS * 2, CHANNELS * 2, 16)
            + b"data" + struct.pack("<I", data_bytes))


def main(argv):
    if argv[:1] == ["--list"]:
        if os.environ.get("FAKE_CAPTURE_LIST_FAILS"):
            sys.stderr.write("ERROR: no audio endpoints\n")
            return 1
        sys.stdout.write(os.environ.get("FAKE_CAPTURE_DEVICES", "[]"))
        return 0

    device = argv[argv.index("--device") + 1]
    output = argv[argv.index("--output") + 1]
    if device == "broken":
        sys.stderr.write("ERROR: could not open the output device\n")
        return 2

    frames = b"\0\0" * CHANNELS * 4800  # 0.1 s of silence
    with open(output, "wb") as f:
        f.write(_wav_header(len(frames)) + frames)
    sys.stdout.write("READY\n")
    sys.stdout.flush()

    for line in sys.stdin:
        if line.strip() == "stop":
            break
    with open(output, "r+b") as f:
        f.seek(0, os.SEEK_END)
        f.write(frames)
        f.seek(0)
        f.write(_wav_header(len(frames) * 2))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
