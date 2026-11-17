"""Possible match: a speaker recognized with a low similarity waits for the user
to confirm them. The similarity is kept when the speaker is recognized."""
import sqlite3
from unittest.mock import MagicMock, patch

import numpy as np
import pytest
from fastapi.testclient import TestClient

from app.api.dependencies import get_memory_service, get_storage_service
from app.api.main import app
from app.models.segment import Segment
from app.models.transcript import Transcript
from app.services.speaker_memory_service import SpeakerMemoryService, _resolve_speakers
from app.services.transcript_storage_service import TranscriptStorageService

_ALICE = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
_BOB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
_CAROL = "cccccccc-cccc-4ccc-8ccc-cccccccccccc"
_DAN = "dddddddd-dddd-4ddd-8ddd-dddddddddddd"


def _emb(*v):
    a = np.array(v, dtype=np.float32)
    return a / np.linalg.norm(a)


def _at_cosine(cos):
    """A unit vector whose cosine similarity to (1, 0, 0) is cos."""
    return _emb(cos, float(np.sqrt(1 - cos * cos)), 0.0)


VOICE = _emb(1.0, 0.0, 0.0)


# ── Resolve keeps the similarity ──────────────────────────────────────────────

def test_resolve_with_scores_gives_the_similarity_of_each_match(tmp_path):
    memory = SpeakerMemoryService(db_path=str(tmp_path / "m.db"))
    memory.update_embedding(_ALICE, _at_cosine(0.65))
    mapping, scores = memory.resolve_with_scores({"SPEAKER_00": VOICE, "SPEAKER_01": _emb(0.0, 0.0, 1.0)})
    assert mapping["SPEAKER_00"] == _ALICE
    assert mapping["SPEAKER_01"] != _ALICE
    assert scores == {_ALICE: pytest.approx(0.65, abs=1e-4)}


def test_resolve_with_scores_gives_the_same_mapping_as_resolve():
    known = {_ALICE: _at_cosine(0.9), _CAROL: _emb(0.0, 1.0, 0.0)}
    new = {"SPEAKER_00": VOICE, "SPEAKER_01": _emb(0.0, 1.0, 0.0)}
    mapping, _ = _resolve_speakers(new, known, 0.6, with_scores=True)
    assert mapping == _resolve_speakers(new, known, 0.6)


def test_resolve_with_scores_does_not_change_known_speakers(tmp_path):
    memory = SpeakerMemoryService(db_path=str(tmp_path / "m.db"))
    memory.update_embedding(_ALICE, _at_cosine(0.65))
    before = {k: v.copy() for k, v in memory.known_speakers.items()}
    memory.resolve_with_scores({"SPEAKER_00": VOICE})
    assert memory.known_speakers.keys() == before.keys()
    assert np.array_equal(memory.known_speakers[_ALICE], before[_ALICE])


def test_pipeline_puts_the_match_scores_on_the_transcript():
    from app.controllers.transcription_controller import TranscriptionController

    transcription = MagicMock()
    transcription.transcribe.return_value = (
        {"segments": [{"start": 0.0, "end": 1.0, "text": "hi", "speaker": "SPEAKER_00"}], "language": "en"},
        MagicMock(), MagicMock(),
    )
    embedding = MagicMock()
    embedding.extract_all.return_value = ({"SPEAKER_00": VOICE}, [])
    memory = MagicMock()
    memory.resolve_with_scores.return_value = ({"SPEAKER_00": _ALICE}, {_ALICE: 0.64})

    transcript = TranscriptionController(transcription, embedding, memory).run_pipeline("a.wav")

    assert transcript.match_scores == {_ALICE: 0.64}
    assert transcript.segments[0].speaker_resolved == _ALICE


# ── Storage ───────────────────────────────────────────────────────────────────

def _storage(tmp_path):
    return TranscriptStorageService(db_path=str(tmp_path / "t.db"))


def _transcript(scores, speakers=(_ALICE,)):
    segments = [Segment(float(i), i + 1.0, "x", f"SPEAKER_0{i}", speaker_resolved=spk) for i, spk in enumerate(speakers)]
    return Transcript(audio_path="a.wav", segments=segments, match_scores=scores)


def test_save_keeps_the_match_scores(tmp_path):
    storage = _storage(tmp_path)
    db_id = storage.save(_transcript({_ALICE: 0.64}))
    assert storage.speaker_matches(db_id) == {_ALICE: {"score": pytest.approx(0.64), "confirmed": False}}


def test_a_transcript_without_scores_has_no_matches(tmp_path):
    storage = _storage(tmp_path)
    db_id = storage.save(Transcript(audio_path="a.wav", segments=[Segment(0.0, 1.0, "x", "SPEAKER_00", speaker_resolved=_ALICE)]))
    assert storage.speaker_matches(db_id) == {}


