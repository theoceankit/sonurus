"""Merging speaker A into speaker B: A's segments and possible matches go to B,
B keeps who they are (or takes A's name, handle, colour and photo when B has no
name), B's voice is recomputed from every segment,
and A is gone."""
import uuid as uuid_module

import numpy as np
import pytest
from fastapi.testclient import TestClient

from app.api.dependencies import (
    get_live_recording_service, get_memory_service, get_storage_service, get_transcription_queue,
)
from app.api.main import app
from app.models.segment import Segment
from app.models.transcript import Transcript
from app.services.commit_service import CommitService
from app.services.speaker_memory_service import SpeakerMemoryService
from app.services.transcript_storage_service import TranscriptStorageService

JPEG = b"\xff\xd8\xff\xe0" + b"\x00" * 64

X = np.array([1.0, 0.0, 0.0], dtype=np.float32)
Y = np.array([0.0, 1.0, 0.0], dtype=np.float32)  # far from X: below any threshold


@pytest.fixture
def photos(tmp_path):
    path = tmp_path / "speaker_photos"
    path.mkdir()
    return path


@pytest.fixture
def db(tmp_path):
    return str(tmp_path / "sonorus.db")


@pytest.fixture
def memory(db, photos):
    return SpeakerMemoryService(db_path=db, photos_dir=photos)


@pytest.fixture
def storage(db):
    return TranscriptStorageService(db_path=db)


def _voice(memory, emb=X):
    spk = str(uuid_module.uuid4())
    memory.update_embedding(spk, emb)
    memory.save()
    return spk


def _recording(storage, speakers, emb=X, matches=None):
    """One recording with a segment per entry of speakers, all with embedding emb."""
    return storage.save(Transcript(
        audio_path="files/test.wav", language="en",
        segments=[Segment(float(i), i + 1.0, f"Text {i}", "SPEAKER_00", speaker_resolved=spk, embedding=emb)
                  for i, spk in enumerate(speakers)],
        match_scores=matches or {},
    ))


def _speakers_of(storage, db_id):
    return [seg.speaker_resolved for seg in storage.load(db_id, with_embeddings=False).segments]


# ---------------------------------------------------------------------------
# Storage: segments and possible matches
# ---------------------------------------------------------------------------

def test_move_speaker_moves_every_segment_in_every_recording(storage):
    a, b, c = (str(uuid_module.uuid4()) for _ in range(3))
    first = _recording(storage, [a, b, a])
    second = _recording(storage, [a, c])
    assert storage.move_speaker(a, b) == {"segments": 3, "transcripts": 2}
    assert _speakers_of(storage, first) == [b, b, b]
    assert _speakers_of(storage, second) == [b, c]
    assert storage.speaker_segments(a) == []


def test_move_speaker_moves_a_possible_match_of_a_to_b(storage):
    a, b = str(uuid_module.uuid4()), str(uuid_module.uuid4())
    db_id = _recording(storage, [a], matches={a: 0.55})
    storage.set_match_confirmed(db_id, a, True)
    storage.move_speaker(a, b)
    assert storage.speaker_matches(db_id) == {b: {"score": 0.55, "confirmed": True}}


def test_move_speaker_keeps_one_match_with_the_higher_score_and_any_confirmation(storage):
    a, b = str(uuid_module.uuid4()), str(uuid_module.uuid4())
    db_id = _recording(storage, [a, b], matches={a: 0.65, b: 0.52})
    storage.set_match_confirmed(db_id, b, True)
    storage.move_speaker(a, b)
    assert storage.speaker_matches(db_id) == {b: {"score": 0.65, "confirmed": True}}


def test_move_speaker_leaves_other_recordings_matches_alone(storage):
    a, b, c = (str(uuid_module.uuid4()) for _ in range(3))
    other = _recording(storage, [c], matches={c: 0.58})
    storage.move_speaker(a, b)
    assert storage.speaker_matches(other) == {c: {"score": 0.58, "confirmed": False}}


# ---------------------------------------------------------------------------
# CommitService.merge_speaker
# ---------------------------------------------------------------------------

