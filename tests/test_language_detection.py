"""Language detection from the speech VAD found, not from the first 30 s of the file.

The pure part (windows of speech, the threshold, the average) runs without
models; the hook into WhisperX's pipeline is checked on a stand-in that calls
VAD, merge_chunks and detect_language in the order FasterWhisperPipeline.transcribe()
does.
"""
import numpy as np
import pytest

from app.services import language_detection as ld

SR = 16000


def _seconds(windows):
    return [round(sum(e - s for s, e in w), 3) for w in windows]


# --- speech_spans ------------------------------------------------------------

def test_speech_spans_flattens_the_merged_chunks():
    chunks = [
        {"start": 1.0, "end": 9.0, "segments": [(1.0, 4.0), (5.0, 9.0)]},
        {"start": 40.0, "end": 50.0, "segments": [(40.0, 50.0)]},
    ]
    assert ld.speech_spans(chunks) == [(1.0, 4.0), (5.0, 9.0), (40.0, 50.0)]


def test_speech_spans_of_no_chunks_is_empty():
    assert ld.speech_spans([]) == []
    assert ld.speech_spans(None) == []


# --- speech_windows ----------------------------------------------------------

def test_short_speech_is_one_window():
    windows = ld.speech_windows([(45.0, 50.0), (60.0, 65.0)])
    assert windows == [[(45.0, 50.0), (60.0, 65.0)]]


def test_first_window_skips_the_silence_before_speech():
    # Speech starts at 45 s (silence or music before it): the first window is
    # 30 s of that speech, not the start of the file.
    windows = ld.speech_windows([(45.0, 200.0)])
    assert windows[0] == [(45.0, 75.0)]


def test_a_span_across_the_window_border_is_cut():
    windows = ld.speech_windows([(0.0, 20.0), (25.0, 45.0)])
    assert windows[0] == [(0.0, 20.0), (25.0, 35.0)]


def test_45_s_of_speech_gives_the_first_window_and_the_rest():
    # The middle window would overlap the first; the last one starts where the
    # first ended.
    windows = ld.speech_windows([(0.0, 45.0)])
    assert windows == [[(0.0, 30.0)], [(30.0, 45.0)]]


def test_long_speech_gives_first_middle_and_last_window():
    windows = ld.speech_windows([(10.0, 130.0)])  # 120 s of speech
    assert windows == [[(10.0, 40.0)], [(55.0, 85.0)], [(100.0, 130.0)]]


def test_windows_never_overlap():
    windows = ld.speech_windows([(0.0, 70.0)])
    assert windows == [[(0.0, 30.0)], [(30.0, 60.0)], [(60.0, 70.0)]]
    assert _seconds(windows) == [30.0, 30.0, 10.0]


def test_no_speech_no_windows():
    assert ld.speech_windows([]) == []


# --- choose ------------------------------------------------------------------

def test_a_confident_first_window_is_enough():
    calls = []

    def probs(window):
        calls.append(window)
        return {"ru": 0.95, "uk": 0.04, "en": 0.01}

    windows = ld.speech_windows([(45.0, 200.0)])
    det = ld.choose(windows, probs)
    assert len(calls) == 1
    assert (det.language, det.windows, det.speech_s) == ("ru", 1, 30.0)
    assert det.probability == pytest.approx(0.95)
    assert (det.start, det.end) == (45.0, 75.0)


def test_an_unsure_first_window_takes_more_windows_and_averages():
    answers = iter([
        {"uk": 0.55, "ru": 0.45},
        {"ru": 0.9, "uk": 0.1},
        {"ru": 0.8, "uk": 0.2},
    ])
    windows = ld.speech_windows([(0.0, 120.0)])
    det = ld.choose(windows, lambda _w: next(answers))
    assert det.language == "ru"
    assert det.windows == 3
    assert det.probability == pytest.approx((0.45 + 0.9 + 0.8) / 3)
    assert det.speech_s == 90.0
    assert (det.start, det.end) == (0.0, 120.0)


def test_average_weighs_windows_by_their_speech():
    # A 10 s last window counts a third of a 30 s one: unweighted, de would win
    # (0.55 against 0.45).
    windows = [[(0.0, 30.0)], [(30.0, 40.0)]]
    answers = iter([{"en": 0.6, "de": 0.4}, {"de": 0.7, "en": 0.3}])
    det = ld.choose(windows, lambda _w: next(answers))
    assert det.language == "en"
    assert det.probability == pytest.approx((0.6 * 30 + 0.3 * 10) / 40)


def test_the_threshold_is_the_configured_one():
    assert ld.CONFIDENT == 0.8
    windows = ld.speech_windows([(0.0, 120.0)])
    calls = []

    def at_threshold(window):
        calls.append(window)
        return {"en": 0.8, "de": 0.2}

    ld.choose(windows, at_threshold)
    assert len(calls) == 1


