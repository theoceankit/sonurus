import uuid

from ..models.transcript import Transcript
from ..models.segment import Segment
from typing import List, Dict, Any

from app.logger import get_logger

log = get_logger("TranscriptBuilder")


class TranscriptBuilder:
    @staticmethod
    def build(result: dict, speaker_map: Dict[str, str], audio_path: str) -> Transcript:

        segments = []
        # Diarization speakers that resolve() did not map (no embedding: too
        # little speech) still get a stable id, one per label — raw SPEAKER_XX
        # labels are unstable across runs and are never persisted as speakers.
        speaker_map = dict(speaker_map)

        for seg in result["segments"]:
            raw_speaker = seg.get("speaker", "UNKNOWN")

            if raw_speaker not in speaker_map and raw_speaker.startswith("SPEAKER_"):
                speaker_map[raw_speaker] = str(uuid.uuid4())
                log.info(f"{raw_speaker} → {speaker_map[raw_speaker]} (new, no embedding)")
            resolved = speaker_map.get(raw_speaker)

            segment = Segment(
                start=seg["start"],
                end=seg["end"],
                text=seg["text"].strip(),

                speaker_raw=raw_speaker,
                speaker_resolved=resolved,

                speaker_final=None,
                # no diarization speaker at all — the user assigns one
                unassigned=resolved is None,
            )

            segments.append(segment)

        transcript = Transcript(
            segments=segments,
            audio_path=audio_path,
            language=result.get("language", "unknown"),
            status="draft"
        )
        log.info(f"Built transcript — {len(segments)} segments, language={transcript.language}")
        return transcript

    @staticmethod
    def attach_embeddings(
        transcript: Transcript,
        segment_embeddings: List[Dict[str, Any]],
    ) -> Transcript:
        """Assigns each segment the embedding of the diarization turn of the SAME
        speaker (segment.speaker_raw) with the largest time overlap.

        A Whisper segment can span a speaker change; taking the turn with the
        largest overlap regardless of speaker would attach another person's
        voice and contaminate this speaker's profile on commit. No overlapping
        turn of the same speaker → embedding stays None.
        """
        by_speaker: Dict[str, List[Dict[str, Any]]] = {}
        for emb in segment_embeddings:
            by_speaker.setdefault(emb["speaker"], []).append(emb)

        for seg in transcript.segments:
            best_match = None
            best_overlap = 0.0

            for emb in by_speaker.get(seg.speaker_raw, ()):
                overlap = max(0.0, min(seg.end, emb["end"]) - max(seg.start, emb["start"]))
                if overlap > best_overlap:
                    best_overlap = overlap
                    best_match = emb

            if best_match:
                seg.embedding = best_match["embedding"]

        n_attached = sum(1 for seg in transcript.segments if seg.embedding is not None)
        log.debug(f"Attached embeddings to {n_attached}/{len(transcript.segments)} segments")
        return transcript