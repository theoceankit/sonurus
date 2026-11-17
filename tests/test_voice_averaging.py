"""One definition of a voice: the mean of embeddings scaled to length 1,
weighted by how long each one speaks. Used for the voice resolve() compares,
for a profile's per-recording centroid and for a voice's
candidates. Profiles of a database averaged the previous way are recomputed
once, when the backend starts."""
import sqlite3

import numpy as np
import pytest

from app.config import VOICE_AVERAGING_ID
from app.models.segment import Segment
from app.models.transcript import Transcript
from app.services.commit_service import CommitService
from app.services.speaker_memory_service import SpeakerMemoryService
from app.services.transcript_storage_service import TranscriptStorageService
from app.services.voice_vector import voice_vector


def _v(*xs):
    return np.array(xs, dtype=np.float32)


def _unit(v):
    v = np.asarray(v, dtype=float)
    return v / np.linalg.norm(v)


# ── voice_vector ─────────────────────────────────────────────────────────────

def test_voice_is_the_duration_weighted_mean_of_unit_embeddings():
    voice = voice_vector([_v(2, 0), _v(0, 1)], [1.0, 3.0])
    assert voice == pytest.approx(_unit([0.25, 0.75]))


def test_the_length_of_an_embedding_does_not_weigh():
    assert voice_vector([_v(10, 0), _v(0, 1)], [2.0, 2.0]) == pytest.approx(_unit([1, 1]))


def test_without_durations_every_embedding_weighs_the_same():
    assert voice_vector([_v(3, 0), _v(0, 1)]) == pytest.approx(_unit([1, 1]))
    assert voice_vector([_v(3, 0), _v(0, 1)], [0.0, 0.0]) == pytest.approx(_unit([1, 1]))


def test_a_negative_duration_counts_as_none():
    assert voice_vector([_v(1, 0), _v(0, 1)], [-1.0, 2.0]) == pytest.approx([0.0, 1.0])


def test_voice_of_nothing_is_none():
    assert voice_vector([], []) is None


def test_opposite_embeddings_give_a_zero_voice():
    assert voice_vector([_v(1, 0), _v(-2, 0)], [1.0, 1.0]).tolist() == [0.0, 0.0]


# ── profiles ─────────────────────────────────────────────────────────────────

def _services(tmp_path):
    db = str(tmp_path / "app.db")
    memory = SpeakerMemoryService(db_path=db)
    storage = TranscriptStorageService(db_path=db)
    return db, memory, storage, CommitService(memory, storage)


def _seg(start, end, spk, emb):
    seg = Segment(start, end, "words", "SPEAKER_00", speaker_resolved=spk, embedding=emb)
    seg.speaker_final = spk
    return seg


def _save(storage, segments, audio="files/a.wav"):
    return storage.save(Transcript(audio_path=audio, language="en", segments=segments))


SPK = "11111111-1111-4111-8111-111111111111"


def test_a_profile_weighs_segments_by_their_duration(tmp_path):
    _, memory, storage, commit = _services(tmp_path)
    _save(storage, [_seg(0.0, 1.0, SPK, _v(3, 0, 0)), _seg(1.0, 4.0, SPK, _v(0, 1, 0))])
    commit.commit_speaker(SPK)
    assert memory.known_speakers[SPK] == pytest.approx(_unit([0.25, 0.75, 0]))


def test_a_turn_split_into_segments_weighs_as_the_turn(tmp_path):
    # One 4 s turn in two sentences against one 4 s turn in one sentence.
    _, memory, storage, commit = _services(tmp_path)
    _save(storage, [_seg(0.0, 1.0, SPK, _v(1, 0, 0)), _seg(1.0, 4.0, SPK, _v(1, 0, 0)),
                    _seg(4.0, 8.0, SPK, _v(0, 1, 0))])
    commit.commit_speaker(SPK)
    assert memory.known_speakers[SPK] == pytest.approx(_unit([1, 1, 0]))


