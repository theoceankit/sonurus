"""Runs the app's pipeline on the AMI set and scores it (tests/quality/).

One variant = one way the audio reaches the models (a source file of the set,
optionally levelled or with another VAD threshold). Its three clips are run
in order on one fresh speaker memory, as a user would: the first clip's
speakers are named after the reference (the editor's "assign to a new
speaker by name"), the next clips show whether they are recognised.
"""
import json
import os
import subprocess
import time
from contextlib import contextmanager
from dataclasses import dataclass
from pathlib import Path

import numpy as np

from tests.quality import metrics

CLIPS = ("es2002b", "es2002c", "es2002d")  # the first one is named, the others recognised
LONG_UTTERANCE = 3  # words; shorter ones are counted apart (backchannels)


def set_dir() -> Path:
    return Path(os.getenv("SONORUS_EVAL_CACHE", Path.home() / ".cache" / "sonorus-eval")) / "ami"


@dataclass(frozen=True)
class Variant:
    name: str
    source: str               # file in the clip folder
    level: bool = False       # dynaudnorm as the app levels system-audio tracks
    vad_onset: float | None = None
    base: str | None = None   # variant it is compared with; None = informative only
    what: str = ""


VARIANTS = [
    Variant("clean", "clean.wav", what="sum of the headsets"),
    Variant("clean+level", "clean.wav", level=True, base="clean",
            what="dynaudnorm on audio that needs none (levelling every import)"),
    Variant("call", "call.wav", what="call: a device per participant"),
    Variant("call+level", "call.wav", level=True, base="call", what="dynaudnorm on the call"),
    Variant("call+vad0.3", "call.wav", vad_onset=0.3, base="call", what="VAD onset 0.3 instead of 0.5"),
    Variant("chromium-raw", "chromium-raw.webm", base="call",
            what="call recorded by Chromium, processing off: MediaRecorder Opus only"),
    Variant("chromium-default", "chromium-default.webm", base="chromium-raw",
            what="call recorded by Chromium as the app does: echo cancellation, noise suppression, AGC"),
    Variant("uneven", "uneven.wav", what="clean with one participant 20 dB down"),
    Variant("uneven+level", "uneven.wav", level=True, base="uneven", what="dynaudnorm on uneven"),
]
BY_NAME = {v.name: v for v in VARIANTS}


class Pipeline:
    """The app's services, loaded once: TranscriptionController as the queue's child runs it."""

    def __init__(self, models_dir: Path):
        os.environ.setdefault("HF_HUB_OFFLINE", "1")  # as the pipeline child: local models only
        from app.config import DEVICE
        from app.services.embedding_service import EmbeddingService
        from app.services.transcription_service import TranscriptionService

        self.device = DEVICE
        self.transcription = TranscriptionService(DEVICE, models_dir)
        self.embedding = EmbeddingService(DEVICE, models_dir=models_dir)

    def run(self, audio: Path, memory):
        from app.controllers.transcription_controller import TranscriptionController
        controller = TranscriptionController(
            transcription_service=self.transcription,
            embedding_service=self.embedding,
            memory_service=memory,
        )
        return controller.run_pipeline(str(audio))

    @contextmanager
    def vad_onset(self, onset: float | None):
        """WhisperX binarises the VAD scores with these at every transcribe() call."""
        params = self.transcription.model._vad_params
        saved = dict(params)
        if onset is not None:
            params["vad_onset"] = onset
        try:
            yield
        finally:
            params.clear()
            params.update(saved)


def load_audio(path: Path) -> np.ndarray:
    import whisperx
    return whisperx.load_audio(str(path))


def prepare(variant: Variant, clip: str, work: Path) -> Path:
    src = set_dir() / clip / variant.source
    if not variant.level:
        return src
    from app.services.audio_capture_service import _LEVEL_FILTER
    out = work / f"{clip}.{variant.name}.wav"
    subprocess.run(["ffmpeg", "-y", "-nostdin", "-loglevel", "error", "-i", str(src),
                    "-af", _LEVEL_FILTER, str(out)], check=True)
    return out


def effective_speaker(seg) -> str | None:
    if seg.unassigned:
        return None
    return seg.speaker_final or seg.speaker_resolved or seg.speaker_raw


def _speaker_embeddings(transcript, hyp_to_ref) -> dict[str, np.ndarray]:
    """Mean segment embedding per reference speaker, from the hyp speaker mapped to them."""
    out = {}
    for hyp, ref in hyp_to_ref.items():
        embs = [s.embedding for s in transcript.segments
                if effective_speaker(s) == hyp and s.embedding is not None]
        if ref and embs:
            out[ref] = np.mean(np.stack(embs), axis=0)
    return out