def test_merge_into_a_named_speaker_keeps_b_and_removes_a_entirely(memory, storage, photos):
    a = memory.create_named_speaker("Anna")
    memory.set_photo(a, JPEG, "image/jpeg")
    a_photo = memory.get_photo(a)
    b = memory.create_named_speaker("Anna Petrova")
    memory.set_color(b, 3)
    _recording(storage, [a, b])

    result = CommitService(memory, storage).merge_speaker(a, b)

    assert result == {"segments": 1, "transcripts": 1}
    assert (memory.get_name(b), memory.get_handle(b), memory.get_color_index(b)) == ("Anna Petrova", "anna.petrova", 3)
    assert a not in memory.speaker_ids()
    assert not (photos / a_photo).exists()
    fresh = SpeakerMemoryService(db_path=memory.db_path, photos_dir=photos)
    assert a not in fresh.speaker_ids() and fresh.get_name(b) == "Anna Petrova"


def test_merge_frees_a_handle(memory, storage):
    a = memory.create_named_speaker("Mark Ellis")
    b = memory.create_named_speaker("Mark Ellis")
    assert memory.get_handle(b) == "mark.ellis2"
    CommitService(memory, storage).merge_speaker(a, b)
    assert memory.get_handle(b) == "mark.ellis2"
    assert memory.suggest_handle("Mark Ellis") == "mark.ellis"


def test_merge_into_an_unnamed_speaker_gives_b_a_name_handle_colour_and_photo(memory, storage, photos):
    a = memory.create_named_speaker("Lena Kovacs")
    memory.set_handle(a, "lena")
    memory.set_color(a, 2)
    memory.set_photo(a, JPEG, "image/jpeg")
    photo = memory.get_photo(a)
    b = _voice(memory)
    _recording(storage, [a, b])

    CommitService(memory, storage).merge_speaker(a, b)

    assert memory.get_name(b) == "Lena Kovacs"
    assert (memory.get_handle(b), memory.is_handle_manual(b)) == ("lena", True)
    assert memory.get_color_index(b) == 2
    assert memory.get_photo(b) == photo and (photos / photo).exists()
    assert a not in memory.speaker_ids()
    fresh = SpeakerMemoryService(db_path=memory.db_path, photos_dir=photos)
    assert (fresh.get_name(b), fresh.get_handle(b), fresh.get_color_index(b), fresh.get_photo(b)) == \
        ("Lena Kovacs", "lena", 2, photo)
    assert fresh.find_by_name("Lena Kovacs") == b


def test_merge_of_two_unnamed_speakers_leaves_b_unnamed(memory, storage):
    a, b = _voice(memory), _voice(memory)
    _recording(storage, [a, b])
    CommitService(memory, storage).merge_speaker(a, b)
    assert memory.get_name(b) is None and memory.get_handle(b) is None
    assert a not in memory.speaker_ids()


def test_merge_recomputes_b_from_every_recording(memory, storage):
    b = memory.create_named_speaker("Mark")
    _recording(storage, [b], emb=X)
    CommitService(memory, storage).commit_speaker(b)
    a = _voice(memory, Y)
    _recording(storage, [a], emb=Y)  # A's recording is nothing like B's

    CommitService(memory, storage).merge_speaker(a, b)

    expected = (X + Y) / np.linalg.norm(X + Y)
    np.testing.assert_allclose(memory.known_speakers[b], expected, atol=1e-6)
    fresh = SpeakerMemoryService(db_path=memory.db_path)
    np.testing.assert_allclose(fresh.known_speakers[b], expected, atol=1e-6)


def test_merge_gives_a_speaker_without_segments_a_voice(memory, storage):
    b = memory.create_named_speaker("Mark")
    a = _voice(memory, Y)
    _recording(storage, [a], emb=Y)
    CommitService(memory, storage).merge_speaker(a, b)
    np.testing.assert_allclose(memory.known_speakers[b], Y, atol=1e-6)


