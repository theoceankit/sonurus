"""Speaker handles in speaker memory: who gets one, uniqueness, renames, the
format setting, the v3 → v4 migration and what must not wipe a handle."""
import sqlite3

import numpy as np
import pytest

from app.services.speaker_memory_service import (
    HandleNeedsName, HandleTaken, InvalidHandle, SpeakerMemoryService,
)


def make_memory(tmp_path):
    return SpeakerMemoryService(db_path=str(tmp_path / "memory.db"))


def rename(memory, spk_id, name):
    memory.set_name(spk_id, name)
    memory.save_names_only()


# ---------------------------------------------------------------------------
# A named speaker gets a handle
# ---------------------------------------------------------------------------

def test_new_named_speaker_gets_a_handle_from_its_name(tmp_path):
    memory = make_memory(tmp_path)
    spk = memory.create_named_speaker("Иван Петров")
    assert memory.get_handle(spk) == "ivan.petrov"
    assert memory.is_handle_manual(spk) is False


def test_namesakes_get_numbers_and_a_freed_number_is_used_again(tmp_path):
    memory = make_memory(tmp_path)
    first = memory.create_named_speaker("Иван Петров")
    second = memory.create_named_speaker("Иван Петров")
    assert memory.get_handle(first) == "ivan.petrov"
    assert memory.get_handle(second) == "ivan.petrov2"
    memory.remove_speaker(second)
    third = memory.create_named_speaker("Ivan Petrov")
    assert memory.get_handle(third) == "ivan.petrov2"


def test_speaker_without_a_name_has_no_handle(tmp_path):
    memory = make_memory(tmp_path)
    memory.update_embedding("a1b2", np.array([1.0, 0.0, 0.0], dtype=np.float32))
    memory.save()
    assert memory.get_handle("a1b2") is None


def test_naming_a_speaker_gives_it_a_handle(tmp_path):
    memory = make_memory(tmp_path)
    memory.update_embedding("a1b2", np.array([1.0, 0.0, 0.0], dtype=np.float32))
    memory.save()
    rename(memory, "a1b2", "Olivia Brown")
    assert memory.get_handle("a1b2") == "olivia.brown"


def test_create_named_speaker_with_a_handle_of_its_own(tmp_path):
    memory = make_memory(tmp_path)
    spk = memory.create_named_speaker("Иван Петров", handle="@Vanya")
    assert memory.get_handle(spk) == "vanya"
    assert memory.is_handle_manual(spk) is True


# ---------------------------------------------------------------------------
# Renames
# ---------------------------------------------------------------------------

def test_rename_changes_an_automatic_handle(tmp_path):
    memory = make_memory(tmp_path)
    spk = memory.create_named_speaker("Ivan Petrov")
    rename(memory, spk, "Ivan Sidorov")
    assert memory.get_handle(spk) == "ivan.sidorov"


def test_rename_to_the_same_name_keeps_the_handle_without_a_number(tmp_path):
    memory = make_memory(tmp_path)
    spk = memory.create_named_speaker("Ivan Petrov")
    rename(memory, spk, "Ivan Petrov")
    assert memory.get_handle(spk) == "ivan.petrov"


def test_rename_keeps_a_handle_set_by_hand(tmp_path):
    memory = make_memory(tmp_path)
    spk = memory.create_named_speaker("Ivan Petrov")
    memory.set_handle(spk, "vanya")
    rename(memory, spk, "Ivan Sidorov")
    assert memory.get_handle(spk) == "vanya"


def test_clearing_the_handle_brings_back_the_automatic_one(tmp_path):
    memory = make_memory(tmp_path)
    spk = memory.create_named_speaker("Ivan Petrov")
    memory.set_handle(spk, "vanya")
    memory.set_handle(spk, None)
    assert memory.get_handle(spk) == "ivan.petrov"
    assert memory.is_handle_manual(spk) is False
    rename(memory, spk, "Ivan Sidorov")
    assert memory.get_handle(spk) == "ivan.sidorov"


