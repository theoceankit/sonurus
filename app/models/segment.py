from dataclasses import dataclass, field
from typing import Optional, Any

# Effective speaker of a segment whose speaker was deleted. Never stored in
# segments.speaker_id (which holds UUIDs only) and never a speaker in memory.
UNASSIGNED = "UNASSIGNED"


@dataclass
class Segment:
    start: float
    end: float
    text: str

    # raw diarization output (e.g. SPEAKER_00)
    speaker_raw: str

    # auto-matched from speaker memory
    speaker_resolved: Optional[str] = None

    # user correction; always takes priority
    speaker_final: Optional[str] = None

    # per-segment pyannote embedding
    embedding: Any = field(default=None, compare=False, repr=False)

    # speaker was deleted; the segment waits for the user to assign someone
    unassigned: bool = False