def test_set_match_confirmed_and_back(tmp_path):
    storage = _storage(tmp_path)
    db_id = storage.save(_transcript({_ALICE: 0.64}))
    assert storage.set_match_confirmed(db_id, _ALICE, True) is True
    assert storage.speaker_matches(db_id)[_ALICE]["confirmed"] is True
    assert storage.set_match_confirmed(db_id, _ALICE, False) is True
    assert storage.speaker_matches(db_id)[_ALICE]["confirmed"] is False


def test_set_match_confirmed_without_a_match_is_false(tmp_path):
    storage = _storage(tmp_path)
    db_id = storage.save(_transcript({}))
    assert storage.set_match_confirmed(db_id, _ALICE, True) is False


def test_deleting_a_transcript_removes_its_matches(tmp_path):
    storage = _storage(tmp_path)
    db_id = storage.save(_transcript({_ALICE: 0.64}))
    storage.delete(db_id)
    with sqlite3.connect(storage.db_path) as conn:
        assert conn.execute("SELECT COUNT(*) FROM speaker_matches").fetchone()[0] == 0


def test_clear_removes_all_matches(tmp_path):
    storage = _storage(tmp_path)
    storage.save(_transcript({_ALICE: 0.64}))
    storage.clear()
    with sqlite3.connect(storage.db_path) as conn:
        assert conn.execute("SELECT COUNT(*) FROM speaker_matches").fetchone()[0] == 0


def test_unassigning_a_speaker_removes_only_their_matches(tmp_path):
    storage = _storage(tmp_path)
    db_id = storage.save(_transcript({_ALICE: 0.64, _CAROL: 0.66}, speakers=(_ALICE, _CAROL)))
    storage.unassign_speaker(_ALICE)
    assert list(storage.speaker_matches(db_id)) == [_CAROL]


def test_migration_to_v8_adds_an_empty_match_table(tmp_path):
    from app.db.schema import SCHEMA_VERSION
    storage = _storage(tmp_path)
    db_id = storage.save(_transcript({_ALICE: 0.64}))
    with sqlite3.connect(storage.db_path) as conn:
        conn.execute("DROP TABLE speaker_matches")
        conn.execute("UPDATE _ts_schema_version SET version = 7")
    storage = _storage(tmp_path)
    assert storage.speaker_matches(db_id) == {}
    with sqlite3.connect(storage.db_path) as conn:
        assert conn.execute("SELECT version FROM _ts_schema_version").fetchone()[0] == SCHEMA_VERSION == 8


# ── API ───────────────────────────────────────────────────────────────────────

@pytest.fixture
def client(tmp_path):
    transcript_db = str(tmp_path / "transcripts.db")
    memory_db = str(tmp_path / "memory.db")
    app.dependency_overrides[get_storage_service] = lambda: TranscriptStorageService(db_path=transcript_db)
    app.dependency_overrides[get_memory_service] = lambda: SpeakerMemoryService(db_path=memory_db)
    yield TestClient(app)
    app.dependency_overrides.clear()


def _profiles(profiles):
    """profiles: {speaker id: (name, embedding)}."""
    memory = app.dependency_overrides[get_memory_service]()
    for spk_id, (name, embedding) in profiles.items():
        memory.update_embedding(spk_id, embedding)
        memory.set_name(spk_id, name)
    memory.save()
    return memory


def _save(segments, scores, audio_path="a.wav"):
    storage = app.dependency_overrides[get_storage_service]()
    return storage.save(Transcript(audio_path=str(audio_path), segments=segments, match_scores=scores))


def _alice_voice(start=0.0):
    return Segment(start, start + 2.0, "alice talks", "SPEAKER_00", speaker_resolved=_ALICE, embedding=VOICE)


def _candidates(client, transcript_id):
    r = client.get(f"/transcripts/{transcript_id}/speaker-candidates")
    assert r.status_code == 200, r.text
    return r.json()


@pytest.mark.parametrize("score", [0.6, 0.65, 0.694])
def test_a_speaker_recognized_below_the_ceiling_is_a_possible_match(client, score):
    _profiles({_ALICE: ("Alice", VOICE)})
    transcript_id = _save([_alice_voice()], {_ALICE: score})
    answer = _candidates(client, transcript_id)[_ALICE]
    assert answer["possible_match"] is True
    assert answer["candidates"][0] == {"speaker_id": _ALICE, "name": "Alice", "score": round(score, 2), "suggested": True}


@pytest.mark.parametrize("score", [0.696, 0.7, 0.9])
def test_a_speaker_recognized_at_the_ceiling_or_above_is_not(client, score):
    _profiles({_ALICE: ("Alice", VOICE)})
    transcript_id = _save([_alice_voice()], {_ALICE: score})
    assert _candidates(client, transcript_id) == {}


def test_a_recognized_speaker_without_a_kept_score_is_not_a_possible_match(client):
    _profiles({_ALICE: ("Alice", VOICE)})
    transcript_id = _save([_alice_voice()], {})
    assert _candidates(client, transcript_id) == {}