# ---------------------------------------------------------------------------
# Handles set by hand
# ---------------------------------------------------------------------------

def test_set_handle_normalizes_what_was_typed(tmp_path):
    memory = make_memory(tmp_path)
    spk = memory.create_named_speaker("Ivan Petrov")
    memory.set_handle(spk, "  @Ivan.P ")
    assert memory.get_handle(spk) == "ivan.p"
    assert memory.is_handle_manual(spk) is True


def test_set_handle_taken_by_another_speaker_in_any_case(tmp_path):
    memory = make_memory(tmp_path)
    owner = memory.create_named_speaker("Ivan Petrov")
    other = memory.create_named_speaker("Olivia Brown")
    with pytest.raises(HandleTaken) as caught:
        memory.set_handle(other, "IVAN.PETROV")
    assert caught.value.owner_id == owner
    assert memory.get_handle(other) == "olivia.brown"


def test_set_handle_to_its_own_handle_is_fine(tmp_path):
    memory = make_memory(tmp_path)
    spk = memory.create_named_speaker("Ivan Petrov")
    memory.set_handle(spk, "ivan.petrov")
    assert memory.get_handle(spk) == "ivan.petrov"
    assert memory.is_handle_manual(spk) is True


@pytest.mark.parametrize("bad", ["", "@", ".ivan", "ivan petrov", "иван", "a" * 33])
def test_set_handle_rejects_a_bad_handle(tmp_path, bad):
    memory = make_memory(tmp_path)
    spk = memory.create_named_speaker("Ivan Petrov")
    with pytest.raises(InvalidHandle):
        memory.set_handle(spk, bad)
    assert memory.get_handle(spk) == "ivan.petrov"


def test_set_handle_needs_a_name(tmp_path):
    memory = make_memory(tmp_path)
    memory.update_embedding("a1b2", np.array([1.0, 0.0, 0.0], dtype=np.float32))
    memory.save()
    with pytest.raises(HandleNeedsName):
        memory.set_handle("a1b2", "vanya")


def test_check_handle_reports_the_owner(tmp_path):
    memory = make_memory(tmp_path)
    owner = memory.create_named_speaker("Ivan Petrov")
    with pytest.raises(HandleTaken):
        memory.check_handle("Ivan.Petrov")
    assert memory.check_handle("Ivan.Petrov", exclude_id=owner) == "ivan.petrov"
    with pytest.raises(InvalidHandle):
        memory.check_handle("иван")


def test_the_database_keeps_handles_unique_whatever_the_case(tmp_path):
    memory = make_memory(tmp_path)
    memory.create_named_speaker("Ivan Petrov")
    with sqlite3.connect(memory.db_path) as conn, pytest.raises(sqlite3.IntegrityError):
        conn.execute(
            "INSERT INTO speaker_meta (speaker_id, color_index, handle) VALUES ('x', 0, 'IVAN.PETROV')"
        )


# ---------------------------------------------------------------------------
# Suggestions and the format
# ---------------------------------------------------------------------------

def test_suggest_handle_numbers_a_taken_one_and_skips_the_speaker_itself(tmp_path):
    memory = make_memory(tmp_path)
    spk = memory.create_named_speaker("Ivan Petrov")
    assert memory.suggest_handle("Ivan Petrov") == "ivan.petrov2"
    assert memory.suggest_handle("Ivan Petrov", exclude_id=spk) == "ivan.petrov"
    assert memory.suggest_handle("王小明") == "speaker"


def test_handle_format_defaults_persists_and_rejects_unknown(tmp_path):
    memory = make_memory(tmp_path)
    assert memory.get_handle_format() == "first.last"
    memory.set_handle_format("f.last")
    assert make_memory(tmp_path).get_handle_format() == "f.last"
    with pytest.raises(ValueError):
        memory.set_handle_format("last.first")


