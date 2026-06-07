"""
Tests for the speaker color feature.

Covers:
  - SpeakerRepository.load_colors() / save_colors(): round-trip persistence
  - Schema migration v3: speaker_meta table creation
  - _assign_color(): least-used color assignment logic
  - _ensure_color(): idempotency
  - save(): persists color assignments
  - save_names_only(): persists color assignments for named speakers
  - reload(): also reloads known_colors
  - remove_speaker(): clears color from known_colors and speaker_meta
  - API GET /speakers: returns color_index field
"""

import random
import sqlite3
import uuid as uuid_module

import numpy as np
import pytest

from app.api.main import app
from app.api.dependencies import get_memory_service, get_storage_service
from app.services.speaker_memory_service import SpeakerMemoryService
from app.services.transcript_storage_service import TranscriptStorageService

PALETTE_SIZE = 5


# ---------------------------------------------------------------------------
# Helpers / factories
# ---------------------------------------------------------------------------

def make_memory(tmp_path, db_name="memory.db"):
    """Create a fresh SpeakerMemoryService backed by a temp DB."""
    return SpeakerMemoryService(db_path=str(tmp_path / db_name))


def make_memory_with_speaker(tmp_path, spk_id="spk_alice", db_name="memory.db"):
    """Create a SpeakerMemoryService with one speaker embedding, ready for save()."""
    svc = make_memory(tmp_path, db_name=db_name)
    svc.update_embedding(spk_id, np.array([1.0, 0.0, 0.0], dtype=np.float32))
    return svc


# ---------------------------------------------------------------------------
# 1. SpeakerRepository round-trip: load_colors / save_colors
# ---------------------------------------------------------------------------

def test_save_and_load_colors_round_trip(tmp_path):
    """save_colors() persists color assignments; load_colors() retrieves them correctly."""
    db_path = str(tmp_path / "memory.db")
    # Boot service so migrations run and speaker_meta table is created.
    svc = SpeakerMemoryService(db_path=db_path)

    # Access the internal repo to test it directly.
    repo = svc._repo  # or svc.repo — whichever attribute name the impl uses
    colors_in = {
        "spk_aaa": 2,
        "spk_bbb": 0,
        "spk_ccc": 4,
    }
    repo.save_colors(colors_in)
    colors_out = repo.load_colors()

    assert colors_out == colors_in, (
        f"load_colors() must return exactly what was saved via save_colors(); "
        f"got {colors_out!r}"
    )


def test_save_colors_insert_or_replace(tmp_path):
    """save_colors() replaces an existing row when the speaker_id already exists."""
    db_path = str(tmp_path / "memory.db")
    svc = SpeakerMemoryService(db_path=db_path)
    repo = svc._repo

    repo.save_colors({"spk_aaa": 1})
    repo.save_colors({"spk_aaa": 3})  # update
    colors = repo.load_colors()

    assert colors == {"spk_aaa": 3}, (
        f"Second save_colors() must replace the first; got {colors!r}"
    )


def test_load_colors_empty_db(tmp_path):
    """load_colors() returns an empty dict when speaker_meta has no rows."""
    db_path = str(tmp_path / "memory.db")
    svc = SpeakerMemoryService(db_path=db_path)
    repo = svc._repo

    colors = repo.load_colors()
    assert colors == {}, f"Expected empty dict from fresh DB, got {colors!r}"


# ---------------------------------------------------------------------------
# 2. Schema migration: speaker_meta table must exist after init
# ---------------------------------------------------------------------------

def test_speaker_meta_table_created_by_migration(tmp_path):
    """Instantiating SpeakerMemoryService against a fresh DB creates the speaker_meta table."""
    db_path = str(tmp_path / "memory.db")
    SpeakerMemoryService(db_path=db_path)

    with sqlite3.connect(db_path) as conn:
        row = conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name='speaker_meta'"
        ).fetchone()

    assert row is not None, (
        "speaker_meta table must exist after SpeakerMemoryService initialises (schema v3)"
    )


