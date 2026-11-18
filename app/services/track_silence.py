"""Whether every track of a live recording has been quiet for a while.

The capture processes write WAV files while the recording runs; each check
reads what was added to them since the last one. A track is loud when a
100 ms window of it is above the threshold; the recording is silent once no
track has been loud for `after` seconds. Header sizes are not trusted (a
capture still writing leaves them at 0): the samples run from the data chunk
to the end of the file.
"""
import struct
import time
from dataclasses import dataclass

import numpy as np

# Below this level a window is quiet: room tone and a line with nobody
# speaking stay under it, a voice does not.
SILENCE_DB = -50.0
WINDOW_SEC = 0.1
# Read no more than this at once; a check that fell behind starts from the end.
MAX_READ_SEC = 30.0


@dataclass
class _Format:
    data_start: int
    channels: int
    rate: int
    dtype: str  # "int16" or "float32"

    @property
    def frame(self) -> int:
        return self.channels * (2 if self.dtype == "int16" else 4)


def _read_format(path: str) -> _Format | None:
    """The sample format and where the samples start; None until the header
    is there or when the format is not one a capture writes."""
    try:
        with open(path, "rb") as f:
            head = f.read(4096)
    except OSError:
        return None
    if len(head) < 12 or head[:4] != b"RIFF" or head[8:12] != b"WAVE":
        return None
    pos, fmt = 12, None
    while pos + 8 <= len(head):
        chunk, size = head[pos:pos + 4], struct.unpack("<I", head[pos + 4:pos + 8])[0]
        body = pos + 8
        if chunk == b"fmt ":
            if body + 16 > len(head):
                return None
            tag, channels, rate, _, _, bits = struct.unpack("<HHIIHH", head[body:body + 16])
            if tag == 0xFFFE and body + 26 <= len(head):  # WAVE_FORMAT_EXTENSIBLE: the sub format
                tag = struct.unpack("<H", head[body + 24:body + 26])[0]
            fmt = (tag, channels, rate, bits)
        elif chunk == b"data":
            if fmt is None or fmt[1] < 1:
                return None
            tag, channels, rate, bits = fmt
            if tag == 1 and bits == 16:
                return _Format(body, channels, rate, "int16")
            if tag == 3 and bits == 32:
                return _Format(body, channels, rate, "float32")
            return None
        pos = body + size + (size & 1)
    return None


class _Track:
    def __init__(self, path: str):
        self.path = path
        self.format: _Format | None = None
        self.offset = 0

    def loud(self, threshold: float) -> bool:
        """Whether what was added since the last read is loud anywhere."""
        if self.format is None:
            self.format = _read_format(self.path)
            if self.format is None:
                return False
            self.offset = self.format.data_start
        fmt = self.format
        try:
            with open(self.path, "rb") as f:
                f.seek(0, 2)
                end = f.tell()
                usable = (end - self.offset) // fmt.frame * fmt.frame
                if usable <= 0:
                    return False
                cap = int(MAX_READ_SEC * fmt.rate) * fmt.frame
                if usable > cap:
                    self.offset += usable - cap
                    usable = cap
                f.seek(self.offset)
                data = f.read(usable)
        except OSError:
            return False
        usable = len(data) // fmt.frame * fmt.frame
        self.offset += usable
        samples = np.frombuffer(data[:usable], dtype="<i2" if fmt.dtype == "int16" else "<f4")
        samples = samples.astype(np.float64)
        if fmt.dtype == "int16":
            samples /= 32768.0
        window = max(1, int(WINDOW_SEC * fmt.rate)) * fmt.channels
        count = len(samples) // window
        if count == 0:
            # Less than one window: judged on its own.
            return bool(len(samples)) and float(np.sqrt(np.mean(samples ** 2))) > threshold
        windows = samples[:count * window].reshape(count, window)
        rms = np.sqrt(np.mean(windows ** 2, axis=1))
        return bool(np.any(rms > threshold))


def only_zeros(path: str, chunk: int = 1 << 20) -> bool:
    """Whether a track holds not one sample that is not zero: digital silence,
    as a capture the system gave nothing writes it. A header with no samples
    counts as silent; a file that cannot be read does not."""
    fmt = _read_format(path)
    if fmt is None:
        return False
    try:
        with open(path, "rb") as f:
            f.seek(fmt.data_start)
            while data := f.read(chunk):
                if data.count(0) != len(data):
                    return False
    except OSError:
        return False
    return True


class SilenceWatch:
    def __init__(self, paths: list[str], after: float, threshold_db: float = SILENCE_DB, clock=time.monotonic):
        self._tracks = [_Track(p) for p in paths]
        self._after = after
        self._threshold = 10 ** (threshold_db / 20)
        self._clock = clock
        self._last_loud = clock()

    def check(self) -> bool:
        """Reads what the tracks added; True once none was loud for `after` seconds."""
        now = self._clock()
        # Every track is read, so none falls behind.
        if any([track.loud(self._threshold) for track in self._tracks]):
            self._last_loud = now
        return now - self._last_loud >= self._after
