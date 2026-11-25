"""GET /search: recordings found by the text of their segments, their title and
their note, grouped by recording, newest first, with filters and pages."""

import sqlite3

import numpy as np
import pytest
from fastapi.testclient import TestClient

from app.api.dependencies import get_memory_service, get_storage_service
from app.api.main import app
from app.models.segment import Segment
from app.models.transcript import Transcript
from app.services.speaker_memory_service import SpeakerMemoryService
from app.services.transcript_storage_service import TranscriptStorageService

MASHA = "4f9c0c1e-2a1b-4c7e-9f00-6d1a2b3c4d5e"
PETYA = "9a1b2c3d-0000-4000-8000-000000000001"
UNNAMED = "9a1b2c3d-0000-4000-8000-000000000002"


class Library:
    """A temporary database with the services the API uses, sharing one file
    as they do in the app."""

    def __init__(self, path):
        self.path = path
        self.storage = TranscriptStorageService(db_path=path)
        self.memory = SpeakerMemoryService(db_path=path)

    def name(self, spk_id, name, handle):
        self.memory.set_name(spk_id, name)
        self.memory.save_names_only()
        self.memory.set_handle(spk_id, handle)

    def recording(self, created_at, segments, title=None, audio="files/rec.wav", note=None):
        """segments: (start, text, speaker id or None for unassigned)."""
        tid = self.storage.save(Transcript(audio_path=audio, language="ru", title=title, segments=[
            Segment(start, start + 4.0, text, "SPEAKER_00", speaker_resolved=spk, unassigned=spk is None)
            for start, text, spk in segments
        ]))
        conn = sqlite3.connect(self.path)
        conn.execute("UPDATE transcriptions SET created_at = ? WHERE id = ?", (created_at, tid))
        conn.commit()
        conn.close()
        if note is not None:
            self.storage.save_note(tid, {"type": "doc", "content": [
                {"type": "paragraph", "content": inline if isinstance(inline, list) else [{"type": "text", "text": inline}]}
                for inline in note
            ]})
        return tid


@pytest.fixture
def lib(tmp_path):
    lib = Library(str(tmp_path / "library.db"))
    app.dependency_overrides[get_storage_service] = lambda: lib.storage
    app.dependency_overrides[get_memory_service] = lambda: lib.memory
    yield lib
    app.dependency_overrides.clear()


@pytest.fixture
def client(lib):
    return TestClient(app)


def _search(client, **params):
    response = client.get("/search", params=params)
    assert response.status_code == 200, response.text
    return response.json()


def _refused(client, status=400, **params):
    response = client.get("/search", params=params)
    assert response.status_code == status, response.text
    detail = response.json()["detail"]
    assert isinstance(detail, str) and "\n" not in detail
    return detail


@pytest.fixture
def three(lib):
    """Three recordings, oldest first: an October one, a November one with a
    note, a December one with the word in its title."""
    lib.name(MASHA, "Маша", "masha")
    lib.name(PETYA, "Петя", "petya")
    october = lib.recording("2026-10-05T10:00:00", [
        (0.0, "Бюджет на год утвердили", PETYA),
    ])
    november = lib.recording("2026-11-12T15:30:00", [
        (0.0, "Сначала про отпуск", MASHA),
        (10.0, "Обсудили бюджета и сметы", MASHA),
        (20.0, "бюджетный план к пятнице", PETYA),
        (30.0, "Ёлку поставим в офисе", None),
    ], note=["Бюджет согласовать с Петей", "Позвонить в банк"])
    december = lib.recording("2026-12-01T09:00:00", [
        (5.0, "Про бюджет ни слова, только отпуск", UNNAMED),
    ], title="Бюджет на 2027")
    return {"october": october, "november": november, "december": december}


# ── What is found and how it is shown ─────────────────────────────────────────

