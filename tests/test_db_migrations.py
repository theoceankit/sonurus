"""The schema of the database: one migration chain (app/db/migrations.py).

The snapshots in tests/fixtures/db/ are the databases released versions leave
behind, made by tests/fixtures/db/make_snapshots.py from the schema code of
each tag. Each must come up to the latest schema with its data, and to exactly
the schema a new database gets.
"""
import hashlib
import sqlite3
from pathlib import Path

import pytest

from app.db import migrations
from app.db.migrations import BACKUP_SUFFIX, LATEST, SchemaRefused, ensure_schema

SNAPSHOTS = sorted((Path(__file__).parent / "fixtures" / "db").glob("*.sql"))


def _load(path: Path, snapshot: Path) -> Path:
    conn = sqlite3.connect(path)
    conn.executescript(snapshot.read_text(encoding="utf-8"))
    conn.close()
    return path


def _connect(path):
    return sqlite3.connect(path)


def _version(path) -> int:
    with _connect(path) as conn:
        return conn.execute("PRAGMA user_version").fetchone()[0]


def _signature(path) -> dict:
    """The schema as SQLite sees it, whatever text made it: tables with their
    columns, keys and foreign keys, indexes, triggers and FTS5 tables."""
    conn = _connect(path)
    sig = {}
    for kind, name, table, sql in conn.execute(
            "SELECT type, name, tbl_name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY name"):
        if kind == "table" and sql.startswith("CREATE VIRTUAL"):
            sig[name] = ("virtual", " ".join(sql.split()))
        elif kind == "table":
            sig[name] = ("table", conn.execute(f"PRAGMA table_info({name})").fetchall(),
                         conn.execute(f"PRAGMA foreign_key_list({name})").fetchall())
        elif kind == "index":
            unique = {r[1]: r[2] for r in conn.execute(f"PRAGMA index_list({table})")}[name]
            sig[name] = ("index", table, unique, conn.execute(f"PRAGMA index_xinfo({name})").fetchall())
        else:
            sig[name] = (kind, table, " ".join(sql.split()))
    conn.close()
    return sig


