"""A possible match stays out of the speaker's voice profile until the user
confirms it: an unconfirmed guess must not change speaker memory."""
import sqlite3

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

_ALICE = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"


def _unit(*v):
    a = np.array(v, dtype=np.float32)
    return a / np.linalg.norm(a)


def _at_cosine(cos):
    """A unit vector whose cosine similarity to (1, 0, 0) is cos."""
    return _unit(cos, float(np.sqrt(1 - cos * cos)), 0.0)


OWN = _unit(1.0, 0.0, 0.0)        # Alice's own recording
GUESS = _at_cosine(0.65)           # someone recognized as Alice at 0.65


def _services(tmp_path):
    db = str(tmp_path / "app.db")
    memory = SpeakerMemoryService(db_path=db)
    storage = TranscriptStorageService(db_path=db)
    return memory, storage, CommitService(memory, storage)


def _transcript(voice, score=None, speaker=_ALICE, audio="a.wav"):
    seg = Segment(0.0, 2.0, "x", "SPEAKER_00", speaker_resolved=speaker, embedding=voice)
    return Transcript(audio_path=audio, language="en", segments=[seg],
                      match_scores={} if score is None else {speaker: score})


def _alice(tmp_path, named=True):
    """Alice with a profile from her own recording, then a recording where she
    was recognized with a low similarity. Returns services and its id."""
    memory, storage, commit = _services(tmp_path)
    storage.save(_transcript(OWN, audio="own.wav"))
    if named:
        memory.set_name(_ALICE, "Alice")
    commit.commit_speaker(_ALICE)
    assert memory.known_speakers[_ALICE] == pytest.approx(OWN)
    guess = _transcript(GUESS, score=0.65, audio="guess.wav")
    storage.save(guess)
    return memory, storage, commit, guess


def _mixed():
    return _unit(*(OWN + GUESS))


# ── Kept out until confirmed ──────────────────────────────────────────────────

def test_the_job_commit_leaves_an_unconfirmed_possible_match_out(tmp_path):
    memory, _, commit, guess = _alice(tmp_path)
    commit.commit_recognized_speakers(guess)
    assert memory.known_speakers[_ALICE] == pytest.approx(OWN)


def test_a_later_recompute_leaves_it_out_too(tmp_path):
    memory, _, commit, guess = _alice(tmp_path)
    commit.commit_recognized_speakers(guess)
    commit.commit_speaker(_ALICE)
    commit.recompute_or_remove(_ALICE)
    assert memory.known_speakers[_ALICE] == pytest.approx(OWN)


def test_saved_memory_has_no_trace_of_it(tmp_path):
    memory, storage, commit, guess = _alice(tmp_path)
    commit.commit_recognized_speakers(guess)
    assert SpeakerMemoryService(db_path=storage.db_path).known_speakers[_ALICE] == pytest.approx(OWN, abs=1e-6)


def test_a_match_at_the_ceiling_goes_in_at_once(tmp_path):
    memory, storage, commit = _services(tmp_path)
    storage.save(_transcript(OWN, audio="own.wav"))
    memory.set_name(_ALICE, "Alice")
    commit.commit_speaker(_ALICE)
    sure = _transcript(GUESS, score=0.7, audio="sure.wav")
    storage.save(sure)
    commit.commit_recognized_speakers(sure)
    assert memory.known_speakers[_ALICE] == pytest.approx(_mixed())


def test_an_unnamed_speaker_takes_a_low_match_as_before(tmp_path):
    # Nothing asks the user to confirm a speaker without a name.
    memory, _, commit, guess = _alice(tmp_path, named=False)
    commit.commit_recognized_speakers(guess)
    assert memory.known_speakers[_ALICE] == pytest.approx(_mixed())


def test_naming_the_speaker_takes_their_low_matches_out(tmp_path):
    memory, _, commit, guess = _alice(tmp_path, named=False)
    commit.commit_recognized_speakers(guess)
    memory.set_name(_ALICE, "Alice")
    memory.save()
    commit.commit_speaker(_ALICE)
    assert memory.known_speakers[_ALICE] == pytest.approx(OWN)