def test_recordings_still_weigh_the_same(tmp_path):
    _, memory, storage, commit = _services(tmp_path)
    _save(storage, [_seg(0.0, 1.0, SPK, _v(1, 0, 0))], audio="files/a.wav")
    _save(storage, [_seg(0.0, 60.0, SPK, _v(0, 1, 0))], audio="files/b.wav")
    commit.commit(Transcript(audio_path="files/b.wav", segments=[_seg(0.0, 60.0, SPK, _v(0, 1, 0))]))
    assert memory.known_speakers[SPK] == pytest.approx(_unit([1, 1, 0]))


def test_storage_gives_segment_durations_with_the_embeddings(tmp_path):
    _, _, storage, _ = _services(tmp_path)
    tid = _save(storage, [_seg(0.5, 2.0, SPK, _v(1, 0, 0)), _seg(2.0, 2.0, SPK, _v(0, 1, 0))])
    grouped = storage.get_embeddings_grouped_by_transcript(SPK, with_durations=True)
    assert list(grouped) == [tid]
    (e1, d1), (e2, d2) = grouped[tid]
    assert e1.tolist() == [1, 0, 0] and d1 == pytest.approx(1.5)
    assert e2.tolist() == [0, 1, 0] and d2 == 0.0


# ── recompute after the update ───────────────────────────────────────────────

def _meta(db, key="voice_averaging"):
    with sqlite3.connect(db) as conn:
        row = conn.execute("SELECT value FROM _meta WHERE key = ?", (key,)).fetchone()
    return row[0] if row else None


def _old_db(tmp_path):
    """A database as the previous version left it: profiles the plain mean of
    segment embeddings, no averaging mark."""
    db, memory, storage, _ = _services(tmp_path)
    _save(storage, [_seg(0.0, 1.0, SPK, _v(3, 0, 0)), _seg(1.0, 4.0, SPK, _v(0, 1, 0))])
    memory.update_embedding(SPK, _v(3, 1, 0))  # the old plain mean, normalised on update
    memory.set_name(SPK, "Alice")
    memory.save()
    with sqlite3.connect(db) as conn:
        conn.execute("DELETE FROM _meta WHERE key = 'voice_averaging'")
    return db


def test_profiles_averaged_the_old_way_are_recomputed_once(tmp_path):
    db = _old_db(tmp_path)
    memory = SpeakerMemoryService(db_path=db)
    commit = CommitService(memory, TranscriptStorageService(db_path=db))
    assert memory.voice_averaging() is None

    assert commit.recompute_outdated_profiles() == 1
    expected = _unit([0.25, 0.75, 0])
    assert memory.known_speakers[SPK] == pytest.approx(expected)
    assert _meta(db) == VOICE_AVERAGING_ID
    # Saved: a new instance (the next start) reads the new profile.
    assert SpeakerMemoryService(db_path=db).known_speakers[SPK] == pytest.approx(expected, abs=1e-6)

    # Marked: a second start leaves profiles alone, even a changed one.
    memory.update_embedding(SPK, _v(0, 0, 1))
    assert commit.recompute_outdated_profiles() == 0
    assert memory.known_speakers[SPK] == pytest.approx([0, 0, 1])


def test_recompute_keeps_names_and_counts_what_it_used(tmp_path):
    db = _old_db(tmp_path)
    memory = SpeakerMemoryService(db_path=db)
    CommitService(memory, TranscriptStorageService(db_path=db)).recompute_outdated_profiles()
    assert memory.get_name(SPK) == "Alice"
    assert memory.known_counts[SPK] == 2


def test_recompute_takes_a_recording_far_from_the_stored_profile(tmp_path):
    # The stored profile no longer decides which recordings count.
    db = _old_db(tmp_path)
    storage = TranscriptStorageService(db_path=db)
    _save(storage, [_seg(0.0, 10.0, SPK, _v(0, 0, 1))], audio="files/far.wav")
    memory = SpeakerMemoryService(db_path=db)
    CommitService(memory, storage).recompute_outdated_profiles()
    assert memory.known_speakers[SPK] == pytest.approx(_unit(_unit([0.25, 0.75, 0]) + _v(0, 0, 1)))