def test_speaker_meta_has_correct_columns(tmp_path):
    """speaker_meta table has speaker_id TEXT PK and color_index INTEGER columns."""
    db_path = str(tmp_path / "memory.db")
    SpeakerMemoryService(db_path=db_path)

    with sqlite3.connect(db_path) as conn:
        col_info = conn.execute("PRAGMA table_info(speaker_meta)").fetchall()

    col_names = {row[1] for row in col_info}
    assert "speaker_id" in col_names, "speaker_meta must have a speaker_id column"
    assert "color_index" in col_names, "speaker_meta must have a color_index column"


# ---------------------------------------------------------------------------
# 3. _assign_color: least-used logic
# ---------------------------------------------------------------------------

def test_assign_color_empty_known_colors_in_palette_range(tmp_path):
    """With no existing colors, _assign_color returns an index in [0, PALETTE_SIZE-1]."""
    svc = make_memory(tmp_path)
    # known_colors should start empty on a fresh DB
    assert not svc.known_colors, "known_colors must be empty on fresh init"

    color = svc._assign_color("spk_new")

    assert isinstance(color, int), f"color must be an int, got {type(color)}"
    assert 0 <= color < PALETTE_SIZE, (
        f"color must be in [0, {PALETTE_SIZE - 1}], got {color}"
    )


def test_assign_color_picks_least_used(tmp_path):
    """_assign_color picks a color from the least-used bucket."""
    svc = make_memory(tmp_path)
    # Manually populate known_colors so colors 1,2,3,4 each appear twice; color 0 appears once.
    svc.known_colors = {
        "spk_a": 1,
        "spk_b": 2,
        "spk_c": 3,
        "spk_d": 4,
        "spk_e": 1,
        "spk_f": 2,
        "spk_g": 3,
        "spk_h": 4,
        "spk_i": 0,  # color 0 used once — least used
    }

    color = svc._assign_color("spk_new")

    assert color == 0, (
        f"_assign_color must pick color 0 (least used), got {color}"
    )


def test_assign_color_tied_picks_from_tied_set(tmp_path):
    """When multiple colors are tied for least-used, _assign_color picks one of them."""
    random.seed(42)
    svc = make_memory(tmp_path)
    # Colors 0 and 1 are unused; 2,3,4 each used once.
    svc.known_colors = {
        "spk_a": 2,
        "spk_b": 3,
        "spk_c": 4,
    }

    color = svc._assign_color("spk_new")

    assert color in {0, 1}, (
        f"_assign_color must pick one of the tied-least-used colors {{0, 1}}, got {color}"
    )


def test_assign_color_all_equally_used_any_valid(tmp_path):
    """When all palette colors are equally used, any color in [0, PALETTE_SIZE-1] is valid."""
    random.seed(42)
    svc = make_memory(tmp_path)
    # Each color used exactly once.
    svc.known_colors = {
        f"spk_{i}": i for i in range(PALETTE_SIZE)
    }

    color = svc._assign_color("spk_new")

    assert 0 <= color < PALETTE_SIZE, (
        f"_assign_color must return a valid palette index, got {color}"
    )


def test_assign_color_stores_result_in_known_colors(tmp_path):
    """_assign_color must store the assigned color in known_colors under the given spk_id."""
    svc = make_memory(tmp_path)

    color = svc._assign_color("spk_new")

    assert "spk_new" in svc.known_colors, (
        "_assign_color must store the result in known_colors"
    )
    assert svc.known_colors["spk_new"] == color


# ---------------------------------------------------------------------------
# 4. _ensure_color: idempotency
# ---------------------------------------------------------------------------

def test_ensure_color_assigns_when_missing(tmp_path):
    """_ensure_color assigns a color when spk_id is not in known_colors."""
    svc = make_memory(tmp_path)
    assert "spk_new" not in svc.known_colors

    svc._ensure_color("spk_new")

    assert "spk_new" in svc.known_colors, (
        "_ensure_color must add spk_id to known_colors"
    )
    assert 0 <= svc.known_colors["spk_new"] < PALETTE_SIZE


