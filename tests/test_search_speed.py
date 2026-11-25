"""Search answers in under 200 ms on a library of about 1000 hours. Opt-in with
SONORUS_PERF=1: building the library takes longer than the rest of the suite."""

import os
import random
import sqlite3
import time
from datetime import date, timedelta

import pytest

from app.services.search_service import SearchService
from app.services.speaker_memory_service import SpeakerMemoryService
from app.services.transcript_storage_service import TranscriptStorageService

pytestmark = pytest.mark.skipif(os.getenv("SONORUS_PERF") != "1", reason="set SONORUS_PERF=1 to run")

RECORDINGS = 1000          # an hour each
SEGMENTS_PER_HOUR = 600    # about one every 6 s, as in real meetings
SPEAKERS = 40
BUDGET_MS = 200

WORDS = (
    "мы мне вот это так что как бы да нет надо можно сделать проект задача клиент встреча "
    "срок план команда релиз отчёт деньги неделя пятница вопрос ответ договор счёт продажи "
    "маркетинг дизайн сервер база данные тест ошибка пользователь интерфейс поиск запись "
    "the we have this plan release budget client meeting deadline report team"
).split()


@pytest.fixture(scope="module")
def service(tmp_path_factory):
    path = str(tmp_path_factory.mktemp("perf") / "library.db")
    storage = TranscriptStorageService(db_path=path)
    memory = SpeakerMemoryService(db_path=path)
    speakers = [f"00000000-0000-4000-8000-{i:012d}" for i in range(SPEAKERS)]
    for i, spk in enumerate(speakers[:10]):
        memory.set_name(spk, f"Speaker{i}")
    memory.save_names_only()
    memory.set_handle(speakers[0], "masha")

    rng = random.Random(7)
    conn = sqlite3.connect(path)
    started = time.perf_counter()
    for r in range(RECORDINGS):
        # created_at is the time a transcript is saved, so it grows with the ids
        day = (date(2024, 1, 1) + timedelta(days=r)).isoformat() + "T10:00:00"
        tid = conn.execute(
            "INSERT INTO transcriptions (audio_file, language, status, created_at, title) VALUES (?, 'ru', 'done', ?, ?)",
            (f"rec{r}.wav", day, f"Встреча {r}"),
        ).lastrowid
        conn.execute("INSERT INTO search_titles (rowid, text, shown) VALUES (?, ?, ?)", (tid, f"Встреча {r}", f"Встреча {r}"))
        rows = []
        for s in range(SEGMENTS_PER_HOUR):
            words = rng.choices(WORDS, k=rng.randint(4, 25))
            if rng.random() < 0.002:
                words.append("бюджет")
            rows.append((tid, speakers[rng.randrange(SPEAKERS)], s * 6.0, s * 6.0 + 5.5, " ".join(words)))
        conn.executemany(
            "INSERT INTO segments (transcription_id, speaker_id, start, end, text) VALUES (?, ?, ?, ?, ?)", rows,
        )
    conn.commit()
    conn.close()
    print(f"\nbuilt {RECORDINGS * SEGMENTS_PER_HOUR} segments in {time.perf_counter() - started:.1f} s")
    return SearchService(storage, memory)


@pytest.mark.parametrize("params", [
    {"q": "бюджет"},                                     # rare word
    {"q": "план"},                                       # common word, many hits
    {"q": "проект клиент"},                              # two common words
    {"q": "(релиз OR отчет) NOT пятница"},               # operators
    {"q": '"сделать проект"'},                           # phrase
    {"q": "план", "speaker": "masha"},                   # speaker filter
    {"q": "план", "date_from": "2025-03-01", "date_to": "2025-03-31"},
    {"q": "план", "recording_id": 500, "hits_per_recording": 50, "offset": 100},
    {"q": "мы"},                                         # a two-letter prefix of very common words
    {"q": "план", "offset": 980},                        # the last page: the oldest recordings
])
def test_search_answers_within_budget(service, params):
    service.search(**params)  # warm the page cache, as a running app has it
    timings = []
    for _ in range(5):
        started = time.perf_counter()
        service.search(**params)
        timings.append((time.perf_counter() - started) * 1000)
    best = min(timings)
    print(f"{params}: best {best:.0f} ms, worst {max(timings):.0f} ms")
    assert best < BUDGET_MS
