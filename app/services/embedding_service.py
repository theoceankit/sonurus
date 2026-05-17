import torch
import numpy as np
from collections import defaultdict
from pathlib import Path
from pyannote.audio import Model, Inference

from app.config import MODELS_DIR, EMBEDDING_SAMPLE_RATE, EMBEDDING_MIN_DURATION
from app.logger import get_logger

log = get_logger("EmbeddingService")


class EmbeddingService:

    def __init__(self, device, sample_rate=EMBEDDING_SAMPLE_RATE, min_duration=EMBEDDING_MIN_DURATION, models_dir: Path = MODELS_DIR):
        self.device = device
        self.sample_rate = sample_rate
        self.min_duration = min_duration

        log.info(f"Loading pyannote embedding model (device={device})")
        try:
            model = Model.from_pretrained(
                "pyannote/embedding",
                strict=False,
                cache_dir=str(models_dir / "hf"),
            )
            self.inference = Inference(model, window="whole")
            self.inference.to(torch.device(device))
        except (OSError, RuntimeError) as exc:
            raise RuntimeError(f"Failed to load PyAnnote embedding model: {exc}") from exc

    def extract_all(self, audio, diarize_segments):
        """Returns (aggregated_dict, segments_list) in a single pyannote pass."""
        segments = self.extract_segments(audio, diarize_segments)
        aggregated = self._aggregate_from_segments(segments)
        log.info(f"Extracted embeddings — {len(aggregated)} speakers, {len(segments)} segments")
        return aggregated, segments

    def extract(self, audio, diarize_segments):
        """Returns mean embeddings per speaker: {"SPEAKER_00": np.array, ...}."""
        segments = self.extract_segments(audio, diarize_segments)
        return self._aggregate_from_segments(segments)

    def extract_segments(self, audio, diarize_segments):
        """Returns per-segment embeddings: [{"start", "end", "speaker", "embedding"}]."""
        result = []

        for _, row in diarize_segments.iterrows():
            start = row["start"]
            end = row["end"]
            speaker = row["speaker"]

            if end - start < self.min_duration:
                continue

            emb = self._get_embedding(audio, start, end)

            if emb is not None:
                result.append({
                    "start": start,
                    "end": end,
                    "speaker": speaker,
                    "embedding": emb,
                })

        return result

    def _aggregate_from_segments(self, segment_embeddings):
        """Aggregates per-segment list into {speaker: mean_embedding}."""
        speaker_embeddings = defaultdict(list)
        for item in segment_embeddings:
            speaker_embeddings[item["speaker"]].append(item["embedding"])
        return self._aggregate(speaker_embeddings)

    def _get_embedding(self, audio, start, end):
        """Extracts pyannote embedding for a single audio slice. Returns None if too short."""
        start_idx = int(start * self.sample_rate)
        end_idx = int(end * self.sample_rate)

        chunk = audio[start_idx:end_idx]

        if len(chunk) < self.sample_rate:
            return None

        waveform = torch.tensor(chunk).unsqueeze(0)

        emb = self.inference({
            "waveform": waveform,
            "sample_rate": self.sample_rate
        })

        return np.array(emb)

    @staticmethod
    def _aggregate(speaker_embeddings):
        """Mean-pools per-speaker embedding lists into {speaker: np.array}."""
        final_embeddings = {}

        for speaker, embs in speaker_embeddings.items():
            if len(embs) == 0:
                continue

            final_embeddings[speaker] = np.mean(embs, axis=0)

        return final_embeddings