def test_format_change_applies_to_new_speakers_only(tmp_path):
    memory = make_memory(tmp_path)
    old = memory.create_named_speaker("Ivan Petrov")
    memory.set_handle_format("first.l")
    new = memory.create_named_speaker("Olivia Brown")
    assert memory.get_handle(old) == "ivan.petrov"
    assert memory.get_handle(new) == "olivia.b"
    assert memory.suggest_handle("Anna Lopez") == "anna.l"
    # A rename of an automatic handle uses the format of today.
    rename(memory, old, "Ivan Sidorov")
    assert memory.get_handle(old) == "ivan.s"


# ---------------------------------------------------------------------------
# What must not wipe or lose a handle
# ---------------------------------------------------------------------------

def test_saving_a_colour_keeps_the_handle(tmp_path):
    memory = make_memory(tmp_path)
    spk = memory.create_named_speaker("Ivan Petrov")
    memory.set_color(spk, 3)
    assert make_memory(tmp_path).get_handle(spk) == "ivan.petrov"
    assert make_memory(tmp_path).get_color_index(spk) == 3


def test_another_instance_saving_embeddings_keeps_the_handle(tmp_path):
    """The pipeline holds its own SpeakerMemoryService and saves embeddings and colours."""
    api = make_memory(tmp_path)
    spk = api.create_named_speaker("Ivan Petrov")
    pipeline = make_memory(tmp_path)
    pipeline.update_embedding(spk, np.array([1.0, 0.0, 0.0], dtype=np.float32))
    pipeline.update_embedding("new-one", np.array([0.0, 1.0, 0.0], dtype=np.float32))
    pipeline.save()
    fresh = make_memory(tmp_path)
    assert fresh.get_handle(spk) == "ivan.petrov"
    assert fresh.get_handle("new-one") is None


def test_handles_are_loaded_and_reloaded(tmp_path):
    api = make_memory(tmp_path)
    other = make_memory(tmp_path)
    spk = api.create_named_speaker("Ivan Petrov")
    assert other.get_handle(spk) is None
    other.reload()
    assert other.get_handle(spk) == "ivan.petrov"


def test_clear_frees_every_handle_and_keeps_the_format(tmp_path):
    memory = make_memory(tmp_path)
    memory.set_handle_format("f.last")
    memory.create_named_speaker("Ivan Petrov")
    memory.clear()
    spk = memory.create_named_speaker("Ivan Petrov")
    assert memory.get_handle(spk) == "i.petrov"
    assert memory.get_handle_format() == "f.last"


# ---------------------------------------------------------------------------
# Migration v3 → v4: every named speaker gets a handle, by first appearance
# ---------------------------------------------------------------------------

def _make_v3_db(db_path: str) -> None:
    with sqlite3.connect(db_path) as conn:
        conn.executescript("""
            CREATE TABLE _meta (key TEXT PRIMARY KEY, value TEXT);
            INSERT INTO _meta VALUES ('schema_version', '3'), ('m001_uuid_speakers', 'done');
            CREATE TABLE speaker_embeddings (id TEXT PRIMARY KEY, embedding BLOB NOT NULL, count INTEGER NOT NULL DEFAULT 1);
            CREATE TABLE speaker_names (id INTEGER PRIMARY KEY AUTOINCREMENT, speaker_id TEXT NOT NULL, label TEXT NOT NULL, name TEXT NOT NULL);
            CREATE TABLE speaker_meta (speaker_id TEXT PRIMARY KEY, color_index INTEGER NOT NULL DEFAULT 0);
            CREATE TABLE transcriptions (id INTEGER PRIMARY KEY AUTOINCREMENT, audio_file TEXT, created_at TEXT);
            CREATE TABLE segments (id INTEGER PRIMARY KEY AUTOINCREMENT, transcription_id INTEGER, speaker_id TEXT, start REAL, end REAL, text TEXT);
        """)
        emb = np.array([1.0, 0.0, 0.0], dtype=np.float32).tobytes()
        # "later" is listed first and has the smaller id: order must come from the recordings.
        for spk, name, color in [("aaaa-later", "Иван Иванов", 2), ("bbbb-earlier", "Ivan Ivanov", 4),
                                 ("cccc-no-segments", "Ivan Ivanov", 1), ("dddd-unnamed", None, 0)]:
            conn.execute("INSERT INTO speaker_embeddings VALUES (?, ?, 1)", (spk, emb))
            conn.execute("INSERT INTO speaker_meta VALUES (?, ?)", (spk, color))
            if name:
                conn.execute("INSERT INTO speaker_names (speaker_id, label, name) VALUES (?, 'display', ?)", (spk, name))
        conn.execute("INSERT INTO transcriptions (id, audio_file, created_at) VALUES (1, 'a.wav', '2026-01-01T10:00:00')")
        conn.execute("INSERT INTO transcriptions (id, audio_file, created_at) VALUES (2, 'b.wav', '2026-02-01T10:00:00')")
        conn.execute("INSERT INTO segments (transcription_id, speaker_id, start, end, text) VALUES (2, 'aaaa-later', 0, 1, 'hi')")
        conn.execute("INSERT INTO segments (transcription_id, speaker_id, start, end, text) VALUES (1, 'bbbb-earlier', 0, 1, 'hi')")
        conn.execute("INSERT INTO segments (transcription_id, speaker_id, start, end, text) VALUES (2, 'bbbb-earlier', 1, 2, 'hi')")


