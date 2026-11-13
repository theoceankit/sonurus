"""Speaker handles through the API: the speakers list, PATCH, rename, creating a
speaker by name, suggestions and the handle format."""
import uuid as uuid_module

import numpy as np
import pytest
from fastapi.testclient import TestClient

from app.api.dependencies import get_memory_service, get_storage_service
from app.api.main import app
from app.models.segment import Segment
from app.models.transcript import Transcript
from app.services.speaker_memory_service import SpeakerMemoryService
from app.services.transcript_storage_service import TranscriptStorageService


@pytest.fixture
def client(tmp_path):
    db = str(tmp_path / "sonorus.db")
    app.dependency_overrides[get_storage_service] = lambda: TranscriptStorageService(db_path=db)
    app.dependency_overrides[get_memory_service] = lambda: SpeakerMemoryService(db_path=db)
    yield TestClient(app)
    app.dependency_overrides.clear()


def _memory():
    return app.dependency_overrides[get_memory_service]()


def _named(name):
    return _memory().create_named_speaker(name)


def _unnamed():
    spk = str(uuid_module.uuid4())
    memory = _memory()
    memory.update_embedding(spk, np.array([1.0, 0.0, 0.0], dtype=np.float32))
    memory.save()
    return spk


def _row(client, spk):
    return next(row for row in client.get("/speakers").json() if row["id"] == spk)


def _recording(speakers):
    storage = app.dependency_overrides[get_storage_service]()
    return storage.save(Transcript(audio_path="files/test.wav", language="en", segments=[
        Segment(float(i), i + 1.0, f"Text {i}", "SPEAKER_00", speaker_resolved=spk,
                embedding=np.array([1.0, 0.0, 0.0], dtype=np.float32))
        for i, spk in enumerate(speakers)
    ]))


# ---------------------------------------------------------------------------
# GET /speakers
# ---------------------------------------------------------------------------

def test_speakers_list_has_handles(client):
    named = _named("Иван Петров")
    unnamed = _unnamed()
    assert (_row(client, named)["handle"], _row(client, named)["handle_manual"]) == ("ivan.petrov", False)
    assert _row(client, unnamed)["handle"] is None


# ---------------------------------------------------------------------------
# PATCH /speakers/{id}
# ---------------------------------------------------------------------------

def test_patch_sets_a_handle_by_hand(client):
    spk = _named("Ivan Petrov")
    r = client.patch(f"/speakers/{spk}", json={"handle": " @Vanya "})
    assert r.status_code == 200, r.text
    assert (r.json()["handle"], r.json()["handle_manual"]) == ("vanya", True)
    assert _row(client, spk)["handle"] == "vanya"


def test_patch_with_an_empty_handle_goes_back_to_the_name(client):
    spk = _named("Ivan Petrov")
    client.patch(f"/speakers/{spk}", json={"handle": "vanya"})
    r = client.patch(f"/speakers/{spk}", json={"handle": ""})
    assert r.status_code == 200, r.text
    assert (r.json()["handle"], r.json()["handle_manual"]) == ("ivan.petrov", False)


def test_patch_name_moves_an_automatic_handle_and_keeps_a_manual_one(client):
    auto = _named("Ivan Petrov")
    manual = _named("Olivia Brown")
    client.patch(f"/speakers/{manual}", json={"handle": "liv"})
    assert client.patch(f"/speakers/{auto}", json={"name": "Ivan Sidorov"}).json()["handle"] == "ivan.sidorov"
    assert client.patch(f"/speakers/{manual}", json={"name": "Olivia Green"}).json()["handle"] == "liv"


def test_patch_name_and_handle_together(client):
    spk = _unnamed()
    r = client.patch(f"/speakers/{spk}", json={"name": "Ivan Petrov", "handle": "vanya"})
    assert r.status_code == 200, r.text
    assert (r.json()["name"], r.json()["handle"]) == ("Ivan Petrov", "vanya")


def test_patch_handle_taken_in_any_case_is_refused_with_the_owner(client):
    _named("Ivan Petrov")
    other = _named("Olivia Brown")
    r = client.patch(f"/speakers/{other}", json={"handle": "Ivan.Petrov"})
    assert r.status_code == 409
    assert r.json()["code"] == "handle_taken"
    assert "Ivan Petrov" in r.json()["detail"]
    assert _row(client, other)["handle"] == "olivia.brown"


def test_patch_taken_handle_changes_nothing_else(client):
    _named("Ivan Petrov")
    other = _named("Olivia Brown")
    r = client.patch(f"/speakers/{other}", json={"name": "Olivia Green", "handle": "ivan.petrov"})
    assert r.status_code == 409
    assert _row(client, other)["name"] == "Olivia Brown"


@pytest.mark.parametrize("bad", ["@", ".ivan", "ivan petrov", "иван", "a" * 33])
def test_patch_invalid_handle_is_refused(client, bad):
    spk = _named("Ivan Petrov")
    r = client.patch(f"/speakers/{spk}", json={"handle": bad})
    assert r.status_code == 400
    assert r.json()["code"] == "handle_invalid"


def test_patch_handle_of_an_unnamed_speaker_is_refused(client):
    spk = _unnamed()
    r = client.patch(f"/speakers/{spk}", json={"handle": "vanya"})
    assert r.status_code == 400
    assert r.json()["code"] == "handle_needs_name"