def evaluate(pipeline: Pipeline, variant: Variant, work: Path) -> dict:
    """Run the variant's clips on a fresh memory; per-clip scores and totals."""
    from app.api.routers.transcripts import reassign_speaker
    from app.api.schemas import ReassignRequest
    from app.services.commit_service import CommitService
    from app.services.speaker_memory_service import SpeakerMemoryService
    from app.services.transcript_storage_service import TranscriptStorageService

    work.mkdir(parents=True, exist_ok=True)
    db = str(work / f"{variant.name}.db")
    memory, storage = SpeakerMemoryService(db_path=db), TranscriptStorageService(db_path=db)
    named: dict[str, str] = {}  # reference speaker → speaker id created by naming
    clips = []

    for k, clip in enumerate(CLIPS):
        ref_json = json.loads((set_dir() / clip / "ref.json").read_text())
        audio_path = prepare(variant, clip, work)
        audio = load_audio(audio_path)
        lag = 0.0
        if audio_path.suffix == ".webm":
            lag = metrics.estimate_lag(load_audio(set_dir() / clip / "call.wav"), audio, 16000)

        started = time.monotonic()
        with pipeline.vad_onset(variant.vad_onset):
            transcript = pipeline.run(audio_path, memory)
        seconds = time.monotonic() - started

        ref = metrics.ref_words(ref_json["words"])
        hyp = metrics.shift_words(metrics.segment_words(
            [(effective_speaker(s), s.start, s.end, s.text) for s in transcript.segments]), -lag)
        w = metrics.wer([x.text for x in ref], [x.text for x in hyp])
        hyp_to_ref = metrics.map_speakers(metrics.turns(ref), metrics.turns(hyp))
        # Utterances of 1–2 words are mostly backchannels ("yeah", "okay") over
        # someone else's speech, which Whisper tends to leave out; they are
        # counted apart so that lost sentences stand out.
        utts = metrics.utterances(ref)
        missed_all = metrics.missed_utterances(ref, hyp, utts)
        long_utts = [u for u in utts if len(u.words) >= LONG_UTTERANCE]
        missed = [u for u in missed_all if len(u.words) >= LONG_UTTERANCE]

        def level(u):
            a, b = int((u.start + lag) * 16000), int((u.end + lag) * 16000)
            return metrics.rms_dbfs(audio[max(0, a):max(0, b)])

        row = {
            "variant": variant.name, "clip": clip, "language": transcript.language,
            "wer": w.wer, "errors": w.errors, "ref_words": w.ref_words,
            "sub": w.substitutions, "del": w.deletions, "ins": w.insertions,
            "ref_speakers": len(ref_json["speakers"]),
            "hyp_speakers": len({s for s in hyp_to_ref}),
            "speaker_acc": metrics.speaker_accuracy(ref, hyp, hyp_to_ref),
            "recall_by_speaker": metrics.speaker_recall(ref, hyp),
            "utterances": len(long_utts), "missed": len(missed),
            "short": len(utts) - len(long_utts), "missed_short": len(missed_all) - len(missed),
            "missed_level": [round(level(u), 1) for u in missed],
            "found_level_median": float(np.median([level(u) for u in long_utts if u not in missed] or [np.nan])),
            "missed_text": [" ".join(x.text for x in u.words) for u in missed],
            "lag": lag, "seconds": seconds,
        }

        storage.save(transcript)
        if k == 0:
            # The editor's "assign to a new speaker by name", for every diarised speaker.
            for hyp_id, ref_name in hyp_to_ref.items():
                if ref_name:
                    reassign_speaker(transcript.db_id, ReassignRequest(
                        from_speaker_id=hyp_id, to_speaker_name=ref_name), storage, memory)
                    named[ref_name] = next(i for i in memory.speaker_ids() if memory.get_name(i) == ref_name)
        else:
            hyp_to_known = {h: memory.get_name(h) for h in hyp_to_ref}
            rec = metrics.recognition(hyp_to_ref, hyp_to_known)
            # Similarity of each person's voice here to their own profile and,
            # for comparison, the highest one to someone else's profile.
            profiles = {n: memory.known_speakers[i] for n, i in named.items() if i in memory.known_speakers}
            own, other = [], []
            for ref_name, emb in _speaker_embeddings(transcript, hyp_to_ref).items():
                if ref_name in profiles:
                    own.append(metrics.cosine(emb, profiles[ref_name]))
                    other.append(max((metrics.cosine(emb, p) for n, p in profiles.items() if n != ref_name),
                                     default=float("nan")))
            row.update(recognised=rec.correct, wrong=rec.wrong, new=rec.new,
                       similarity=float(np.mean(own)) if own else float("nan"),
                       other_similarity=float(np.nanmean(other)) if other else float("nan"))
            # as the queue does after every job
            CommitService(memory, storage).commit_recognized_speakers(transcript)
        clips.append(row)

    total_ref = sum(c["ref_words"] for c in clips)
    later = clips[1:]
    return {
        "variant": variant.name,
        "clips": clips,
        "wer": sum(c["errors"] for c in clips) / total_ref,
        "speaker_acc": float(np.mean([c["speaker_acc"] for c in clips])),
        "missed": sum(c["missed"] for c in clips),
        "utterances": sum(c["utterances"] for c in clips),
        "missed_short": sum(c["missed_short"] for c in clips),
        "short": sum(c["short"] for c in clips),
        "recognised": sum(c["recognised"] for c in later),
        "named_total": sum(c["recognised"] + c["wrong"] + c["new"] for c in later),
        "similarity": float(np.nanmean([c["similarity"] for c in later])),
        "other_similarity": float(np.nanmean([c["other_similarity"] for c in later])),
        "recall_by_speaker": {
            spk: float(np.mean([c["recall_by_speaker"][spk] for c in clips if spk in c["recall_by_speaker"]]))
            for spk in sorted({s for c in clips for s in c["recall_by_speaker"]})
        },
    }