def test_merge_without_any_segments_keeps_b_as_it_is(memory, storage):
    a = memory.create_named_speaker("Anna")
    b = memory.create_named_speaker("Anna Petrova")
    assert CommitService(memory, storage).merge_speaker(a, b) == {"segments": 0, "transcripts": 0}
    assert b not in memory.known_speakers and memory.get_name(b) == "Anna Petrova"
    assert a not in memory.speaker_ids()


# ---------------------------------------------------------------------------
# POST /speakers/{id}/merge
# ---------------------------------------------------------------------------

class _Recording:
    def __init__(self, on=False):
        self.on = on

    def is_recording(self):
        return self.on


class _Queue:
    def __init__(self, running=False):
        self.running = running

    def is_running(self):
        return self.running


@pytest.fixture
def client(db, photos):
    app.dependency_overrides[get_storage_service] = lambda: TranscriptStorageService(db_path=db)
    memory = SpeakerMemoryService(db_path=db, photos_dir=photos)
    app.dependency_overrides[get_memory_service] = lambda: memory
    app.dependency_overrides[get_live_recording_service] = lambda: _Recording()
    app.dependency_overrides[get_transcription_queue] = lambda: _Queue()
    yield TestClient(app)
    app.dependency_overrides.clear()


def _api_memory():
    return app.dependency_overrides[get_memory_service]()


def _api_storage():
    return app.dependency_overrides[get_storage_service]()


def test_merge_route_moves_a_into_b(client):
    a = _voice(_api_memory())
    b = _api_memory().create_named_speaker("Mark Ellis")
    _recording(_api_storage(), [a, a, b])
    _recording(_api_storage(), [a])

    r = client.post(f"/speakers/{a}/merge", json={"into_id": b})

    assert r.status_code == 200, r.text
    body = r.json()
    assert (body["segments"], body["transcripts"]) == (3, 2)
    assert body["speaker"]["id"] == b and body["speaker"]["name"] == "Mark Ellis"
    assert (body["speaker"]["segments"], body["speaker"]["transcripts"]) == (4, 2)
    ids = [row["id"] for row in client.get("/speakers").json()]
    assert a not in ids and b in ids


def test_merge_route_gives_an_unnamed_b_the_name_of_a(client):
    a = _api_memory().create_named_speaker("Lena Kovacs")
    b = _voice(_api_memory())
    _recording(_api_storage(), [b])
    r = client.post(f"/speakers/{a}/merge", json={"into_id": b})
    assert r.status_code == 200, r.text
    assert (r.json()["speaker"]["name"], r.json()["speaker"]["handle"]) == ("Lena Kovacs", "lena.kovacs")


def test_merge_route_refuses_merging_a_speaker_into_itself(client):
    a = _api_memory().create_named_speaker("Mark")
    r = client.post(f"/speakers/{a}/merge", json={"into_id": a})
    assert r.status_code == 400
    assert r.json()["code"] == "merge_into_self"
    assert _api_memory().get_name(a) == "Mark"


@pytest.mark.parametrize("missing", ["from", "into"])
def test_merge_route_is_404_for_an_unknown_speaker(client, missing):
    known = _api_memory().create_named_speaker("Mark")
    unknown = str(uuid_module.uuid4())
    a, b = (unknown, known) if missing == "from" else (known, unknown)
    r = client.post(f"/speakers/{a}/merge", json={"into_id": b})
    assert r.status_code == 404
    assert _api_memory().get_name(known) == "Mark"


@pytest.mark.parametrize("busy", ["queue", "recording"])
def test_merge_route_is_409_while_a_job_runs_or_a_recording_goes_and_changes_nothing(client, busy):
    a = _voice(_api_memory())
    b = _api_memory().create_named_speaker("Mark")
    db_id = _recording(_api_storage(), [a])
    if busy == "queue":
        app.dependency_overrides[get_transcription_queue] = lambda: _Queue(running=True)
    else:
        app.dependency_overrides[get_live_recording_service] = lambda: _Recording(on=True)
    r = client.post(f"/speakers/{a}/merge", json={"into_id": b})
    assert r.status_code == 409
    assert _speakers_of(_api_storage(), db_id) == [a]
    assert a in _api_memory().speaker_ids()