def _tables(path) -> set[str]:
    with _connect(path) as conn:
        return {r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type = 'table'")}


def _digest(path) -> str:
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def _rows(path) -> dict:
    """Every row of every ordinary table, for 'nothing changed'."""
    conn = _connect(path)
    names = [r[0] for r in conn.execute(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND sql NOT LIKE 'CREATE VIRTUAL%' ORDER BY name")]
    # By the first column: the FTS5 shadow tables have no rowid.
    rows = {n: conn.execute(f"SELECT * FROM {n} ORDER BY 1").fetchall() for n in names}
    conn.close()
    return rows


@pytest.fixture
def fresh(tmp_path) -> Path:
    path = tmp_path / "fresh.db"
    ensure_schema(str(path))
    return path


# ── A new database ───────────────────────────────────────────────────────────

def test_a_new_database_gets_the_latest_schema(fresh):
    assert _version(fresh) == LATEST
    assert {"transcriptions", "segments", "speaker_matches", "notes", "note_version_seq", "search_segments",
            "search_titles", "search_notes", "speaker_embeddings", "speaker_names", "speaker_meta", "_meta",
            "transcription_jobs", "transcription_queue_settings", "app_settings"} <= _tables(fresh)


def test_a_new_database_keeps_no_comments_in_its_schema(fresh):
    # SQLite keeps the text that made a table and rewrites it on ALTER TABLE.
    # SQLite 3.45 (Ubuntu 24.04, the CI runner) breaks a definition with a
    # "--" comment in it on DROP COLUMN: "incomplete input".
    conn = _connect(fresh)
    commented = [name for name, sql in conn.execute(
        "SELECT name, sql FROM sqlite_master WHERE sql IS NOT NULL") if "--" in sql]
    conn.close()
    assert commented == []
    assert "_ts_schema_version" not in _tables(fresh)
    with _connect(fresh) as conn:
        assert conn.execute("SELECT COUNT(*) FROM _meta WHERE key = 'schema_version'").fetchone()[0] == 0
        assert conn.execute("SELECT COUNT(*) FROM note_version_seq").fetchone()[0] == 1


def test_a_new_database_gets_no_copy(fresh):
    assert not Path(str(fresh) + BACKUP_SUFFIX).exists()


@pytest.mark.parametrize("service", ["storage", "memory", "jobs", "settings"])
def test_any_service_opening_a_new_database_gives_it_the_whole_schema(tmp_path, fresh, service):
    from app.services.app_settings import AppSettings
    from app.services.job_store import JobStore
    from app.services.speaker_memory_service import SpeakerMemoryService
    from app.services.transcript_storage_service import TranscriptStorageService
    make = {"storage": TranscriptStorageService, "memory": SpeakerMemoryService, "jobs": JobStore,
            "settings": AppSettings}[service]
    path = tmp_path / "service.db"
    make(db_path=str(path))
    assert _version(path) == LATEST
    assert _signature(path) == _signature(fresh)


def test_opening_again_changes_nothing(fresh):
    before = (_signature(fresh), _rows(fresh))
    ensure_schema(str(fresh))
    assert (_signature(fresh), _rows(fresh)) == before
    assert _version(fresh) == LATEST


# ── Databases of released versions ───────────────────────────────────────────

@pytest.fixture(params=SNAPSHOTS, ids=[s.stem for s in SNAPSHOTS])
def released(request, tmp_path) -> Path:
    return _load(tmp_path / "speaker_memory.db", request.param)


def test_a_released_database_comes_up_to_the_schema_of_a_new_one(released, fresh):
    ensure_schema(str(released))
    assert _version(released) == LATEST
    assert _signature(released) == _signature(fresh)


def test_a_released_database_loses_its_old_counters(released):
    ensure_schema(str(released))
    assert "_ts_schema_version" not in _tables(released)
    with _connect(released) as conn:
        keys = {r[0] for r in conn.execute("SELECT key FROM _meta")}
    assert not keys & {"schema_version", "m001_uuid_speakers"}


def test_a_released_database_keeps_its_data(released):
    ensure_schema(str(released))
    conn = _connect(released)
    assert conn.execute("SELECT title, audio_file FROM transcriptions").fetchall() == [
        ("Weekly sync", "recordings/meeting.wav")]
    assert conn.execute("SELECT text FROM segments ORDER BY id").fetchall() == [
        ("Good morning everyone",), ("Ёлки зелёные",)]
    assert conn.execute("SELECT speaker_id, unassigned FROM segments ORDER BY id").fetchall() == [
        ("6f1c2b8e-4a3d-4f7e-9b2a-1c5d8e7f9a01", 0), (None, 1)]
    assert conn.execute("SELECT name FROM speaker_names").fetchall() == [("Anna",)]
    assert conn.execute("SELECT color_index FROM speaker_meta").fetchall() == [(2,)]
    assert conn.execute("SELECT title, diarize FROM transcription_jobs").fetchall() == [("Next", 1)]
    assert conn.execute("SELECT value FROM transcription_queue_settings WHERE key = 'paused'").fetchall() == [("0",)]
    # Added on the way up: a transcript that existed counts as opened and diarized.
    assert conn.execute("SELECT opened, diarized FROM transcriptions").fetchall() == [(1, 1)]
    conn.close()


def test_the_search_index_of_a_released_database_finds_its_text(released):
    ensure_schema(str(released))
    with _connect(released) as conn:
        assert conn.execute("SELECT rowid FROM search_segments WHERE search_segments MATCH 'Елки'").fetchall() == [
            (2,)]
        assert conn.execute("SELECT rowid FROM search_titles WHERE search_titles MATCH 'weekly'").fetchall() == [(1,)]


def test_services_work_on_a_released_database(released):
    from app.services.speaker_memory_service import SpeakerMemoryService
    from app.services.transcript_storage_service import TranscriptStorageService
    storage = TranscriptStorageService(db_path=str(released))
    transcript = storage.load(1)
    assert [s.text for s in transcript.segments] == ["Good morning everyone", "Ёлки зелёные"]
    memory = SpeakerMemoryService(db_path=str(released))
    assert memory.get_name("6f1c2b8e-4a3d-4f7e-9b2a-1c5d8e7f9a01") == "Anna"


# ── The copy made before ─────────────────────────────────────────────────────

def test_a_released_database_is_copied_before_it_is_changed(released):
    original = _rows(released)
    ensure_schema(str(released))
    copy = Path(str(released) + BACKUP_SUFFIX)
    assert copy.exists()
    assert _rows(copy) == original
    assert _version(copy) == 0


def test_an_existing_copy_is_not_overwritten(released):
    copy = Path(str(released) + BACKUP_SUFFIX)
    copy.write_bytes(b"an older copy")
    ensure_schema(str(released))
    assert copy.read_bytes() == b"an older copy"
    assert _version(released) == LATEST


def test_no_copy_is_left_half_written_and_nothing_changes_when_copying_fails(released, monkeypatch):
    before = (_signature(released), _rows(released))

    def fail(source, target):
        Path(target).write_bytes(b"half")
        raise OSError("disk full")
    monkeypatch.setattr(migrations, "_copy_database", fail)
    with pytest.raises(OSError):
        ensure_schema(str(released))
    assert (_signature(released), _rows(released)) == before
    assert _version(released) == 0
    assert not Path(str(released) + BACKUP_SUFFIX).exists()


# ── A step that fails ────────────────────────────────────────────────────────

def test_a_step_that_fails_leaves_the_database_as_it_was(released, monkeypatch):
    before = (_signature(released), _rows(released))

    def fail(conn):
        raise RuntimeError("power cut")
    monkeypatch.setattr(migrations, "_drop_old_counters", fail)
    with pytest.raises(RuntimeError):
        ensure_schema(str(released))
    assert (_signature(released), _rows(released)) == before
    assert _version(released) == 0
    monkeypatch.undo()
    ensure_schema(str(released))
    assert _version(released) == LATEST


def test_a_later_step_that_fails_keeps_the_version_before_it(fresh, monkeypatch):
    def half_done(conn):
        conn.execute("ALTER TABLE transcriptions ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0")
        raise RuntimeError("power cut")
    monkeypatch.setattr(migrations, "LATEST", LATEST + 1)
    monkeypatch.setitem(migrations.STEPS, LATEST + 1, half_done)
    with pytest.raises(RuntimeError):
        ensure_schema(str(fresh))
    assert _version(fresh) == LATEST
    with _connect(fresh) as conn:
        assert "pinned" not in {r[1] for r in conn.execute("PRAGMA table_info(transcriptions)")}

    monkeypatch.setitem(migrations.STEPS, LATEST + 1,
                        lambda conn: conn.execute("ALTER TABLE transcriptions ADD COLUMN pinned INTEGER"))
    ensure_schema(str(fresh))
    assert _version(fresh) == LATEST + 1


def test_steps_run_in_order_from_the_version_found(fresh, monkeypatch):
    ran = []
    monkeypatch.setattr(migrations, "LATEST", LATEST + 2)
    monkeypatch.setitem(migrations.STEPS, LATEST + 1, lambda conn: ran.append(LATEST + 1))
    monkeypatch.setitem(migrations.STEPS, LATEST + 2, lambda conn: ran.append(LATEST + 2))
    ensure_schema(str(fresh))
    assert ran == [LATEST + 1, LATEST + 2]
    assert _version(fresh) == LATEST + 2


def test_every_version_has_its_step():
    assert sorted(migrations.STEPS) == list(range(1, LATEST + 1))


# ── Databases it refuses ─────────────────────────────────────────────────────

def _refused(path, kind):
    digest = _digest(path)
    with pytest.raises(SchemaRefused) as refused:
        ensure_schema(str(path))
    assert refused.value.kind == kind
    assert _digest(path) == digest
    assert not Path(str(path) + BACKUP_SUFFIX).exists()
    return refused.value


def test_a_database_of_a_newer_version_is_refused(fresh):
    with _connect(fresh) as conn:
        conn.execute(f"PRAGMA user_version = {LATEST + 1}")
    _refused(fresh, "newer")


def test_a_database_without_versions_is_refused(tmp_path):
    path = tmp_path / "old.db"
    with _connect(path) as conn:
        conn.execute("CREATE TABLE segments (id INTEGER PRIMARY KEY, text TEXT)")
        conn.execute("CREATE TABLE speaker_embeddings (id TEXT PRIMARY KEY, embedding BLOB)")
    _refused(path, "unsupported")


@pytest.mark.parametrize("transcripts, speakers", [(5, 3), (13, 5), (6, 2), (6, 6), (None, 5), (12, None)])
def test_a_database_with_versions_out_of_reach_is_refused(released, transcripts, speakers):
    with _connect(released) as conn:
        if transcripts is None:
            conn.execute("DROP TABLE _ts_schema_version")
        else:
            conn.execute("UPDATE _ts_schema_version SET version = ?", (transcripts,))
        if speakers is None:
            conn.execute("DELETE FROM _meta WHERE key = 'schema_version'")
        else:
            conn.execute("UPDATE _meta SET value = ? WHERE key = 'schema_version'", (str(speakers),))
    _refused(released, "unsupported")


def test_a_refusal_says_what_it_found(fresh):
    with _connect(fresh) as conn:
        conn.execute(f"PRAGMA user_version = {LATEST + 3}")
    refused = _refused(fresh, "newer")
    assert str(LATEST + 3) in str(refused)


# ── Who may change the schema ────────────────────────────────────────────────

def test_services_create_and_alter_no_tables():
    services = Path(__file__).parents[1] / "app" / "services"
    offenders = [p.name for p in services.glob("*.py")
                 if any(word in p.read_text(encoding="utf-8").upper() for word in ("CREATE TABLE", "ALTER TABLE"))]
    assert offenders == []


# ── The API at start-up ──────────────────────────────────────────────────────

def test_the_api_opens_the_database_first_of_all(tmp_path, monkeypatch):
    import app.config as config
    from app.api import main
    path = tmp_path / "speaker_memory.db"
    monkeypatch.setattr(config, "DB_PATH", str(path))
    main.open_database()
    assert _version(path) == LATEST


@pytest.mark.parametrize("kind", ["newer", "unsupported"])
def test_the_api_says_why_it_refuses_a_database(tmp_path, monkeypatch, capfd, kind):
    import app.config as config
    from app.api import main
    path = tmp_path / "speaker_memory.db"
    with _connect(path) as conn:
        if kind == "newer":
            conn.execute(f"PRAGMA user_version = {LATEST + 1}")
            conn.execute("CREATE TABLE later (x)")
        else:
            conn.execute("CREATE TABLE segments (id INTEGER PRIMARY KEY)")
    monkeypatch.setattr(config, "DB_PATH", str(path))
    with pytest.raises(SchemaRefused):
        main.open_database()
    assert f"{main.DB_REFUSED_MARKER} {kind}\n" in capfd.readouterr().err