def test_migration_gives_named_speakers_handles_by_first_appearance(tmp_path):
    db_path = str(tmp_path / "memory.db")
    _make_v3_db(db_path)
    memory = SpeakerMemoryService(db_path=db_path)
    assert memory.get_handle("bbbb-earlier") == "ivan.ivanov"
    assert memory.get_handle("aaaa-later") == "ivan.ivanov2"
    assert memory.get_handle("cccc-no-segments") == "ivan.ivanov3"
    assert memory.get_handle("dddd-unnamed") is None
    assert not memory.is_handle_manual("bbbb-earlier")
    # Colours are kept.
    assert memory.get_color_index("aaaa-later") == 2
    assert memory.get_color_index("bbbb-earlier") == 4
    with sqlite3.connect(db_path) as conn:
        assert conn.execute("SELECT value FROM _meta WHERE key='schema_version'").fetchone()[0] == "4"


def test_migration_runs_once_and_keeps_handles_on_the_next_start(tmp_path):
    db_path = str(tmp_path / "memory.db")
    _make_v3_db(db_path)
    SpeakerMemoryService(db_path=db_path).set_handle("aaaa-later", "vanya")
    again = SpeakerMemoryService(db_path=db_path)
    assert again.get_handle("aaaa-later") == "vanya"
    assert again.get_handle("bbbb-earlier") == "ivan.ivanov"


def test_legacy_named_speaker_gets_a_handle(tmp_path):
    """m001 names legacy speakers after the schema migrations; they get handles too."""
    db_path = str(tmp_path / "memory.db")
    with sqlite3.connect(db_path) as conn:
        conn.executescript("""
            CREATE TABLE speaker_embeddings (id TEXT PRIMARY KEY, embedding BLOB, count INTEGER NOT NULL DEFAULT 1);
            CREATE TABLE speaker_names (id INTEGER PRIMARY KEY AUTOINCREMENT, speaker_id TEXT NOT NULL REFERENCES speaker_embeddings(id), label TEXT NOT NULL, name TEXT NOT NULL);
            CREATE TABLE segments (id INTEGER PRIMARY KEY AUTOINCREMENT, transcription_id INTEGER, speaker_id TEXT);
        """)
        conn.execute("INSERT INTO speaker_embeddings VALUES ('Smith', ?, 1)",
                     (np.array([1.0, 0.0, 0.0], dtype=np.float32).tobytes(),))
    memory = SpeakerMemoryService(db_path=db_path)
    [spk] = memory.speaker_ids()
    assert memory.get_name(spk) == "Smith"
    assert memory.get_handle(spk) == "smith"
