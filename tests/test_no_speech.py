"""Chunks Whisper itself judges to hold no speech are dropped before alignment.

WhisperX decodes every chunk the VAD passes (music, ring tones) and returns
whatever Whisper writes there ("Thank you.", "Продолжение следует..."). The
hook asks CTranslate2's generate() for each chunk's no-speech probability in
the same call; transcribe() drops the chunks at or above the threshold.
"""
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import numpy as np
import pytest

from app.services import no_speech


def _seg(start, end, text="x"):
    return {"start": start, "end": end, "text": text, "avg_logprob": -0.1}


class FakeWhisper:
    """CTranslate2 Whisper stand-in: generate() answers with the next probabilities."""

    def __init__(self, *batches):
        self.batches = list(batches)
        self.calls = []
        self.is_multilingual = True

    def generate(self, features, prompts, **kwargs):
        self.calls.append(kwargs)
        probs = self.batches.pop(0)
        return [SimpleNamespace(sequences_ids=[[1]], scores=[-0.1], no_speech_prob=p) for p in probs]

    def detect_language(self, encoded):
        return [[("<|en|>", 1.0)]]


def _pipeline(fake):
    return SimpleNamespace(model=SimpleNamespace(model=fake))


# --- drop --------------------------------------------------------------------

def test_drop_takes_out_chunks_at_or_above_the_threshold():
    segs = [_seg(0, 10), _seg(10, 20, "Thank you."), _seg(20, 30)]
    kept, dropped = no_speech.drop(segs, [0.1, 0.95, 0.79], 0.8)
    assert kept == [segs[0], segs[2]]
    assert [d["text"] for d in dropped] == ["Thank you."]
    assert dropped[0]["no_speech_prob"] == 0.95


def test_drop_at_exactly_the_threshold_drops():
    kept, dropped = no_speech.drop([_seg(0, 1)], [0.8], 0.8)
    assert kept == [] and len(dropped) == 1


def test_drop_keeps_the_segments_unchanged():
    segs = [_seg(0, 10)]
    kept, _ = no_speech.drop(segs, [0.1], 0.8)
    assert kept[0] is segs[0] and "no_speech_prob" not in kept[0]


def test_drop_without_a_threshold_keeps_everything():
    segs = [_seg(0, 10), _seg(10, 20)]
    assert no_speech.drop(segs, [0.99, 0.99], None) == (segs, [])


def test_drop_keeps_everything_when_the_counts_differ(monkeypatch):
    log = MagicMock()
    monkeypatch.setattr(no_speech, "log", log)
    segs = [_seg(0, 10), _seg(10, 20)]
    kept, dropped = no_speech.drop(segs, [0.99], 0.8)
    assert kept == segs and dropped == []
    assert "1 no_speech probabilities for 2 chunks" in log.warning.call_args[0][0]


def test_drop_of_nothing_is_nothing():
    assert no_speech.drop([], [], 0.8) == ([], [])


# --- the hook on CTranslate2's generate() -------------------------------------

def test_install_asks_generate_for_the_no_speech_probability():
    fake = FakeWhisper([0.1, 0.9])
    pipe = _pipeline(fake)
    no_speech.install(pipe)
    pipe.model.model.generate("features", ["p", "p"], beam_size=5, return_scores=True)
    assert fake.calls == [{"beam_size": 5, "return_scores": True, "return_no_speech_prob": True}]


def test_install_records_the_probabilities_in_chunk_order_across_batches():
    fake = FakeWhisper([0.1, 0.9], [0.3])
    pipe = _pipeline(fake)
    hook = no_speech.install(pipe)
    hook.reset()
    pipe.model.model.generate("f", ["p", "p"])
    pipe.model.model.generate("f", ["p"])
    assert hook.probs == [0.1, 0.9, 0.3]


def test_reset_forgets_the_previous_transcription():
    fake = FakeWhisper([0.9], [0.2])
    pipe = _pipeline(fake)
    hook = no_speech.install(pipe)
    pipe.model.model.generate("f", ["p"])
    hook.reset()
    pipe.model.model.generate("f", ["p"])
    assert hook.probs == [0.2]


def test_the_hook_passes_everything_else_through():
    fake = FakeWhisper()
    pipe = _pipeline(fake)
    no_speech.install(pipe)
    assert pipe.model.model.is_multilingual is True
    assert pipe.model.model.detect_language("enc") == [[("<|en|>", 1.0)]]


