from ..models.transcript import Transcript
from ..models.segment import Segment
from typing import List, Dict, Any

from app.logger import get_logger

log = get_logger("TranscriptBuilder")


class TranscriptBuilder:
    @staticmethod
    def build(result: dict, speaker_map: Dict[str, str], audio_path: str) -> Transcript:

        segments = []

        for seg in result["segments"]:
            raw_speaker = seg.get("speaker", "UNKNOWN")

            segment = Segment(
                start=seg["start"],
                end=seg["end"],
                text=seg["text"].strip(),

                speaker_raw=raw_speaker,
                speaker_resolved=speaker_map.get(raw_speaker),

                speaker_final=None
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
        """Assigns per-segment embeddings by maximum time overlap. No overlap → embedding stays None."""
        for seg in transcript.segments:
            best_match = None
            best_overlap = 0.0

            for emb in segment_embeddings:
                overlap = max(0.0, min(seg.end, emb["end"]) - max(seg.start, emb["start"]))
                if overlap > best_overlap:
                    best_overlap = overlap
                    best_match = emb

            if best_match:
                seg.embedding = best_match["embedding"]

        n_attached = sum(1 for seg in transcript.segments if seg.embedding is not None)
        log.debug(f"Attached embeddings to {n_attached}/{len(transcript.segments)} segments")
        return transcript