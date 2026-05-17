import os
import shutil
from datetime import date
from typing import Callable

from app.models.transcript import Transcript


class ArchiveService:
    """Saves audio + transcript .txt to .files/YYYY-MM-DD/<stem>/."""

    BASE_DIR = ".files"

    def archive(
        self,
        transcript: Transcript,
        display_fn: Callable[[str], str] | None = None,
    ) -> str:
        """
        Copy audio and write transcript .txt to the date archive.
        Returns the destination directory path.

        display_fn: optional callable (spk_id -> display name). Defaults to identity.
        """
        audio_path = transcript.audio_path
        stem = os.path.splitext(os.path.basename(audio_path))[0]
        dest_dir = os.path.join(self.BASE_DIR, date.today().strftime("%Y-%m-%d"), stem)
        os.makedirs(dest_dir, exist_ok=True)

        audio_dest = os.path.join(dest_dir, os.path.basename(audio_path))
        if not os.path.exists(audio_dest) and os.path.abspath(audio_path) != os.path.abspath(audio_dest):
            shutil.copy2(audio_path, audio_dest)

        get_name = display_fn or (lambda x: x)
        lines = []
        for seg in transcript.segments:
            spk_id = seg.speaker_final or seg.speaker_resolved or seg.speaker_raw
            start = format_time(seg.start)
            end   = format_time(seg.end)
            lines.append(f"[{start} - {end}] {get_name(spk_id)}: {seg.text}")

        txt_path = os.path.join(dest_dir, stem + ".txt")
        with open(txt_path, "w", encoding="utf-8") as f:
            f.write("\n".join(lines))

        return dest_dir


def format_time(seconds: float) -> str:
    m, s = divmod(int(seconds), 60)
    h, m = divmod(m, 60)
    if h:
        return f"{h:02d}:{m:02d}:{s:02d}"
    return f"{m:02d}:{s:02d}"