def test_recordings_come_newest_first_with_hits_in_title_segment_note_order(client, three):
    body = _search(client, q="бюджет", hits_per_recording=10)
    assert [r["recording_id"] for r in body["recordings"]] == [three["december"], three["november"], three["october"]]
    december, november, october = body["recordings"]
    assert [h["kind"] for h in december["hits"]] == ["title", "segment"]
    assert [(h["kind"], h["start"]) for h in november["hits"]] == [
        ("segment", 10.0), ("segment", 20.0), ("note", None)]
    assert november["hit_count"] == 3
    assert body["total_hits"] == 2 + 3 + 1
    assert body["total_recordings"] == 3


def test_a_recording_carries_what_a_list_of_results_needs(client, three):
    december = _search(client, q="бюджет")["recordings"][0]
    assert december["title"] == "Бюджет на 2027"
    assert december["created_at"] == "2026-12-01T09:00:00"
    assert december["duration_sec"] == 9.0


def test_a_recording_without_a_title_shows_the_file_name(client, lib):
    tid = lib.recording("2026-11-01T10:00:00", [(0.0, "бюджет", None)], audio="files/Планёрка.m4a")
    assert _search(client, q="бюджет")["recordings"][0]["title"] == "Планёрка"
    assert tid


def test_a_segment_hit_has_its_time_and_speaker(client, three):
    november = _search(client, q="смет")["recordings"][0]
    assert november["hits"] == [{
        "kind": "segment", "start": 10.0, "end": 14.0,
        "speaker_id": MASHA, "speaker_name": "Маша", "speaker_handle": "masha", "unassigned": False,
        "snippet": "Обсудили бюджета и сметы", "highlights": [[19, 24]],
    }]


def test_an_unassigned_or_unnamed_speaker_is_shown_as_such(client, three):
    hits = {h["snippet"]: h for r in _search(client, q="елку OR слова")["recordings"] for h in r["hits"]}
    yolka = hits["Ёлку поставим в офисе"]
    assert (yolka["speaker_id"], yolka["speaker_name"], yolka["unassigned"]) == (None, None, True)
    unnamed = hits["Про бюджет ни слова, только отпуск"]
    assert (unnamed["speaker_id"], unnamed["speaker_name"], unnamed["speaker_handle"]) == (UNNAMED, None, None)
    assert unnamed["unassigned"] is False


def test_the_snippet_keeps_the_text_as_written_and_marks_the_match(client, three):
    hit = _search(client, q="елку")["recordings"][0]["hits"][0]
    assert hit["snippet"] == "Ёлку поставим в офисе"
    assert hit["highlights"] == [[0, 4]]


def test_every_match_in_a_snippet_is_marked(client, three):
    hit = _search(client, q="отпуск OR бюджет", recording_id=three["december"])["recordings"][0]["hits"][1]
    text = hit["snippet"]
    assert [text[a:b] for a, b in hit["highlights"]] == ["бюджет", "отпуск"]


def test_a_note_hit_is_its_paragraph(client, three):
    note = _search(client, q="банк")["recordings"][0]["hits"][0]
    assert note["kind"] == "note"
    assert note["snippet"] == "Позвонить в банк"
    assert note["highlights"] == [[12, 16]]
    assert (note["start"], note["end"], note["speaker_id"]) == (None, None, None)


def test_a_long_segment_is_cut_to_about_thirty_words_around_the_match(client, lib):
    words = [f"слово{i}" for i in range(80)]
    words[50] = "бюджет"
    lib.recording("2026-11-01T10:00:00", [(0.0, " ".join(words), None)])
    hit = _search(client, q="бюджет")["recordings"][0]["hits"][0]
    snippet = hit["snippet"]
    assert snippet.startswith("… ") and snippet.endswith(" …")
    assert len(snippet.split()) <= 30 + 2
    (start, end), = hit["highlights"]
    assert snippet[start:end] == "бюджет"


def test_a_match_at_the_start_of_a_long_segment_is_cut_only_at_the_end(client, lib):
    words = ["бюджет"] + [f"слово{i}" for i in range(60)]
    lib.recording("2026-11-01T10:00:00", [(0.0, " ".join(words), None)])
    hit = _search(client, q="бюджет")["recordings"][0]["hits"][0]
    assert hit["snippet"].startswith("бюджет ") and hit["snippet"].endswith(" …")
    assert hit["highlights"] == [[0, 6]]