def test_filter_drops_by_the_threshold_read_at_every_call(monkeypatch):
    fake = FakeWhisper([0.1, 0.9], [0.1, 0.9])
    pipe = _pipeline(fake)
    hook = no_speech.install(pipe)
    segs = [_seg(0, 10), _seg(10, 20, "Thank you.")]

    hook.reset()
    pipe.model.model.generate("f", ["p", "p"])
    assert hook.filter(segs) == [segs[0]]
    assert [(c["text"], c["no_speech_prob"], c["dropped"]) for c in hook.last] == [
        ("x", 0.1, False), ("Thank you.", 0.9, True)]

    monkeypatch.setattr(no_speech, "THRESHOLD", None)  # the quality tests switch it off
    hook.reset()
    pipe.model.model.generate("f", ["p", "p"])
    assert hook.filter(segs) == segs
    assert [c["dropped"] for c in hook.last] == [False, False]


def test_describe_names_time_probability_and_text():
    dropped = [{**_seg(12.0, 38.5, " Thank you."), "no_speech_prob": 0.97}]
    line = no_speech.describe(dropped, 7)
    assert "1 of 7" in line
    assert "0:12–0:38" in line
    assert "0.97" in line
    assert '"Thank you."' in line


# --- TranscriptionService ----------------------------------------------------

def _install_alignment(models_dir, lang):
    from app.services.model_service import ALIGNMENT_CATALOG
    hf_repo = ALIGNMENT_CATALOG[lang]["hf_repo"].replace("/", "--")
    refs = models_dir / "alignment" / f"models--{hf_repo}" / "refs"
    refs.mkdir(parents=True)
    (refs / "main").write_text("abc123")


def _service(tmp_path, wx, segments, probs):
    from app.services.transcription_service import TranscriptionService

    model = MagicMock()  # FasterWhisperPipeline; .model is WhisperModel, .model.model CTranslate2's
    model.model.model = FakeWhisper(probs)
    wx.load_model.return_value = model
    wx.load_align_model.return_value = (MagicMock(), MagicMock())
    wx.align.side_effect = lambda segs, *_a, **_k: {"segments": list(segs), "word_segments": []}
    wx.load_audio.return_value = np.zeros(16000 * 30, dtype="float32")
    wx.assign_word_speakers.side_effect = lambda _diarization, result: {"segments": result["segments"]}
    svc = TranscriptionService(device="cpu", models_dir=tmp_path)

    def transcribe(audio, **_kwargs):
        # what FasterWhisperPipeline.transcribe() does: one generate() per batch
        svc.model.model.model.generate("features", ["p"] * len(probs))
        return {"language": "en", "segments": [dict(s) for s in segments]}

    model.transcribe.side_effect = transcribe
    return svc


def test_transcribe_aligns_only_the_chunks_with_speech(tmp_path):
    _install_alignment(tmp_path, "en")
    segments = [_seg(0.0, 26.1, " Thank you."), _seg(45.1, 70.6, " But it's something very natural")]
    with patch("app.services.transcription_service.whisperx") as wx:
        svc = _service(tmp_path, wx, segments, [0.97, 0.01])
        result, _audio, _diarization = svc.transcribe("/fake/audio.wav")
        aligned = wx.align.call_args[0][0]

    assert [s["text"] for s in aligned] == [" But it's something very natural"]
    assert [s["text"] for s in result["segments"]] == [" But it's something very natural"]


def test_transcribe_with_every_chunk_dropped_goes_on_with_no_segments(tmp_path):
    _install_alignment(tmp_path, "en")
    with patch("app.services.transcription_service.whisperx") as wx:
        svc = _service(tmp_path, wx, [_seg(15.5, 16.7, " Thank you.")], [0.89])
        result, _audio, _diarization = svc.transcribe("/fake/audio.wav")

    assert result["segments"] == []
    assert wx.align.call_args[0][0] == []


def test_transcription_service_installs_the_hook(tmp_path):
    from app.services.transcription_service import TranscriptionService

    with patch("app.services.transcription_service.whisperx") as wx:
        model = MagicMock()
        model.model.model = FakeWhisper()
        wx.load_model.return_value = model
        svc = TranscriptionService(device="cpu", models_dir=tmp_path)

    assert isinstance(svc.model.model.model, no_speech.NoSpeech)
    assert svc.no_speech is svc.model.model.model