def test_ensure_color_idempotent(tmp_path):
    """Calling _ensure_color twice for the same spk_id does not change the color."""
    svc = make_memory(tmp_path)

    svc._ensure_color("spk_abc")
    color_first = svc.known_colors["spk_abc"]

    svc._ensure_color("spk_abc")
    color_second = svc.known_colors["spk_abc"]

    assert color_first == color_second, (
        f"_ensure_color must not change an already-assigned color; "
        f"got {color_first} then {color_second}"
    )


# ---------------------------------------------------------------------------
# 5. save() persists color
# ---------------------------------------------------------------------------

def test_save_persists_color_for_known_speaker(tmp_path):
    """After update_embedding() + save(), a new instance returns a valid color_index via get_color_index()."""
    db_path = str(tmp_path / "memory.db")
    spk_id = str(uuid_module.uuid4())

    svc = SpeakerMemoryService(db_path=db_path)
    svc.update_embedding(spk_id, np.array([1.0, 0.0, 0.0], dtype=np.float32))
    svc.save()

    svc2 = SpeakerMemoryService(db_path=db_path)
    color = svc2.get_color_index(spk_id)

    assert color is not None, (
        f"get_color_index({spk_id!r}) must return an int after save(), got None"
    )
    assert isinstance(color, int), f"color_index must be an int, got {type(color)}"
    assert 0 <= color < PALETTE_SIZE, (
        f"color_index must be in [0, {PALETTE_SIZE - 1}], got {color}"
    )


def test_save_persists_colors_for_multiple_speakers(tmp_path):
    """save() must persist colors for all dirty speakers."""
    db_path = str(tmp_path / "memory.db")

    svc = SpeakerMemoryService(db_path=db_path)
    spk_a = str(uuid_module.uuid4())
    spk_b = str(uuid_module.uuid4())
    svc.update_embedding(spk_a, np.array([1.0, 0.0, 0.0], dtype=np.float32))
    svc.update_embedding(spk_b, np.array([0.0, 1.0, 0.0], dtype=np.float32))
    svc.save()

    svc2 = SpeakerMemoryService(db_path=db_path)
    color_a = svc2.get_color_index(spk_a)
    color_b = svc2.get_color_index(spk_b)

    assert color_a is not None, f"color for {spk_a} must be persisted after save()"
    assert color_b is not None, f"color for {spk_b} must be persisted after save()"
    assert 0 <= color_a < PALETTE_SIZE
    assert 0 <= color_b < PALETTE_SIZE


# ---------------------------------------------------------------------------
# 6. save_names_only() persists color
# ---------------------------------------------------------------------------

def test_save_names_only_persists_color_for_named_speaker(tmp_path):
    """save_names_only() must persist color for speakers that have a display name."""
    db_path = str(tmp_path / "memory.db")
    spk_id = str(uuid_module.uuid4())

    svc = SpeakerMemoryService(db_path=db_path)
    svc.set_name(spk_id, "Alice")
    svc.save_names_only()

    svc2 = SpeakerMemoryService(db_path=db_path)
    color = svc2.get_color_index(spk_id)

    assert color is not None, (
        f"get_color_index({spk_id!r}) must return an int after save_names_only(), got None"
    )
    assert 0 <= color < PALETTE_SIZE, (
        f"color_index must be in [0, {PALETTE_SIZE - 1}], got {color}"
    )


def test_save_names_only_does_not_persist_color_for_unnamed_speaker(tmp_path):
    """save_names_only() must not assign/persist colors for speakers without a display name."""
    db_path = str(tmp_path / "memory.db")
    spk_id = str(uuid_module.uuid4())

    svc = SpeakerMemoryService(db_path=db_path)
    # No name set; just update embedding so the speaker exists
    svc.update_embedding(spk_id, np.array([1.0, 0.0, 0.0], dtype=np.float32))
    # Only call save_names_only(), not save()
    svc.save_names_only()

    with sqlite3.connect(db_path) as conn:
        row = conn.execute(
            "SELECT color_index FROM speaker_meta WHERE speaker_id = ?",
            (spk_id,),
        ).fetchone()

    assert row is None, (
        "save_names_only() must not write a color to speaker_meta for unnamed speakers"
    )