def test_nothing_found_is_an_empty_answer(client, three):
    assert _search(client, q="космос") == {"total_hits": 0, "total_recordings": 0, "recordings": [], "speakers": []}


# ── Query language ────────────────────────────────────────────────────────────

def _snippets(client, q, **params):
    return {h["snippet"] for r in _search(client, q=q, hits_per_recording=50, **params)["recordings"] for h in r["hits"]}


def test_operators_and_phrases(client, three):
    assert _snippets(client, "смет OR пятниц") == {"Обсудили бюджета и сметы", "бюджетный план к пятнице"}
    assert _snippets(client, "бюджет NOT отпуск") == {
        "Бюджет на год утвердили", "Обсудили бюджета и сметы", "бюджетный план к пятнице",
        "Бюджет согласовать с Петей", "Бюджет на 2027"}
    assert _snippets(client, "(смет OR пятниц) AND план") == {"бюджетный план к пятнице"}
    assert _snippets(client, '"бюджет на год"') == {"Бюджет на год утвердили"}


def test_lowercase_operators_are_words(client, lib):
    lib.recording("2026-11-01T10:00:00", [(0.0, "to be or not to be", None), (5.0, "to be", None)])
    assert _snippets(client, "be or not") == {"to be or not to be"}


@pytest.mark.parametrize("q", ["", "a", "NOT отпуск", "(бюджет", '"бюджет'])
def test_a_broken_query_is_refused(client, three, q):
    _refused(client, q=q)


# ── Filters ───────────────────────────────────────────────────────────────────

def test_the_speaker_filter_keeps_their_segments_and_the_titles_and_notes_of_their_recordings(client, three):
    body = _search(client, q="бюджет", speaker="@masha", hits_per_recording=10)
    assert [r["recording_id"] for r in body["recordings"]] == [three["november"]]
    assert [(h["kind"], h["start"]) for h in body["recordings"][0]["hits"]] == [("segment", 10.0), ("note", None)]
    assert body["total_hits"] == 2


def test_a_handle_is_taken_with_or_without_at_and_in_any_case(client, three):
    ids = lambda speaker: [r["recording_id"] for r in _search(client, q="бюджет", speaker=speaker)["recordings"]]
    assert ids("masha") == ids("@Masha") == [three["november"]]


def test_an_unknown_handle_is_refused(client, three):
    assert "@nobody" in _refused(client, q="бюджет", speaker="@nobody")


def test_dates_are_inclusive_local_days(client, three):
    ids = lambda **dates: [r["recording_id"] for r in _search(client, q="бюджет", **dates)["recordings"]]
    assert ids(**{"from": "2026-11-01", "to": "2026-11-30"}) == [three["november"]]
    assert ids(**{"from": "2026-11-12", "to": "2026-11-12"}) == [three["november"]]
    assert ids(**{"from": "2026-11-13"}) == [three["december"]]
    assert ids(to="2026-10-05") == [three["october"]]


@pytest.mark.parametrize("dates", [{"from": "12.11.2026"}, {"to": "2026-13-01"}, {"from": "2026-11-02", "to": "2026-11-01"}])
def test_wrong_dates_are_refused(client, three, dates):
    assert "YYYY-MM-DD" in _refused(client, q="бюджет", **dates) or "before" in _refused(client, q="бюджет", **dates)


def test_one_recording_pages_through_its_own_hits(client, three):
    page = lambda offset: _search(client, q="бюджет", recording_id=three["november"], hits_per_recording=2, offset=offset)
    first, second = page(0), page(2)
    assert [r["recording_id"] for r in first["recordings"]] == [three["november"]]
    assert [h["start"] for h in first["recordings"][0]["hits"]] == [10.0, 20.0]
    assert [h["kind"] for h in second["recordings"][0]["hits"]] == ["note"]
    assert first["recordings"][0]["hit_count"] == 3
    assert first["total_hits"] == 3 and first["total_recordings"] == 1


