"""JobStore — the transcription queue persisted in SQLite (survives restarts)."""
import pytest

from app.services.job_store import JobStore


@pytest.fixture
def store(tmp_path):
    return JobStore(db_path=str(tmp_path / "db.sqlite"))


def _add(store, name, **kw):
    return store.add(audio_path=f"/rec/{name}.wav", title=name,
                     whisper_model=kw.get("whisper_model", "small"), language=kw.get("language"))


def _ids(store):
    return [j["id"] for j in store.list()]


def test_add_returns_a_waiting_job_with_all_fields(store):
    job = _add(store, "a", language="ru")
    assert set(job) == {"id", "audio_path", "title", "whisper_model", "language", "status",
                        "error", "error_code", "error_language", "created_at"}
    assert job["status"] == "waiting"
    assert job["audio_path"] == "/rec/a.wav" and job["title"] == "a"
    assert job["whisper_model"] == "small" and job["language"] == "ru"
    assert job["error"] is None and job["error_code"] is None and job["error_language"] is None
    assert store.get(job["id"]) == job


def test_jobs_are_listed_in_the_order_they_were_added(store):
    a, b, c = (_add(store, n) for n in "abc")
    assert _ids(store) == [a["id"], b["id"], c["id"]]


def test_jobs_survive_a_new_store_on_the_same_db(tmp_path):
    path = str(tmp_path / "db.sqlite")
    job = _add(JobStore(db_path=path), "a")
    assert JobStore(db_path=path).list() == [job]


def test_get_unknown_job_is_none(store):
    assert store.get("nope") is None


def test_update_changes_only_the_given_fields(store):
    job = _add(store, "a")
    store.update(job["id"], title="Weekly sync", whisper_model="large-v3", language="en")
    got = store.get(job["id"])
    assert (got["title"], got["whisper_model"], got["language"]) == ("Weekly sync", "large-v3", "en")
    assert got["audio_path"] == "/rec/a.wav" and got["status"] == "waiting"


def test_update_can_clear_the_language(store):
    job = _add(store, "a", language="ru")
    store.update(job["id"], language=None)
    assert store.get(job["id"])["language"] is None


def test_update_rejects_unknown_fields(store):
    job = _add(store, "a")
    with pytest.raises(ValueError):
        store.update(job["id"], audio_path="/elsewhere.wav")


def test_move_to_end(store):
    a, b, c = (_add(store, n) for n in "abc")
    store.move_to_end(a["id"])
    assert _ids(store) == [b["id"], c["id"], a["id"]]


def test_added_after_move_to_end_goes_last(store):
    a, b = _add(store, "a"), _add(store, "b")
    store.move_to_end(a["id"])
    c = _add(store, "c")
    assert _ids(store) == [b["id"], a["id"], c["id"]]


def test_reorder_sets_the_given_order(store):
    a, b, c = (_add(store, n) for n in "abc")
    store.reorder([c["id"], a["id"], b["id"]])
    assert _ids(store) == [c["id"], a["id"], b["id"]]


def test_reorder_needs_exactly_the_current_jobs(store):
    a, b = _add(store, "a"), _add(store, "b")
    for bad in ([a["id"]], [a["id"], b["id"], "x"], [a["id"], a["id"]], [a["id"], "x"]):
        with pytest.raises(ValueError):
            store.reorder(bad)
    assert _ids(store) == [a["id"], b["id"]]


def test_delete(store):
    a, b = _add(store, "a"), _add(store, "b")
    assert store.delete(a["id"]) is True
    assert store.delete(a["id"]) is False
    assert _ids(store) == [b["id"]]


def test_reset_running_puts_interrupted_jobs_back_to_waiting(store):
    a, b = _add(store, "a"), _add(store, "b")
    store.update(a["id"], status="running")
    store.update(b["id"], status="failed", error="boom")
    assert store.reset_running() == 1
    assert [j["status"] for j in store.list()] == ["waiting", "failed"]


def test_clear_removes_every_job(store):
    _add(store, "a"), _add(store, "b")
    assert store.clear() == 2
    assert store.list() == []


def test_audio_paths(store):
    _add(store, "a"), _add(store, "b")
    assert store.audio_paths() == {"/rec/a.wav", "/rec/b.wav"}


def test_settings_default_and_persist(tmp_path):
    path = str(tmp_path / "db.sqlite")
    store = JobStore(db_path=path)
    assert store.get_setting("start_mode", "auto") == "auto"
    store.set_setting("start_mode", "manual")
    store.set_setting("start_mode", "manual")  # overwrite, not a second row
    assert JobStore(db_path=path).get_setting("start_mode", "auto") == "manual"


def test_shares_the_db_file_with_transcripts(tmp_path):
    """Same speaker_memory.db as the transcript tables; neither breaks the other."""
    from app.services.transcript_storage_service import TranscriptStorageService
    path = str(tmp_path / "db.sqlite")
    TranscriptStorageService(db_path=path)
    job = _add(JobStore(db_path=path), "a")
    TranscriptStorageService(db_path=path)
    assert JobStore(db_path=path).list() == [job]
