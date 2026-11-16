"""Both diarizations of the pyannote pipeline as DataFrames.

whisperx's DiarizationPipeline returns only the regular diarization, in which
speakers overlap. pyannote also computes an exclusive one — one speaker at a
time, overlaps given to the most likely speaker — and recommends it for
merging with a transcription.
"""
import numpy as np
import pandas as pd
import torch

SAMPLE_RATE = 16000


def to_frame(annotation) -> pd.DataFrame:
    """pyannote Annotation → DataFrame with start, end and speaker per turn."""
    rows = [(turn.start, turn.end, speaker)
            for turn, _, speaker in annotation.itertracks(yield_label=True)]
    return pd.DataFrame(rows, columns=["start", "end", "speaker"])


def diarize(diarize_model, audio: np.ndarray) -> tuple[pd.DataFrame, pd.DataFrame]:
    """Runs the pipeline of a whisperx DiarizationPipeline on 16 kHz mono audio,
    the way whisperx does. Returns (regular, exclusive) diarization."""
    output = diarize_model.model({
        "waveform": torch.from_numpy(audio[None, :]),
        "sample_rate": SAMPLE_RATE,
    })
    return to_frame(output.speaker_diarization), to_frame(output.exclusive_speaker_diarization)