def test_an_unknown_recording_is_not_found(client, three):
    _refused(client, status=404, q="бюджет", recording_id=9999)


# ── Pages ─────────────────────────────────────────────────────────────────────

def test_recordings_come_in_pages_and_totals_count_them_all(client, three):
    first = _search(client, q="бюджет", limit=2)
    second = _search(client, q="бюджет", limit=2, offset=2)
    assert [r["recording_id"] for r in first["recordings"]] == [three["december"], three["november"]]
    assert [r["recording_id"] for r in second["recordings"]] == [three["october"]]
    assert first["total_recordings"] == second["total_recordings"] == 3
    assert first["total_hits"] == second["total_hits"] == 6


def test_hits_per_recording_limits_the_hits_not_the_count(client, three):
    november = _search(client, q="бюджет", hits_per_recording=1)["recordings"][1]
    assert len(november["hits"]) == 1
    assert november["hit_count"] == 3


def test_defaults_are_twenty_recordings_and_three_hits(client, lib):
    for day in range(1, 26):
        lib.recording(f"2026-11-{day:02d}T10:00:00", [(float(i * 5), "бюджет", None) for i in range(5)])
    body = _search(client, q="бюджет")
    assert len(body["recordings"]) == 20
    assert {len(r["hits"]) for r in body["recordings"]} == {3}
    assert body["total_recordings"] == 25


@pytest.mark.parametrize("params", [{"limit": 0}, {"limit": 101}, {"hits_per_recording": 51}, {"offset": -1}])
def test_limits_out_of_range_are_refused(client, three, params):
    assert client.get("/search", params={"q": "бюджет", **params}).status_code == 422


# ── Speakers ──────────────────────────────────────────────────────────────────

def test_speakers_whose_name_or_handle_starts_with_a_query_word_come_apart(client, lib):
    lib.name(MASHA, "Мария Иванова", "masha")
    lib.name(PETYA, "Пётр", "petya")
    lib.recording("2026-11-01T10:00:00", [(0.0, "бюджет", MASHA)])
    assert _search(client, q="иван")["speakers"] == [{"id": MASHA, "name": "Мария Иванова", "handle": "masha"}]
    assert _search(client, q="petya")["speakers"] == [{"id": PETYA, "name": "Пётр", "handle": "petya"}]
    assert _search(client, q="петр")["speakers"] == [{"id": PETYA, "name": "Пётр", "handle": "petya"}]
    assert _search(client, q="бюджет NOT мария")["speakers"] == []


# ── The index follows speaker names changed through the API ───────────────────

def _note_mentioning(lib, spk_id):
    return lib.recording("2026-11-01T10:00:00", [(0.0, "x", spk_id)], note=[[
        {"type": "mention", "attrs": {"kind": "speaker", "id": spk_id, "label": "old"}},
        {"type": "text", "text": " позвонит"},
    ]])


def test_a_speaker_renamed_in_the_speakers_window_is_found_in_notes_by_the_new_name(client, lib):
    lib.name(MASHA, "Маша", "masha")
    _note_mentioning(lib, MASHA)
    assert client.patch(f"/speakers/{MASHA}", json={"name": "Мария"}).status_code == 200
    assert _snippets(client, "мария") == {"Мария позвонит"}
    assert _snippets(client, "маша") == set()


def test_a_speaker_renamed_by_the_rename_route_is_found_in_notes_by_the_new_name(client, lib):
    lib.name(MASHA, "Маша", "masha")
    lib.memory.update_embedding(MASHA, np.ones(4, dtype=np.float32))
    lib.memory.save()
    _note_mentioning(lib, MASHA)
    assert client.post(f"/speakers/{MASHA}/rename", json={"name": "Мария"}).status_code == 204
    assert _snippets(client, "мария") == {"Мария позвонит"}
