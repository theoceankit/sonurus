#!/usr/bin/env python3
"""Build the audio quality test set from the AMI Meeting Corpus (CC BY 4.0).

Downloads only the clip windows of each participant's headset track (HTTP
range requests) plus the manual annotations, and writes per clip:

  ref.json        reference words {word, start, end, speaker} (AMI global speaker ids)
  tracks/<id>.wav one participant's headset, 16 kHz mono: only their own
                  speech (others in the room gated out), at -30 dBFS
  clean.wav       sum of the headsets
  call.wav        everyone through their own "device" (laptop mic with noise,
                  Bluetooth headset, quiet participant, plain mic), then summed
  uneven.wav      clean, with one participant 20 dB down

into $SONORUS_EVAL_CACHE/ami (default ~/.cache/sonorus-eval/ami). Clips and
devices are fixed in tests/quality/ami_manifest.json; downloaded audio is
checked against the sha256 recorded there (--record-hashes fills them in).
Needs ffmpeg with libopus on PATH.

    .venv/bin/python scripts/eval/build_ami_set.py
"""
import argparse
import hashlib
import json
import os
import shutil
import struct
import subprocess
import sys
import urllib.request
import wave
import zipfile
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

from tests.quality import ami  # noqa: E402

MANIFEST = ROOT / "tests" / "quality" / "ami_manifest.json"
SAMPLE_RATE = 16000
SAMPLE_BYTES = 2

# Per-participant "device" chains (ffmpeg -af), the same person keeps the same
# device in every clip. "bluetooth" is also passed through Opus at 16 kbit/s.
DEVICE_FILTERS = {
    "laptop": "highpass=f=200,lowpass=f=7000,volume=-8dB",
    "bluetooth": "highpass=f=300,lowpass=f=3400",
    "quiet": "volume=-18dB",
    "plain": "anull",
}
LAPTOP_NOISE = "anoisesrc=color=pink:amplitude=0.004:seed=7:sample_rate=16000"
BITEXACT = ["-fflags", "+bitexact", "-flags:a", "+bitexact"]
# Each headset also hears the others in the room; a call has everyone on their
# own microphone, so a track keeps only its owner's annotated speech. AMI
# headsets are not calibrated either (one participant can be 20 dB above the
# rest): every track is brought to this speech level (RMS over the owner's
# words) before any device chain; -30 dBFS leaves headroom for the peaks.
SPEECH_LEVEL_DBFS = -30.0


def cache_dir() -> Path:
    return Path(os.getenv("SONORUS_EVAL_CACHE", Path.home() / ".cache" / "sonorus-eval")) / "ami"


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def fetch(url: str, byte_range: tuple[int, int] | None = None) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": "sonorus-eval"})
    if byte_range:
        req.add_header("Range", f"bytes={byte_range[0]}-{byte_range[1]}")
    with urllib.request.urlopen(req, timeout=120) as resp:
        if byte_range and resp.status != 206:
            raise RuntimeError(f"{url}: server ignored the range request")
        return resp.read()


def data_offset(header: bytes) -> int:
    """Offset of the PCM data in a RIFF/WAVE file; checks 16 kHz mono 16-bit."""
    if header[:4] != b"RIFF" or header[8:12] != b"WAVE":
        raise RuntimeError("not a WAV file")
    pos = 12
    while pos + 8 <= len(header):
        cid, size = header[pos:pos + 4], struct.unpack("<I", header[pos + 4:pos + 8])[0]
        if cid == b"fmt ":
            _, channels, rate, _, _, bits = struct.unpack("<HHIIHH", header[pos + 8:pos + 24])
            if (channels, rate, bits) != (1, SAMPLE_RATE, 16):
                raise RuntimeError(f"unexpected format {channels} ch {rate} Hz {bits} bit")
        if cid == b"data":
            return pos + 8
        pos += 8 + size + (size & 1)
    raise RuntimeError("no data chunk in the first bytes")


