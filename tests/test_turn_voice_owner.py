"""A diarization turn's embedding is stored on every sentence of the turn. The
turn's voice belongs to whoever holds most of it: moving one sentence to
another speaker must not hand them the voice of the person who said the rest."""
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


ANNA = _unit(1.0, 0.0, 0.0)
BORIS = _unit(0.0, 1.0, 0.0)


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


def _turn(speaker, voice, *spans):
    """Sentences of one diarization turn: all carry the turn's embedding."""
    return [Segment(s, e, f"Text {s}", "SPEAKER_00", speaker_resolved=speaker, embedding=voice)
            for s, e in spans]


def _save(storage, segments, audio="a.wav"):
    return storage.save(Transcript(audio_path=audio, language="en", segments=segments))


def _give(client, tid, starts, speaker_id):
    r = client.post(f"/transcripts/{tid}/speaker-assignments",
                    json={"segment_starts": starts, "speaker_id": speaker_id})
    assert r.status_code == 200, r.text


def _anna_recording(db):
    """Anna named with a profile from one 6 s turn of three sentences."""
    memory, storage, commit = _services(db)
    anna = memory.create_named_speaker("Anna")
    tid = _save(storage, _turn(anna, ANNA, (0.0, 2.0), (2.0, 4.0), (4.0, 6.0)))
    commit.commit_speaker(anna)
    return anna, tid


# ── The bug ──────────────────────────────────────────────────────────────────

def test_one_moved_sentence_gives_no_voice_to_a_named_speaker_without_one(api):
    client, db = api
    anna, tid = _anna_recording(db)
    boris = SpeakerMemoryService(db_path=db).create_named_speaker("Boris")

    _give(client, tid, [2.0], boris)

    memory = SpeakerMemoryService(db_path=db)
    assert boris not in memory.known_speakers
    assert memory.known_speakers[anna] == pytest.approx(ANNA, abs=1e-6)


def test_one_moved_sentence_does_not_pull_her_voice_into_his_profile(api):
    client, db = api
    anna, tid = _anna_recording(db)
    memory, storage, commit = _services(db)
    boris = memory.create_named_speaker("Boris")
    _save(storage, _turn(boris, BORIS, (0.0, 3.0)), audio="b.wav")
    commit.commit_speaker(boris)

    _give(client, tid, [2.0], boris)

    assert SpeakerMemoryService(db_path=db).known_speakers[boris] == pytest.approx(BORIS, abs=1e-6)


def test_most_of_a_turn_moved_takes_its_voice(api):
    client, db = api
    anna, tid = _anna_recording(db)
    boris = SpeakerMemoryService(db_path=db).create_named_speaker("Boris")

    _give(client, tid, [0.0, 2.0], boris)

    memory = SpeakerMemoryService(db_path=db)
    assert memory.known_speakers[boris] == pytest.approx(ANNA, abs=1e-6)
    assert anna not in memory.known_speakers


# ── Ownership in storage ─────────────────────────────────────────────────────

SPK_A = "11111111-1111-4111-8111-111111111111"
SPK_B = "22222222-2222-4222-8222-222222222222"


def test_a_turn_held_half_and_half_feeds_nobody(tmp_path):
    _, storage, _ = _services(str(tmp_path / "app.db"))
    segs = _turn(SPK_A, ANNA, (0.0, 2.0), (2.0, 4.0))
    segs[1].speaker_resolved = SPK_B
    _save(storage, segs)
    assert storage.get_embeddings_grouped_by_transcript(SPK_A) == {}
    assert storage.get_embeddings_grouped_by_transcript(SPK_B) == {}


def test_a_turn_counts_once_with_its_whole_duration(tmp_path):
    _, storage, _ = _services(str(tmp_path / "app.db"))
    segs = _turn(SPK_A, ANNA, (0.0, 2.0), (2.0, 3.0), (3.0, 4.0)) + _turn(SPK_A, BORIS, (5.0, 6.0))
    segs[2].speaker_resolved = SPK_B
    tid = _save(storage, segs)
    grouped = storage.get_embeddings_grouped_by_transcript(SPK_A, with_durations=True)
    assert [(e.tolist(), d) for e, d in grouped[tid]] == [
        (pytest.approx(ANNA.tolist()), pytest.approx(4.0)),
        (pytest.approx(BORIS.tolist()), pytest.approx(1.0)),
    ]


def test_unassigned_sentences_hold_their_share_of_a_turn(tmp_path):
    _, storage, _ = _services(str(tmp_path / "app.db"))
    segs = _turn(SPK_A, ANNA, (0.0, 1.0), (1.0, 4.0))
    segs[1].unassigned = True
    _save(storage, segs)
    assert storage.get_embeddings_grouped_by_transcript(SPK_A) == {}


def test_turns_are_owned_per_recording(tmp_path):
    # The same embedding in two recordings is two turns.
    _, storage, _ = _services(str(tmp_path / "app.db"))
    first = _save(storage, _turn(SPK_A, ANNA, (0.0, 1.0)), audio="a.wav")
    segs = _turn(SPK_B, ANNA, (0.0, 3.0)) + _turn(SPK_A, ANNA, (3.0, 4.0))
    _save(storage, segs, audio="b.wav")
    assert list(storage.get_embeddings_grouped_by_transcript(SPK_A)) == [first]


def test_one_recording_only(tmp_path):
    _, storage, _ = _services(str(tmp_path / "app.db"))
    _save(storage, _turn(SPK_A, ANNA, (0.0, 1.0)), audio="a.wav")
    second = _save(storage, _turn(SPK_A, BORIS, (0.0, 1.0)), audio="b.wav")
    assert list(storage.get_embeddings_grouped_by_transcript(SPK_A, transcript_id=second)) == [second]


# ── Candidates ───────────────────────────────────────────────────────────────

def test_a_speaker_of_one_moved_sentence_gets_no_candidates(api):
    client, db = api
    anna, tid = _anna_recording(db)
    _, storage, _ = _services(db)
    storage.set_segments_speaker(tid, [(2.0, 4.0)], SPK_B)

    r = client.get(f"/transcripts/{tid}/speaker-candidates")

    assert r.status_code == 200, r.text
    assert r.json()[SPK_B]["candidates"] == []
