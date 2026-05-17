import subprocess
from pathlib import Path


def mp4_to_wav(
    input_path: str,
    output_path: str = None,
    enhance_audio: bool = True
) -> str:
    input_path = Path(input_path)

    if output_path is None:
        output_path = input_path.with_suffix(".wav")

    cmd = [
        "ffmpeg",
        "-y",
        "-loglevel", "error",
        "-i", str(input_path),
        "-ac", "1",        # mono
        "-ar", "16000",    # 16 kHz
        "-vn",             # strip video
    ]

    if enhance_audio:
        audio_filter = ",".join([
            "highpass=f=200",
            "lowpass=f=3000",
            "loudnorm"
        ])
        cmd.extend(["-af", audio_filter])

    # output
    cmd.append(str(output_path))

    subprocess.run(cmd, check=True)

    return str(output_path)


if __name__ == "__main__":
    wav = mp4_to_wav("testdata/output2.mp4", enhance_audio=False)
    print("Saved:", wav)