def write_wav(path: Path, pcm: bytes) -> None:
    with wave.open(str(path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(SAMPLE_BYTES)
        w.setframerate(SAMPLE_RATE)
        w.writeframes(pcm)


def level_track(pcm: bytes, intervals: list[tuple[float, float]]) -> tuple[bytes, float]:
    """Keep only the owner's speech (speech_gate) and bring it to SPEECH_LEVEL_DBFS.

    Returns the new PCM and the speech level the track had, in dBFS.
    """
    x = np.frombuffer(pcm, dtype="<i2").astype(np.float64) / 32768
    x = x * ami.speech_gate(len(x), intervals, SAMPLE_RATE)
    speech = np.concatenate([x[int(s * SAMPLE_RATE):int(e * SAMPLE_RATE)] for s, e in intervals])
    level = 20 * np.log10(np.sqrt(np.mean(speech ** 2)))
    y = np.clip(x * 10 ** ((SPEECH_LEVEL_DBFS - level) / 20), -1, 32767 / 32768)
    return np.round(y * 32768).astype("<i2").tobytes(), round(float(level), 1)


def ffmpeg(*args: str) -> None:
    subprocess.run(["ffmpeg", "-y", "-nostdin", "-loglevel", "error", *args], check=True)


def headset_slice(manifest, meeting, channel, start, end, record) -> bytes:
    url = manifest["audio_url"].format(meeting=meeting, channel=channel)
    off = data_offset(fetch(url, (0, 4095)))
    first = off + start * SAMPLE_RATE * SAMPLE_BYTES
    pcm = fetch(url, (first, first + (end - start) * SAMPLE_RATE * SAMPLE_BYTES - 1))
    key = f"{meeting}.{channel}.{start}-{end}"
    digest, known = sha256(pcm), manifest["pcm_sha256"].get(key)
    if known is None and record:
        manifest["pcm_sha256"][key] = digest
    elif known != digest:
        raise RuntimeError(f"{key}: sha256 {digest} does not match the manifest ({known})")
    return pcm


def device_track(src: Path, dst: Path, device: str, tmp: Path) -> None:
    chain = DEVICE_FILTERS[device]
    if device == "laptop":
        ffmpeg("-i", str(src), "-filter_complex",
               f"[0:a]{chain}[v];{LAPTOP_NOISE}[n];[v][n]amix=inputs=2:duration=first:normalize=0",
               *BITEXACT, "-ar", str(SAMPLE_RATE), "-ac", "1", str(dst))
    elif device == "bluetooth":
        opus = tmp / f"{dst.stem}.opus"
        ffmpeg("-i", str(src), "-af", chain, "-c:a", "libopus", "-b:a", "16k",
               "-application", "voip", *BITEXACT, str(opus))
        ffmpeg("-i", str(opus), *BITEXACT, "-ar", str(SAMPLE_RATE), "-ac", "1", str(dst))
    else:
        ffmpeg("-i", str(src), "-af", chain, *BITEXACT, str(dst))


def mix(inputs: list[Path], dst: Path) -> None:
    args = [a for p in inputs for a in ("-i", str(p))]
    pads = "".join(f"[{k}:a]" for k in range(len(inputs)))
    ffmpeg(*args, "-filter_complex",
           f"{pads}amix=inputs={len(inputs)}:duration=longest:normalize=0,alimiter=limit=0.95:level=disabled",
           *BITEXACT, "-ar", str(SAMPLE_RATE), "-ac", "1", "-c:a", "pcm_s16le", str(dst))


def build_clip(manifest, clip, zf: zipfile.ZipFile, out: Path, record: bool) -> None:
    meeting, start, end = clip["meeting"], clip["start"], clip["end"]
    speakers = ami.parse_meeting_speakers(zf.read("corpusResources/meetings.xml"), meeting)
    words = {a: ami.parse_words(zf.read(f"words/{meeting}.{a}.words.xml")) for a in speakers}

    clip_dir = out / clip["id"]
    tracks, tmp = clip_dir / "tracks", clip_dir / "tmp"
    for d in (tracks, tmp):
        d.mkdir(parents=True, exist_ok=True)

    reference = ami.window_reference(words, speakers, start, end)
    plain, device, uneven, source_levels = [], [], [], {}
    for spk in sorted(speakers.values(), key=lambda s: s.channel):
        track = tracks / f"{spk.global_name}.wav"
        intervals = [(r["start"], r["end"]) for r in reference if r["speaker"] == spk.global_name]
        pcm, source_levels[spk.global_name] = level_track(
            headset_slice(manifest, meeting, spk.channel, start, end, record), intervals)
        write_wav(track, pcm)
        plain.append(track)
        dev = tmp / f"{spk.global_name}.{manifest['devices'][spk.global_name]}.wav"
        device_track(track, dev, manifest["devices"][spk.global_name], tmp)
        device.append(dev)
        if spk.global_name == manifest["uneven_quiet_speaker"]:
            quiet = tmp / f"{spk.global_name}.minus20.wav"
            ffmpeg("-i", str(track), "-af", "volume=-20dB", *BITEXACT, str(quiet))
            uneven.append(quiet)
        else:
            uneven.append(track)

    (clip_dir / "ref.json").write_text(json.dumps({
        "meeting": meeting, "start": start, "end": end,
        "speakers": sorted(source_levels),
        "source_speech_level_dbfs": source_levels,
        "words": reference,
    }, indent=1))
    mix(plain, clip_dir / "clean.wav")
    mix(device, clip_dir / "call.wav")
    mix(uneven, clip_dir / "uneven.wav")
    shutil.rmtree(tmp)
    print(f"{clip['id']}: {meeting} {start}-{end} s, {len(speakers)} speakers → {clip_dir}")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--record-hashes", action="store_true",
                        help="write missing sha256 values into the manifest instead of failing")
    args = parser.parse_args()
    if shutil.which("ffmpeg") is None:
        sys.exit("ffmpeg not found on PATH")

    manifest = json.loads(MANIFEST.read_text())
    out = cache_dir()
    out.mkdir(parents=True, exist_ok=True)

    zip_path = out / "ami_public_manual_1.6.2.zip"
    if not zip_path.exists():
        zip_path.write_bytes(fetch(manifest["annotations_url"]))
    digest = sha256(zip_path.read_bytes())
    if manifest["annotations_sha256"] is None and args.record_hashes:
        manifest["annotations_sha256"] = digest
    elif manifest["annotations_sha256"] != digest:
        sys.exit(f"annotations sha256 {digest} does not match the manifest; delete {zip_path} and retry")

    with zipfile.ZipFile(zip_path) as zf:
        for clip in manifest["clips"]:
            build_clip(manifest, clip, zf, out, args.record_hashes)

    if args.record_hashes:
        MANIFEST.write_text(json.dumps(manifest, indent=2) + "\n")
    print(f"set ready in {out}")


if __name__ == "__main__":
    main()