def test_a_possible_match_is_offered_first_then_the_closest_others(client):
    _profiles({
        _ALICE: ("Alice", VOICE),
        _CAROL: ("Carol", _at_cosine(0.4)),
        _DAN: ("Dan", _at_cosine(0.3)),
        _BOB: ("Bob", _at_cosine(0.1)),
    })
    transcript_id = _save([_alice_voice()], {_ALICE: 0.62})
    assert _candidates(client, transcript_id)[_ALICE]["candidates"] == [
        # The score kept at recognition, not today's: the profile has this recording in it now.
        {"speaker_id": _ALICE, "name": "Alice", "score": 0.62, "suggested": True},
        {"speaker_id": _CAROL, "name": "Carol", "score": 0.4, "suggested": False},
        {"speaker_id": _DAN, "name": "Dan", "score": 0.3, "suggested": False},
    ]


def test_a_possible_match_has_a_clip(client, tmp_path):
    audio = tmp_path / "a.wav"
    audio.write_bytes(b"x")
    _profiles({_ALICE: ("Alice", VOICE)})
    transcript_id = _save([_alice_voice(1.0)], {_ALICE: 0.62}, audio)
    assert _candidates(client, transcript_id)[_ALICE]["clip"] == {"start": 1.0, "end": 3.0, "text": "alice talks"}


def test_an_unknown_speaker_is_not_a_possible_match(client):
    transcript_id = _save([Segment(0.0, 2.0, "x", "SPEAKER_00", speaker_resolved=_BOB, embedding=VOICE)], {})
    assert _candidates(client, transcript_id)[_BOB]["possible_match"] is False


def test_confirming_takes_the_speaker_out_of_review(client):
    _profiles({_ALICE: ("Alice", VOICE)})
    transcript_id = _save([_alice_voice()], {_ALICE: 0.62})
    r = client.post(f"/transcripts/{transcript_id}/possible-matches/{_ALICE}/confirmed")
    assert r.status_code == 204, r.text
    assert _candidates(client, transcript_id) == {}


def test_undoing_a_confirmation_brings_the_speaker_back(client):
    _profiles({_ALICE: ("Alice", VOICE)})
    transcript_id = _save([_alice_voice()], {_ALICE: 0.62})
    client.post(f"/transcripts/{transcript_id}/possible-matches/{_ALICE}/confirmed")
    r = client.delete(f"/transcripts/{transcript_id}/possible-matches/{_ALICE}/confirmed")
    assert r.status_code == 204, r.text
    assert _candidates(client, transcript_id)[_ALICE]["possible_match"] is True


@pytest.mark.parametrize("method", ["post", "delete"])
def test_confirming_without_a_kept_score_is_404(client, method):
    _profiles({_ALICE: ("Alice", VOICE)})
    transcript_id = _save([_alice_voice()], {})
    r = getattr(client, method)(f"/transcripts/{transcript_id}/possible-matches/{_ALICE}/confirmed")
    assert r.status_code == 404


@pytest.mark.parametrize("method", ["post", "delete"])
def test_confirming_in_an_unknown_transcript_is_404(client, method):
    r = getattr(client, method)(f"/transcripts/999/possible-matches/{_ALICE}/confirmed")
    assert r.status_code == 404


def test_a_possible_match_assigned_to_someone_else_leaves_review(client):
    _profiles({_ALICE: ("Alice", VOICE), _CAROL: ("Carol", _at_cosine(0.5))})
    transcript_id = _save([_alice_voice()], {_ALICE: 0.62})
    r = client.post(f"/transcripts/{transcript_id}/speaker-assignments", json={"segment_starts": [0.0], "speaker_id": _CAROL})
    assert r.status_code == 200, r.text
    assert _candidates(client, transcript_id) == {}


def test_undoing_that_assignment_brings_the_possible_match_back(client):
    _profiles({_ALICE: ("Alice", VOICE), _CAROL: ("Carol", _at_cosine(0.5))})
    transcript_id = _save([_alice_voice()], {_ALICE: 0.62})
    client.post(f"/transcripts/{transcript_id}/speaker-assignments", json={"segment_starts": [0.0], "speaker_id": _CAROL})
    r = client.post(f"/transcripts/{transcript_id}/speaker-assignments/undo", json={"segment_starts": [0.0], "speaker_id": _ALICE})
    assert r.status_code == 204, r.text
    assert _candidates(client, transcript_id)[_ALICE]["possible_match"] is True


def test_deleting_the_speaker_removes_the_possible_match(client):
    from app.api.dependencies import get_live_recording_service
    app.dependency_overrides[get_live_recording_service] = lambda: MagicMock(is_recording=lambda: False)
    _profiles({_ALICE: ("Alice", VOICE)})
    transcript_id = _save([_alice_voice()], {_ALICE: 0.62})
    assert client.delete(f"/speakers/{_ALICE}").status_code == 200
    storage = app.dependency_overrides[get_storage_service]()
    assert storage.speaker_matches(transcript_id) == {}
