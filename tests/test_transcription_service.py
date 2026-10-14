"""TranscriptionService.transcribe() — the result it returns to the pipeline."""

from unittest.mock import MagicMock, patch

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
        wx.assign_word_speakers.side_effect = lambda _diarization, result: {"segments": result["segments"]}

        svc = TranscriptionService(device="cpu", models_dir=tmp_path)
        result, _audio, _diarization = svc.transcribe("/fake/audio.wav", language=requested)

    assert result["language"] == used
    assert result["segments"] == [{"start": 0.0, "end": 1.0, "text": "x"}]