def test_rename_route_moves_an_automatic_handle(client):
    spk = _unnamed()  # the route renames speakers with a voice profile only
    client.patch(f"/speakers/{spk}", json={"name": "Ivan Petrov"})
    assert _row(client, spk)["handle"] == "ivan.petrov"
    assert client.post(f"/speakers/{spk}/rename", json={"name": "Ivan Sidorov"}).status_code == 204
    assert _row(client, spk)["handle"] == "ivan.sidorov"


def test_deleted_speaker_frees_its_handle(client):
    first = _named("Ivan Petrov")
    second = _named("Ivan Petrov")
    assert _row(client, second)["handle"] == "ivan.petrov2"
    assert client.delete(f"/speakers/{second}").status_code == 200
    assert client.get("/speakers/handle-suggestion", params={"name": "Ivan Petrov"}).json()["handle"] == "ivan.petrov2"
    assert _row(client, first)["handle"] == "ivan.petrov"


# ---------------------------------------------------------------------------
# A speaker created by name from the editor
# ---------------------------------------------------------------------------

def test_assign_to_a_new_speaker_gives_a_handle_from_the_name(client):
    voice = str(uuid_module.uuid4())
    db_id = _recording([voice])
    r = client.post(f"/transcripts/{db_id}/speaker-assignments", json={"segment_starts": [0.0], "speaker_name": "Dana Scully"})
    assert r.status_code == 200, r.text
    assert _row(client, r.json()["speaker_id"])["handle"] == "dana.scully"


def test_assign_to_a_new_speaker_with_a_handle_of_its_own(client):
    voice = str(uuid_module.uuid4())
    db_id = _recording([voice])
    r = client.post(f"/transcripts/{db_id}/speaker-assignments", json={
        "segment_starts": [0.0], "speaker_name": "Dana Scully", "speaker_handle": "@Starbuck",
    })
    assert r.status_code == 200, r.text
    row = _row(client, r.json()["speaker_id"])
    assert (row["handle"], row["handle_manual"]) == ("starbuck", True)


def test_assign_with_a_taken_handle_creates_nothing(client):
    _named("Ivan Petrov")
    voice = str(uuid_module.uuid4())
    db_id = _recording([voice])
    before = {row["id"] for row in client.get("/speakers").json()}
    r = client.post(f"/transcripts/{db_id}/speaker-assignments", json={
        "segment_starts": [0.0], "speaker_name": "Ivan", "speaker_handle": "IVAN.PETROV",
    })
    assert r.status_code == 409
    assert r.json()["code"] == "handle_taken"
    assert {row["id"] for row in client.get("/speakers").json()} == before
    assert client.get(f"/transcripts/{db_id}").json()["segments"][0]["speaker_resolved"] == voice


def test_assign_with_an_invalid_handle_creates_nothing(client):
    voice = str(uuid_module.uuid4())
    db_id = _recording([voice])
    r = client.post(f"/transcripts/{db_id}/speaker-assignments", json={
        "segment_starts": [0.0], "speaker_name": "Ivan", "speaker_handle": "иван",
    })
    assert r.status_code == 400
    assert r.json()["code"] == "handle_invalid"
    assert [row["id"] for row in client.get("/speakers").json()] == [voice]


def test_assign_handle_only_with_a_new_speaker(client):
    alice = _named("Alice")
    db_id = _recording([str(uuid_module.uuid4())])
    r = client.post(f"/transcripts/{db_id}/speaker-assignments", json={
        "segment_starts": [0.0], "speaker_id": alice, "speaker_handle": "x",
    })
    assert r.status_code == 400


# ---------------------------------------------------------------------------
# Suggestions and the format
# ---------------------------------------------------------------------------

def test_handle_suggestion_numbers_a_taken_handle(client):
    spk = _named("Ivan Petrov")
    assert client.get("/speakers/handle-suggestion", params={"name": "Иван Петров"}).json() == {"handle": "ivan.petrov2"}
    r = client.get("/speakers/handle-suggestion", params={"name": "Ivan Petrov", "exclude": spk})
    assert r.json() == {"handle": "ivan.petrov"}
    assert client.get("/speakers/handle-suggestion", params={"name": "王小明"}).json() == {"handle": "speaker"}


def test_handle_format_get_and_put(client):
    assert client.get("/speakers/handle-format").json() == {"format": "first.last"}
    old = _named("Ivan Petrov")
    r = client.put("/speakers/handle-format", json={"format": "f.last"})
    assert r.status_code == 200 and r.json() == {"format": "f.last"}
    assert client.get("/speakers/handle-format").json() == {"format": "f.last"}
    new = _named("Olivia Brown")
    assert _row(client, old)["handle"] == "ivan.petrov"
    assert _row(client, new)["handle"] == "o.brown"


def test_handle_format_rejects_an_unknown_format(client):
    assert client.put("/speakers/handle-format", json={"format": "last.first"}).status_code == 422


def test_handle_format_schema_lists_the_formats_the_generator_knows():
    from typing import get_args
    from app.api.schemas import HandleFormat
    from app.services.speaker_handle import HANDLE_FORMATS
    assert get_args(HandleFormat) == HANDLE_FORMATS