# ---------------------------------------------------------------------------
# 7. reload() also reloads known_colors
# ---------------------------------------------------------------------------

def test_reload_restores_colors(tmp_path):
    """After save() + reload(), known_colors contains the persisted colors."""
    db_path = str(tmp_path / "memory.db")
    spk_id = str(uuid_module.uuid4())

    svc = SpeakerMemoryService(db_path=db_path)
    svc.update_embedding(spk_id, np.array([1.0, 0.0, 0.0], dtype=np.float32))
    svc.save()

    # Wipe in-memory state and reload from DB
    svc.known_colors = {}
    svc.reload()

    assert spk_id in svc.known_colors, (
        f"reload() must restore known_colors from DB; {spk_id!r} not found after reload"
    )
    assert 0 <= svc.known_colors[spk_id] < PALETTE_SIZE


def test_reload_from_separate_instance(tmp_path):
    """A second SpeakerMemoryService instance sees colors saved by the first."""
    db_path = str(tmp_path / "memory.db")
    spk_id = str(uuid_module.uuid4())

    svc1 = SpeakerMemoryService(db_path=db_path)
    svc1.update_embedding(spk_id, np.array([1.0, 0.0, 0.0], dtype=np.float32))
    svc1.save()
    saved_color = svc1.known_colors[spk_id]

    svc2 = SpeakerMemoryService(db_path=db_path)
    assert spk_id in svc2.known_colors, (
        "A new SpeakerMemoryService instance must load known_colors from DB"
    )
    assert svc2.known_colors[spk_id] == saved_color


# ---------------------------------------------------------------------------
# 8. remove_speaker() clears color
# ---------------------------------------------------------------------------

def test_remove_speaker_clears_known_colors(tmp_path):
    """remove_speaker() must remove the spk_id from known_colors in memory."""
    db_path = str(tmp_path / "memory.db")
    spk_id = str(uuid_module.uuid4())

    svc = SpeakerMemoryService(db_path=db_path)
    svc.update_embedding(spk_id, np.array([1.0, 0.0, 0.0], dtype=np.float32))
    svc.save()

    svc.remove_speaker(spk_id)

    assert spk_id not in svc.known_colors, (
        "remove_speaker() must remove the speaker from known_colors"
    )


def test_remove_speaker_deletes_speaker_meta_row(tmp_path):
    """remove_speaker() must delete the row from speaker_meta in the DB."""
    db_path = str(tmp_path / "memory.db")
    spk_id = str(uuid_module.uuid4())

    svc = SpeakerMemoryService(db_path=db_path)
    svc.update_embedding(spk_id, np.array([1.0, 0.0, 0.0], dtype=np.float32))
    svc.save()

    # Verify the row exists before removal
    with sqlite3.connect(db_path) as conn:
        row_before = conn.execute(
            "SELECT color_index FROM speaker_meta WHERE speaker_id = ?",
            (spk_id,),
        ).fetchone()
    assert row_before is not None, "speaker_meta row must exist after save()"

    svc.remove_speaker(spk_id)

    with sqlite3.connect(db_path) as conn:
        row_after = conn.execute(
            "SELECT color_index FROM speaker_meta WHERE speaker_id = ?",
            (spk_id,),
        ).fetchone()
    assert row_after is None, (
        "remove_speaker() must delete the row from speaker_meta"
    )


def test_get_color_index_returns_none_after_remove(tmp_path):
    """get_color_index() returns None for a speaker that has been removed."""
    db_path = str(tmp_path / "memory.db")
    spk_id = str(uuid_module.uuid4())

    svc = SpeakerMemoryService(db_path=db_path)
    svc.update_embedding(spk_id, np.array([1.0, 0.0, 0.0], dtype=np.float32))
    svc.save()

    svc.remove_speaker(spk_id)

    color = svc.get_color_index(spk_id)
    assert color is None, (
        f"get_color_index() must return None after remove_speaker(), got {color}"
    )


