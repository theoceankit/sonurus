"""Speaker memory is reset when the embedding model changes.

Voices computed by the old pyannote/embedding (512 values) cannot be compared
with WeSpeaker ones (256), so on the first start with the new model every
segment embedding and every voice profile goes. Names, handles, colours and the
speaker of every segment stay; recognition starts over from new recordings.
"""
import sqlite3

import numpy as np

from app.config import EMBEDDING_MODEL_ID
from app.models.segment import Segment
from app.models.transcript import Transcript
from app.services.speaker_memory_service import SpeakerMemoryService
from app.services.transcript_storage_service import TranscriptStorageService

OLD_DIM, NEW_DIM = 512, 256


def _vec(dim, seed):
    v = np.random.default_rng(seed).normal(size=dim).astype(np.float32)
    return v / np.linalg.norm(v)


def _meta(db, key):
    with sqlite3.connect(db) as conn:
        row = conn.execute("SELECT value FROM _meta WHERE key = ?", (key,)).fetchone()
    return row[0] if row else None


def _old_model_db(tmp_path):
    """A database as the previous version left it: 512-value voices, no model mark."""
    db = str(tmp_path / "memory.db")
    memory = SpeakerMemoryService(db_path=db)
    storage = TranscriptStorageService(db_path=db)
    spk = "11111111-1111-4111-8111-111111111111"
    memory.update_embedding(spk, _vec(OLD_DIM, 1))
    memory.set_name(spk, "Alice")
    memory.save()
    memory.set_color(spk, 3)
    t = Transcript(segments=[
        Segment(0.0, 2.0, "hello", "SPEAKER_00", speaker_resolved=spk, embedding=_vec(OLD_DIM, 2)),
        Segment(2.0, 4.0, "there", "SPEAKER_00", speaker_resolved=spk, embedding=_vec(OLD_DIM, 3)),
    ], audio_path="a.wav", language="en")
    tid = storage.save(t)
    # The previous version wrote no model mark.
    with sqlite3.connect(db) as conn:
        conn.execute("DELETE FROM _meta WHERE key = 'embedding_model'")
    return db, spk, tid


def test_old_voices_are_dropped_and_everything_else_stays(tmp_path):
    db, spk, tid = _old_model_db(tmp_path)
    handle = SpeakerMemoryService(db_path=db).known_handles[spk]
    with sqlite3.connect(db) as conn:  # that first open marked it: unmark again
        conn.execute("DELETE FROM _meta WHERE key = 'embedding_model'")

    memory = SpeakerMemoryService(db_path=db)
    storage = TranscriptStorageService(db_path=db)

    assert memory.known_speakers == {}
    assert storage.get_embeddings_grouped_by_transcript(spk) == {}
    assert memory.get_name(spk) == "Alice"
    assert memory.known_handles[spk] == handle
    assert memory.get_color_index(spk) == 3
    assert spk in memory.speaker_ids()
    segs = storage.load(tid).segments
    assert [s.speaker_resolved for s in segs] == [spk, spk]
    assert all(s.embedding is None for s in segs)
    assert _meta(db, "embedding_model") == EMBEDDING_MODEL_ID


def test_schema_version_is_unchanged(tmp_path):
    db, _, _ = _old_model_db(tmp_path)
    SpeakerMemoryService(db_path=db)
    assert _meta(db, "schema_version") == "4"


def test_new_voices_survive_a_restart(tmp_path):
    db, spk, _ = _old_model_db(tmp_path)
    memory = SpeakerMemoryService(db_path=db)
    storage = TranscriptStorageService(db_path=db)
    new = _vec(NEW_DIM, 4)
    memory.update_embedding(spk, new)
    memory.save()
    storage.save(Transcript(segments=[
        Segment(0.0, 2.0, "again", "SPEAKER_00", speaker_resolved=spk, embedding=_vec(NEW_DIM, 5)),
    ], audio_path="b.wav", language="en"))

    reopened = SpeakerMemoryService(db_path=db)

    assert reopened.known_speakers[spk].shape == (NEW_DIM,)
    grouped = TranscriptStorageService(db_path=db).get_embeddings_grouped_by_transcript(spk)
    assert [e.shape for embs in grouped.values() for e in embs] == [(NEW_DIM,)]


def test_a_new_database_gets_the_mark(tmp_path):
    db = str(tmp_path / "memory.db")
    SpeakerMemoryService(db_path=db)
    assert _meta(db, "embedding_model") == EMBEDDING_MODEL_ID


def test_a_database_without_segments_table_opens(tmp_path):
    """Speaker memory may be opened before the transcript tables exist."""
    db = str(tmp_path / "memory.db")
    with sqlite3.connect(db) as conn:
        conn.execute("CREATE TABLE speakers (id TEXT PRIMARY KEY, embedding BLOB NOT NULL)")
        conn.execute("INSERT INTO speakers VALUES ('spk_1', ?)", (_vec(OLD_DIM, 1).tobytes(),))

    memory = SpeakerMemoryService(db_path=db)

    assert memory.known_speakers == {}
    assert _meta(db, "embedding_model") == EMBEDDING_MODEL_ID


def test_a_database_of_another_model_is_reset_too(tmp_path):
    """The mark names the model: any other value means other voices."""
    db, spk, _ = _old_model_db(tmp_path)
    with sqlite3.connect(db) as conn:
        conn.execute("INSERT INTO _meta (key, value) VALUES ('embedding_model', 'some-older-model')")

    assert SpeakerMemoryService(db_path=db).known_speakers == {}


def test_a_database_whose_segments_have_no_embedding_column_opens(tmp_path):
    """Older transcript schemas had no segments.embedding yet."""
    db = str(tmp_path / "memory.db")
    with sqlite3.connect(db) as conn:
        conn.execute("CREATE TABLE speakers (id TEXT PRIMARY KEY, embedding BLOB NOT NULL)")
        conn.execute("CREATE TABLE segments (id INTEGER PRIMARY KEY, transcription_id INTEGER, speaker_id TEXT)")
        conn.execute("INSERT INTO speakers VALUES ('spk_1', ?)", (_vec(OLD_DIM, 1).tobytes(),))

    assert SpeakerMemoryService(db_path=db).known_speakers == {}
    assert _meta(db, "embedding_model") == EMBEDDING_MODEL_ID
