---
sidebar_position: 16
---

# Search Service

`SearchService` (`app/services/search_service.py`) finds recordings by the text of their segments, their title and their note. It serves `GET /search` ([API](../api/endpoints.md#get-search)), which the MCP server's search tool and the app's search use. It only reads: the index it searches is kept by `TranscriptStorageService` ([Search index](TranscriptStorageService.md#search-index)).

The route makes one per request from the API's `TranscriptStorageService` (for the database path) and `SpeakerMemoryService` (for speakers' names and handles).

---

## Query language

`app/services/search_query.py` turns the user's query into an FTS5 expression (`parse_query() → ParsedQuery(match, words)`):

- A word becomes `"word"*`: found by its beginning, and quoted so that no character in it (`*`, `^`, `:`, `-`, `+`) is FTS5 syntax. A word with a sign inside (`из-за`, `year's`) is split by the tokenizer into a phrase.
- `"a phrase"` becomes `"a phrase"`, found word for word, with no prefix.
- `AND`, `OR`, `NOT` in capitals and parentheses pass through; anything else is a word, `or` and `not` included. Operands side by side are joined by `AND`. FTS5 binds `NOT` tighter than `AND`, and `AND` tighter than `OR`.
- Ё becomes Е, as in the index.
- A word of signs only is left out.

What FTS5 would refuse is refused first, with `SearchQueryError` and a message of one line, "what is wrong: what to do": an empty query or one shorter than two characters, an unclosed quote, empty quotes, unbalanced or empty parentheses, an operator without words on both sides (which is also how a query of `NOT` only is refused: FTS5's `NOT` takes two operands).

`words` are the words the query looks for (not those after `NOT`, nor in a group after `NOT`), lowercased with Ё as Е; they pick the speakers of the answer.

---

## `search(q, speaker=None, date_from=None, date_to=None, recording_id=None, limit=20, offset=0, hits_per_recording=3) → dict`

Returns the body of `GET /search`. Raises `SearchQueryError` or `SearchRefused` (an unknown handle, a wrong date, `from` after `to`) for `400`, `RecordingNotFound` for `404`.

1. **Recordings with hits.** One query over the three index tables (`UNION ALL` of the matches of segments, titles and notes) counts the hits of every recording, filtered by date (`substr(created_at, 1, 10)`), recording and speaker (segments of the speaker only; a title or note only in a recording with a segment of the speaker), newest first by `created_at`, then `id`. Its counts give `hit_count`, `total_hits` and `total_recordings`.
2. **The page.** `limit` recordings from `offset`; with `recording_id`, that one recording, and `offset` applies to its hits.
3. **Hits.** One more query reads the first `hits_per_recording` hits (from `offset` with `recording_id`) of each recording on the page in the recording's order (title, segments by `start`, note blocks by position), each with FTS5's `highlight()` for the match positions.
4. **Snippets.** `highlight()` marks the matches in the indexed text; the positions apply as they are to the text as written, which has the same length. A text over 30 words is cut to 30 words starting up to 10 words before the first match, with `…` where it was cut, and the positions moved with it.
5. **Speakers.** Named speakers whose display name has a word, or whose handle, starts with one of `words` (both lowercased, Ё as Е), sorted by name, at most 10.

A segment hit carries its speaker's id, display name and handle from `SpeakerMemoryService`; a segment of no speaker is `unassigned`.

### Speed

A match is joined to `segments` for its recording, the main cost of a common word. Two things keep it down:

- The joins are written `CROSS JOIN` so SQLite reads the index first: from `segments` first, it would run the full-text query once per segment.
- The segments of a recording are inserted together by `save()`, so their ids, the rowids of `search_segments`, lie in a narrow range. The hits of a page, and every query with `recording_id`, pass that range (`rowid BETWEEN`) and FTS5 reads only it. Since `created_at` is the time a transcript was saved, the newest recordings have the newest ids and the range of a page is narrow too. The range only narrows the reading; the recording is still checked by its id.

`tests/test_search_speed.py` (`SONORUS_PERF=1`) builds 1000 one-hour recordings (600,000 segments) from a vocabulary of 60 words, so that a common word is in about one segment of five, and requires every kind of query to answer in under 200 ms; most take 5–80 ms, an `OR`/`NOT` query of common words about 110 ms.