def test_get_color_index_returns_none_for_unknown_speaker(tmp_path):
    """get_color_index() returns None for a speaker_id that was never assigned a color."""
    svc = make_memory(tmp_path)
    color = svc.get_color_index("spk_ghost")
    assert color is None, (
        f"get_color_index() must return None for an unknown speaker, got {color}"
    )


# ---------------------------------------------------------------------------
# 9. API GET /speakers returns color_index
# ---------------------------------------------------------------------------

@pytest.fixture
def client(tmp_path):
    """FastAPI TestClient with isolated in-memory storage and speaker memory."""
    transcript_db = str(tmp_path / "transcripts.db")
    memory_db = str(tmp_path / "memory.db")

    def _storage():
        return TranscriptStorageService(db_path=transcript_db)

    def _memory():
        return SpeakerMemoryService(db_path=memory_db)

    app.dependency_overrides[get_storage_service] = _storage
    app.dependency_overrides[get_memory_service] = _memory

    from fastapi.testclient import TestClient
    yield TestClient(app)

    app.dependency_overrides.clear()


def test_get_speakers_returns_color_index(client):
    """GET /speakers includes a color_index integer field in each speaker entry."""
    memory = app.dependency_overrides[get_memory_service]()
    spk_id = str(uuid_module.uuid4())
    memory.update_embedding(spk_id, np.array([1.0, 0.0, 0.0], dtype=np.float32))
    memory.set_name(spk_id, "Alice")
    memory.save()

    r = client.get("/speakers")
    assert r.status_code == 200

    speakers = r.json()
    assert len(speakers) >= 1, "Expected at least one speaker in response"

    alice = next((s for s in speakers if s.get("id") == spk_id), None)
    assert alice is not None, f"Speaker {spk_id!r} not found in GET /speakers response"
    assert "color_index" in alice, (
        f"GET /speakers response must include color_index field; got keys: {list(alice.keys())}"
    )
    assert isinstance(alice["color_index"], int), (
        f"color_index must be an int, got {type(alice['color_index'])}"
    )
    assert 0 <= alice["color_index"] < PALETTE_SIZE, (
        f"color_index must be in [0, {PALETTE_SIZE - 1}], got {alice['color_index']}"
    )


def test_get_speakers_color_index_is_stable_across_requests(client):
    """The color_index returned by GET /speakers is stable on a repeated call."""
    memory = app.dependency_overrides[get_memory_service]()
    spk_id = str(uuid_module.uuid4())
    memory.update_embedding(spk_id, np.array([1.0, 0.0, 0.0], dtype=np.float32))
    memory.set_name(spk_id, "Bob")
    memory.save()

    r1 = client.get("/speakers")
    r2 = client.get("/speakers")

    speakers1 = {s["id"]: s for s in r1.json()}
    speakers2 = {s["id"]: s for s in r2.json()}

    assert speakers1[spk_id]["color_index"] == speakers2[spk_id]["color_index"], (
        "color_index must be stable across repeated GET /speakers calls"
    )


def test_get_speakers_two_speakers_color_index_is_int_for_both(client):
    """GET /speakers returns a valid color_index for each of multiple speakers."""
    memory = app.dependency_overrides[get_memory_service]()
    spk_a = str(uuid_module.uuid4())
    spk_b = str(uuid_module.uuid4())
    memory.update_embedding(spk_a, np.array([1.0, 0.0, 0.0], dtype=np.float32))
    memory.update_embedding(spk_b, np.array([0.0, 1.0, 0.0], dtype=np.float32))
    memory.set_name(spk_a, "SpeakerA")
    memory.set_name(spk_b, "SpeakerB")
    memory.save()

    r = client.get("/speakers")
    assert r.status_code == 200

    by_id = {s["id"]: s for s in r.json()}
    for spk_id in (spk_a, spk_b):
        assert spk_id in by_id, f"Speaker {spk_id!r} missing from GET /speakers"
        color = by_id[spk_id].get("color_index")
        assert isinstance(color, int), f"color_index must be int for {spk_id}, got {color!r}"
        assert 0 <= color < PALETTE_SIZE, f"color_index out of range: {color}"