# ── Confirm and undo ──────────────────────────────────────────────────────────

def test_confirming_puts_the_recording_in_the_profile(tmp_path):
    memory, storage, commit, guess = _alice(tmp_path)
    commit.commit_recognized_speakers(guess)
    assert commit.confirm_match(guess.db_id, _ALICE, True) is True
    assert memory.known_speakers[_ALICE] == pytest.approx(_mixed())
    assert storage.speaker_matches(guess.db_id)[_ALICE]["confirmed"] is True


def test_undoing_the_confirmation_takes_it_out_again(tmp_path):
    memory, _, commit, guess = _alice(tmp_path)
    commit.confirm_match(guess.db_id, _ALICE, True)
    assert commit.confirm_match(guess.db_id, _ALICE, False) is True
    assert memory.known_speakers[_ALICE] == pytest.approx(OWN)


def test_confirming_without_a_match_is_false_and_leaves_memory(tmp_path):
    memory, storage, commit = _services(tmp_path)
    db_id = storage.save(_transcript(OWN))
    memory.set_name(_ALICE, "Alice")
    commit.commit_speaker(_ALICE)
    assert commit.confirm_match(db_id, _ALICE, True) is False
    assert memory.known_speakers[_ALICE] == pytest.approx(OWN)


def test_rejecting_by_assigning_someone_else_leaves_the_profile(tmp_path):
    memory, storage, commit, guess = _alice(tmp_path)
    carol = memory.create_named_speaker("Carol")
    commit.commit_recognized_speakers(guess)
    storage.set_segments_speaker(guess.db_id, [(0.0, 2.0)], carol)
    commit.commit_speaker(carol)
    commit.recompute_or_remove(_ALICE)
    assert memory.known_speakers[_ALICE] == pytest.approx(OWN)
    assert memory.known_speakers[carol] == pytest.approx(GUESS)


def test_merging_keeps_an_unconfirmed_match_out(tmp_path):
    memory, storage, commit, guess = _alice(tmp_path)
    bob = memory.create_named_speaker("Bob")
    commit.merge_speaker(bob, _ALICE)
    assert memory.known_speakers[_ALICE] == pytest.approx(OWN)


# ── Profiles made before ──────────────────────────────────────────────────────

def test_profiles_with_an_unconfirmed_match_in_them_are_recomputed_once(tmp_path):
    memory, storage, commit, guess = _alice(tmp_path)
    # As the previous version left it: the guess in the profile.
    memory.update_embedding(_ALICE, _mixed())
    memory.save()
    with sqlite3.connect(storage.db_path) as conn:
        conn.execute("INSERT OR REPLACE INTO _meta (key, value) VALUES ('voice_averaging', 'unit-duration-weighted')")
    memory = SpeakerMemoryService(db_path=storage.db_path)
    assert CommitService(memory, storage).recompute_outdated_profiles() == 1
    assert memory.known_speakers[_ALICE] == pytest.approx(OWN)


# ── API ───────────────────────────────────────────────────────────────────────

@pytest.fixture
def client(tmp_path):
    db = str(tmp_path / "app.db")
    app.dependency_overrides[get_storage_service] = lambda: TranscriptStorageService(db_path=db)
    app.dependency_overrides[get_memory_service] = lambda: SpeakerMemoryService(db_path=db)
    yield TestClient(app), db
    app.dependency_overrides.clear()


def _stored_profile(db):
    return SpeakerMemoryService(db_path=db).known_speakers[_ALICE]


def test_confirm_and_undo_routes_change_the_profile(client, tmp_path):
    client, db = client
    _, _, _, guess = _alice(tmp_path)
    url = f"/transcripts/{guess.db_id}/possible-matches/{_ALICE}/confirmed"

    assert client.post(url).status_code == 204
    assert _stored_profile(db) == pytest.approx(_mixed(), abs=1e-6)

    assert client.delete(url).status_code == 204
    assert _stored_profile(db) == pytest.approx(OWN, abs=1e-6)
