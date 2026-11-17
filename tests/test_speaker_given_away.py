"""A voice profile is the mean of the speaker's recordings in the database and
nothing else: segments given to someone else take their voice with them, and
the stored profile never decides what goes into the next one."""
import numpy as np
import pytest
from fastapi.testclient import TestClient

from app.api.dependencies import get_memory_service, get_storage_service
from app.api.main import app
from app.models.segment import Segment
from app.models.transcript import Transcript
from app.services.commit_service import CommitService
from app.services.speaker_memory_service import SpeakerMemoryService
from app.services.transcript_storage_service import TranscriptStorageService


def _unit(*v):
    a = np.array(v, dtype=np.float32)
    return a / np.linalg.norm(a)


ALEX = _unit(1.0, 0.0, 0.0)
BOB = _unit(0.0, 1.0, 0.0)
FAR = _unit(0.0, 0.0, 1.0)


@pytest.fixture
def api(tmp_path):
    db = str(tmp_path / "app.db")
    app.dependency_overrides[get_storage_service] = lambda: TranscriptStorageService(db_path=db)
    app.dependency_overrides[get_memory_service] = lambda: SpeakerMemoryService(db_path=db)
    yield TestClient(app), db
    app.dependency_overrides.clear()


def _services(db):
    memory = SpeakerMemoryService(db_path=db)
    storage = TranscriptStorageService(db_path=db)
    return memory, storage, CommitService(memory, storage)


def _recording(storage, speaker, voice, audio, n=2):
    return storage.save(Transcript(audio_path=audio, language="en", segments=[
        Segment(float(i), i + 1.0, f"Text {i}", "SPEAKER_00", speaker_resolved=speaker, embedding=voice)
        for i in range(n)
    ]))


def _named_with_profile(db, name, voice, audio):
    memory, storage, commit = _services(db)
    spk = memory.create_named_speaker(name)
    tid = _recording(storage, spk, voice, audio)
    commit.commit_speaker(spk)
    return spk, tid


def _give(client, tid, starts, speaker_id):
    r = client.post(f"/transcripts/{tid}/speaker-assignments",
                    json={"segment_starts": starts, "speaker_id": speaker_id})
    assert r.status_code == 200, r.text


# ── Given away ───────────────────────────────────────────────────────────────

def test_a_named_speaker_whose_segments_all_went_to_another_loses_the_voice(api):
    client, db = api
    alex, tid = _named_with_profile(db, "Alex", ALEX, "a.wav")
    bob = SpeakerMemoryService(db_path=db).create_named_speaker("Bob")

    _give(client, tid, [0.0, 1.0], bob)

    memory = SpeakerMemoryService(db_path=db)
    assert alex not in memory.known_speakers
    assert memory.get_name(alex) == "Alex"
    assert memory.known_speakers[bob] == pytest.approx(ALEX, abs=1e-6)


def test_a_profile_built_from_someone_else_is_rebuilt_from_what_remains(api):
    # Alice was named on a recording that is really Bob; her own recording came later.
    client, db = api
    alice, wrong = _named_with_profile(db, "Alice", BOB, "wrong.wav")
    memory, storage, commit = _services(db)
    _recording(storage, alice, ALEX, "own.wav")
    commit.commit_speaker(alice)
    bob = memory.create_named_speaker("Bob")

    _give(client, wrong, [0.0, 1.0], bob)

    assert SpeakerMemoryService(db_path=db).known_speakers[alice] == pytest.approx(ALEX, abs=1e-6)


def test_giving_away_part_of_a_recording_keeps_the_voice(api):
    client, db = api
    memory, storage, commit = _services(db)
    alex = memory.create_named_speaker("Alex")
    tid = _recording(storage, alex, ALEX, "a.wav", n=3)
    commit.commit_speaker(alex)
    bob = memory.create_named_speaker("Bob")

    _give(client, tid, [0.0], bob)

    assert SpeakerMemoryService(db_path=db).known_speakers[alex] == pytest.approx(ALEX, abs=1e-6)


# ── Deleted ──────────────────────────────────────────────────────────────────

def test_deleting_the_only_recording_of_a_named_speaker_keeps_the_voice(api):
    client, db = api
    alex, tid = _named_with_profile(db, "Alex", ALEX, "a.wav")

    assert client.delete(f"/transcripts/{tid}").status_code == 204

    assert SpeakerMemoryService(db_path=db).known_speakers[alex] == pytest.approx(ALEX, abs=1e-6)


# ── The stored profile does not decide ───────────────────────────────────────

def test_a_far_recording_counts_like_any_other(tmp_path):
    db = str(tmp_path / "app.db")
    alex, _ = _named_with_profile(db, "Alex", ALEX, "a.wav")
    memory, storage, commit = _services(db)
    _recording(storage, alex, FAR, "far.wav")

    commit.commit_speaker(alex)

    assert memory.known_speakers[alex] == pytest.approx(_unit(1.0, 0.0, 1.0), abs=1e-6)


@pytest.mark.parametrize("recompute", ["commit_speaker", "recompute_or_remove"])
def test_recomputing_twice_gives_the_same_profile(tmp_path, recompute):
    # Three recordings, one of them between the other two: whatever the stored
    # profile was, the result is the mean of the three.
    db = str(tmp_path / "app.db")
    alex, _ = _named_with_profile(db, "Alex", ALEX, "a.wav")
    memory, storage, commit = _services(db)
    _recording(storage, alex, _unit(1.0, 1.0, 0.0), "b.wav")
    _recording(storage, alex, BOB, "c.wav")
    expected = _unit(*(ALEX + _unit(1.0, 1.0, 0.0) + BOB))

    getattr(commit, recompute)(alex)
    first = memory.known_speakers[alex].copy()
    getattr(commit, recompute)(alex)

    assert first == pytest.approx(expected, abs=1e-6)
    assert memory.known_speakers[alex] == pytest.approx(expected, abs=1e-6)


def test_the_job_commit_takes_a_far_recording_too(tmp_path):
    db = str(tmp_path / "app.db")
    alex, _ = _named_with_profile(db, "Alex", ALEX, "a.wav")
    memory, storage, commit = _services(db)
    tid = _recording(storage, alex, FAR, "far.wav")

    commit.commit_recognized_speakers(storage.load(tid))

    assert memory.known_speakers[alex] == pytest.approx(_unit(1.0, 0.0, 1.0), abs=1e-6)