def test_profiles_kept_by_the_old_guard_are_recomputed_once(tmp_path):
    # A database whose profiles were averaged with the guard: the mark is the
    # previous one, so the next start recomputes them without it.
    db, memory, storage, commit = _services(tmp_path)
    _save(storage, [_seg(0.0, 1.0, SPK, _v(1, 0, 0))], audio="files/a.wav")
    _save(storage, [_seg(0.0, 1.0, SPK, _v(0, 0, 1))], audio="files/far.wav")
    memory.update_embedding(SPK, _v(1, 0, 0))
    memory.save()
    memory.set_voice_averaging("unit-duration-weighted-confirmed")
    assert commit.recompute_outdated_profiles() == 1
    assert memory.known_speakers[SPK] == pytest.approx(_unit([1, 0, 1]))


def test_a_profile_with_nothing_to_recompute_from_stays(tmp_path):
    db = _old_db(tmp_path)
    other = "22222222-2222-4222-8222-222222222222"
    memory = SpeakerMemoryService(db_path=db)
    memory.update_embedding(other, _v(0, 0, 1))
    memory.save()
    CommitService(memory, TranscriptStorageService(db_path=db)).recompute_outdated_profiles()
    assert memory.known_speakers[other] == pytest.approx([0, 0, 1])
    assert _meta(db) == VOICE_AVERAGING_ID


def test_an_empty_memory_is_just_marked(tmp_path):
    db, memory, _, commit = _services(tmp_path)
    assert commit.recompute_outdated_profiles() == 0
    assert _meta(db) == VOICE_AVERAGING_ID


def test_the_backend_recomputes_outdated_profiles_before_the_queue_starts(tmp_path, monkeypatch):
    from fastapi.testclient import TestClient

    import app.api.main as main_module
    import app.config as config
    from app.api.main import app

    db = _old_db(tmp_path)
    memory = SpeakerMemoryService(db_path=db)
    storage = TranscriptStorageService(db_path=db)
    started = []

    class Queue:
        def audio_paths(self):
            return set()

        def start_worker(self):
            started.append(_meta(db))

        def stop_worker(self):
            pass

    monkeypatch.setattr(config, "RECORDINGS_DIR", tmp_path / "recordings")
    monkeypatch.setattr(config, "SPEAKER_PHOTOS_DIR", tmp_path / "photos")
    monkeypatch.setattr(main_module, "get_storage_service", lambda: storage)
    monkeypatch.setattr(main_module, "get_memory_service", lambda: memory)
    monkeypatch.setattr(main_module, "get_transcription_queue", lambda: Queue())
    monkeypatch.setattr(main_module.models, "shutdown_executor", lambda: None)

    with TestClient(app):
        pass

    assert started == [VOICE_AVERAGING_ID]
    assert memory.known_speakers[SPK] == pytest.approx(_unit([0.25, 0.75, 0]))


def test_a_failed_recompute_does_not_stop_the_backend(tmp_path, monkeypatch):
    from fastapi.testclient import TestClient

    import app.api.main as main_module
    import app.config as config
    from app.api.main import app

    db = _old_db(tmp_path)
    started = []

    class Queue:
        def audio_paths(self):
            return set()

        def start_worker(self):
            started.append(True)

        def stop_worker(self):
            pass

    def broken(self):
        raise RuntimeError("disk full")

    monkeypatch.setattr(CommitService, "recompute_outdated_profiles", broken)
    monkeypatch.setattr(config, "RECORDINGS_DIR", tmp_path / "recordings")
    monkeypatch.setattr(config, "SPEAKER_PHOTOS_DIR", tmp_path / "photos")
    monkeypatch.setattr(main_module, "get_storage_service", lambda: TranscriptStorageService(db_path=db))
    monkeypatch.setattr(main_module, "get_memory_service", lambda: SpeakerMemoryService(db_path=db))
    monkeypatch.setattr(main_module, "get_transcription_queue", lambda: Queue())
    monkeypatch.setattr(main_module.models, "shutdown_executor", lambda: None)

    with TestClient(app):
        pass

    assert started == [True]
    assert _meta(db) is None, "not marked: the next start tries again"
