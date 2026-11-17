"""TranscriptionService.transcribe() — the result it returns to the pipeline."""

from unittest.mock import MagicMock, patch

import numpy as np
import pytest

from app.services.model_service import ALIGNMENT_CATALOG


def _install_alignment(models_dir, lang):
    hf_repo = ALIGNMENT_CATALOG[lang]["hf_repo"].replace("/", "--")
    refs = models_dir / "alignment" / f"models--{hf_repo}" / "refs"
    refs.mkdir(parents=True)
    (refs / "main").write_text("abc123")


# whisperx.align() and assign_word_speakers() return segments without the
# language; the transcript must still get the language Whisper used.
@pytest.mark.parametrize("requested, used", [(None, "ru"), ("ru", "ru"), ("en", "en")])
def test_transcribe_result_keeps_language(tmp_path, requested, used):
    from app.services.transcription_service import TranscriptionService

    if used in ALIGNMENT_CATALOG:
        _install_alignment(tmp_path, used)

    with patch("app.services.transcription_service.whisperx") as wx:
        model = MagicMock()
        wx.load_model.return_value = model
        model.transcribe.return_value = {"language": used, "segments": [{"start": 0.0, "end": 1.0, "text": "x"}]}
        wx.load_align_model.return_value = (MagicMock(), MagicMock())
        wx.align.return_value = {"segments": [{"start": 0.0, "end": 1.0, "text": "x"}], "word_segments": []}
        wx.load_audio.return_value = np.zeros(16000, dtype="float32")
        wx.assign_word_speakers.side_effect = lambda _diarization, result: {"segments": result["segments"]}

        svc = TranscriptionService(device="cpu", models_dir=tmp_path)
        result, _audio, _diarization = svc.transcribe("/fake/audio.wav", language=requested)

    assert result["language"] == used
    assert result["segments"] == [{"start": 0.0, "end": 1.0, "text": "x"}]


class _Turn:
    def __init__(self, start, end):
        self.start, self.end = start, end


class _Annotation:
    """pyannote Annotation stand-in: itertracks(yield_label=True) → (segment, track, label)."""

    def __init__(self, *turns):
        self._turns = turns

    def itertracks(self, yield_label=False):
        for k, (start, end, speaker) in enumerate(self._turns):
            yield _Turn(start, end), k, speaker


def _rows(df):
    return [(r["start"], r["end"], r["speaker"]) for _, r in df.iterrows()]


# pyannote also returns an exclusive diarization (one speaker at a time). Voice
# embeddings are taken from its turns, so that a turn holds one voice and no
# overlapped speech of another person; segments keep their speaker from the
# regular diarization, where the exclusive one showed no gain.
def test_transcribe_takes_embedding_turns_from_exclusive_diarization(tmp_path):
    from app.services.transcription_service import TranscriptionService

    regular = _Annotation((0.0, 4.0, "SPEAKER_00"), (1.0, 3.5, "SPEAKER_01"))
    exclusive = _Annotation((0.0, 1.0, "SPEAKER_00"), (1.0, 3.5, "SPEAKER_01"), (3.5, 4.0, "SPEAKER_00"))
    seen = {}

    def assign(diarization, result):
        seen["assign"] = _rows(diarization)
        return {"segments": result["segments"]}

    with patch("app.services.transcription_service.whisperx") as wx:
        model = MagicMock()
        wx.load_model.return_value = model
        model.transcribe.return_value = {"language": "en", "segments": [{"start": 0.0, "end": 4.0, "text": "x"}]}
        wx.load_align_model.return_value = (MagicMock(), MagicMock())
        wx.align.return_value = {"segments": [{"start": 0.0, "end": 4.0, "text": "x"}], "word_segments": []}
        wx.load_audio.return_value = np.zeros(16000 * 4, dtype="float32")
        wx.diarize.DiarizationPipeline.return_value.model.return_value = MagicMock(
            speaker_diarization=regular, exclusive_speaker_diarization=exclusive)
        wx.assign_word_speakers.side_effect = assign

        svc = TranscriptionService(device="cpu", models_dir=tmp_path)
        _result, _audio, diarization = svc.transcribe("/fake/audio.wav")

    assert seen["assign"] == [(0.0, 4.0, "SPEAKER_00"), (1.0, 3.5, "SPEAKER_01")]
    assert _rows(diarization) == [(0.0, 1.0, "SPEAKER_00"), (1.0, 3.5, "SPEAKER_01"), (3.5, 4.0, "SPEAKER_00")]


# A sentence between two turns of the regular diarization gets no speaker from
# assign_word_speakers; transcribe() gives it the turn with the nearest edge.
def test_transcribe_gives_a_gap_sentence_the_nearest_regular_turn(tmp_path):
    from app.services.transcription_service import TranscriptionService

    regular = _Annotation((0.0, 1.0, "SPEAKER_00"), (3.0, 4.0, "SPEAKER_01"))
    # the exclusive diarization is for embeddings only, never for sentences
    exclusive = _Annotation((0.0, 1.0, "SPEAKER_00"), (1.0, 1.2, "SPEAKER_01"), (3.0, 4.0, "SPEAKER_01"))
    segments = [{"start": 0.0, "end": 1.0, "text": "a", "speaker": "SPEAKER_00"},
                {"start": 1.3, "end": 1.8, "text": "b"},
                {"start": 3.0, "end": 4.0, "text": "c", "speaker": "SPEAKER_01"}]

    with patch("app.services.transcription_service.whisperx") as wx:
        model = MagicMock()
        wx.load_model.return_value = model
        model.transcribe.return_value = {"language": "en", "segments": segments}
        wx.load_align_model.return_value = (MagicMock(), MagicMock())
        wx.align.return_value = {"segments": segments, "word_segments": []}
        wx.load_audio.return_value = np.zeros(16000 * 4, dtype="float32")
        wx.diarize.DiarizationPipeline.return_value.model.return_value = MagicMock(
            speaker_diarization=regular, exclusive_speaker_diarization=exclusive)
        wx.assign_word_speakers.side_effect = lambda _diarization, result: {"segments": result["segments"]}

        svc = TranscriptionService(device="cpu", models_dir=tmp_path)
        result, _audio, _diarization = svc.transcribe("/fake/audio.wav")

    assert [s.get("speaker") for s in result["segments"]] == ["SPEAKER_00", "SPEAKER_00", "SPEAKER_01"]