# --- the hook in WhisperX's pipeline -----------------------------------------

class _Vad:
    """Stands in for whisperx.vads.Pyannote: merge_chunks is a staticmethod."""

    chunks = []

    def __call__(self, _audio):
        return "scores"

    @staticmethod
    def preprocess_audio(audio):
        return audio

    @staticmethod
    def merge_chunks(_scores, _chunk_size, onset=0.5, offset=None):
        return _Vad.chunks


class _Pipeline:
    """The order of FasterWhisperPipeline.transcribe(): VAD, merge_chunks, then
    detect_language only when no language was given."""

    def __init__(self):
        self.vad_model = _Vad()
        self.original_calls = 0

    def detect_language(self, _audio):
        self.original_calls += 1
        return "en"

    def transcribe(self, audio, language=None):
        scores = self.vad_model(self.vad_model.preprocess_audio(audio))
        self.vad_model.merge_chunks(scores, 30, onset=0.5, offset=0.363)
        return {"language": language or self.detect_language(audio)}


def _audio(seconds=200):
    return np.zeros(seconds * SR, dtype=np.float32)


def test_detection_uses_the_speech_of_the_same_vad_pass():
    pipe = _Pipeline()
    _Vad.chunks = [{"start": 45.0, "end": 190.0, "segments": [(45.0, 190.0)]}]
    seen = []

    def probs(_audio, window):
        seen.append(window)
        return {"ru": 0.97, "en": 0.03}

    hook = ld.install(pipe, probs=probs)
    assert pipe.transcribe(_audio())["language"] == "ru"
    assert seen == [[(45.0, 75.0)]]
    assert pipe.original_calls == 0
    assert hook.last.language == "ru"


def test_no_speech_falls_back_to_whisperx_detection():
    pipe = _Pipeline()
    _Vad.chunks = []
    hook = ld.install(pipe, probs=lambda *_: pytest.fail("no speech, no window"))
    assert pipe.transcribe(_audio())["language"] == "en"
    assert pipe.original_calls == 1
    assert hook.last is None


def test_an_explicit_language_detects_nothing():
    pipe = _Pipeline()
    _Vad.chunks = [{"start": 0.0, "end": 60.0, "segments": [(0.0, 60.0)]}]
    hook = ld.install(pipe, probs=lambda *_: pytest.fail("language was given"))
    assert pipe.transcribe(_audio(), language="de")["language"] == "de"
    assert hook.last is None


def test_each_run_uses_its_own_speech():
    pipe = _Pipeline()
    answers = {45.0: {"ru": 0.9}, 5.0: {"en": 0.9}}
    hook = ld.install(pipe, probs=lambda _a, w: answers[w[0][0]])
    _Vad.chunks = [{"start": 45.0, "end": 100.0, "segments": [(45.0, 100.0)]}]
    assert pipe.transcribe(_audio())["language"] == "ru"
    _Vad.chunks = [{"start": 5.0, "end": 100.0, "segments": [(5.0, 100.0)]}]
    assert pipe.transcribe(_audio())["language"] == "en"
    # A run without a fresh VAD result does not reuse the previous one.
    hook.chunks = None
    pipe.original_calls = 0
    assert pipe.detect_language(_audio()) == "en"
    assert pipe.original_calls == 1


def test_the_original_detection_stays_reachable():
    pipe = _Pipeline()
    hook = ld.install(pipe, probs=lambda *_: {"ru": 1.0})
    assert hook.original(_audio()) == "en"
    assert pipe.original_calls == 1


def test_the_log_line_names_language_probability_speech_and_place():
    det = ld.Detection(language="ru", probability=0.973, speech_s=30.0, windows=1, start=42.0, end=190.5)
    assert ld.describe(det) == "Language: ru (0.97) from 30 s of speech in 1 window, speech 0:42–3:10"
    det2 = ld.Detection(language="en", probability=0.61, speech_s=70.0, windows=3, start=3725.0, end=3800.0)
    assert ld.describe(det2) == "Language: en (0.61) from 70 s of speech in 3 windows, speech 1:02:05–1:03:20"


def test_transcription_service_installs_the_hook(tmp_path):
    from unittest.mock import MagicMock, patch
    from app.services.transcription_service import TranscriptionService

    with patch("app.services.transcription_service.whisperx") as wx:
        wx.load_model.return_value = _Pipeline()
        svc = TranscriptionService(device="cpu", models_dir=tmp_path)
    assert isinstance(svc.language, ld.SpeechLanguage)
    assert svc.model.detect_language == svc.language.detect
