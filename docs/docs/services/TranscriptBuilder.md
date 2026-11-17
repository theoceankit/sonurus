---
sidebar_position: 4
---

# Transcript Builder

`TranscriptBuilder` is a static converter service. Transforms raw ML pipeline output into the domain model (`Transcript` / `Segment`).

Does not perform inference and does not persist data. Its one rule: raw diarization labels never become the speaker of a segment (see [Speakers without a match](#speakers-without-a-match)).

---

## Position in the pipeline

```
WhisperX result (segments with words) + speaker_map
    ↓
TranscriptBuilder.build()   (splits segments at a word-speaker change)
    → Transcript (draft, embedding=None for all segments)
    ↓
TranscriptBuilder.attach_embeddings()
    → Transcript (segment.embedding populated where possible)
    ↓
user review
```

---

## Methods

### `build(result, speaker_map, audio_path) → Transcript`

Assembles a `Transcript` from the WhisperX result and the speaker mapping.

**Parameters:**
- `result` — dict from WhisperX, contains `result["segments"]` and `result["language"]`
- `speaker_map` — mapping `{"SPEAKER_00": "spk_abc", ...}` from `SpeakerMemoryService.resolve()`
- `audio_path` — path to the audio file

Each WhisperX segment (a sentence) is first [split at a speaker change](#splitting-at-a-speaker-change) of its words; then **for each segment or piece:**
```python
Segment(
    start=seg["start"],
    end=seg["end"],
    text=seg["text"].strip(),
    speaker_raw=seg.get("speaker", "UNKNOWN"),   # raw diarization ID
    speaker_resolved=<UUID>,                        # from speaker_map, or a new UUID
    speaker_final=None,                             # set only by the user
    unassigned=<no diarization speaker>,            # True for UNKNOWN
)
```

A piece carries its own `start`, `end`, `text` and `speaker`, so it resolves to the speaker of its words.

**Returns:** `Transcript` with status `"draft"`, `language` from `result["language"]` (`"unknown"` if absent — transcripts saved before the language was kept), all `embedding = None`.

---

### Splitting at a speaker change

`split_by_word_speakers(seg, language)` cuts a segment where the speaker of its words changes. Whisper writes a quick exchange or a long unpunctuated run as one sentence; `assign_word_speakers` gives the whole sentence to the speaker with the most time in it, while each word already has its own speaker. Segments stay the unit of storage and of the editor, so the pieces become segments.

- **Runs.** Consecutive words of one speaker form a run. A word without a speaker (no time, or in a diarization gap) joins the run before it; at the start of the segment, the run after it.
- **Minimum.** A run becomes a piece only with at least `MIN_PIECE_WORDS` (2) words and `MIN_PIECE_SECONDS` (1 s). A shorter run is given to a neighbour, shortest first: when both neighbours are the same speaker, the three join; otherwise it goes to the neighbour closer in time (the earlier one on a tie). A run that short is more often the diarization placing a turn boundary a few words off than an utterance: on the AMI quality set, 0.5 s moved such words away from the person who said them, and 1 s gave the most words to the right person (the word count mattered little).
- **Text.** A piece's text is its part of the segment's text, punctuation included, cut where its first word begins. If a word cannot be found in the text, the words are joined with spaces, or without them in Japanese and Chinese, where WhisperX aligns one character per word.
- **Times.** The first piece starts at the segment's start, the last ends at its end; the boundaries between them come from the word times. Pieces never overlap and their starts strictly increase (segments are identified by `start` in the API); a piece without a later start than the one before is joined to it.
- **No cut.** A segment without words, without words that have a speaker, or with one run left after the minimum stays whole, with the segment's own speaker, as before.

`SPLIT_AT_WORD_SPEAKERS` turns the cut off; only the quality tests do that, to compare with and without it in one run (`clean-nosplit`, `call-nosplit`).

---

### `attach_embeddings(transcript, segment_embeddings) → Transcript`

Assigns per-segment embeddings to transcript segments using time overlap.

**`segment_embeddings` parameter** — the per-segment list returned by `EmbeddingService.extract_all()` (second element):
```python
[{"start": float, "end": float, "speaker": str, "embedding": np.ndarray}, ...]
```

**Algorithm:** for each transcript segment, considers only diarization spans of the **same speaker** (`emb["speaker"] == seg.speaker_raw`) and picks the one with maximum time overlap:

```python
overlap = max(0.0, min(seg.end, emb["end"]) - max(seg.start, emb["start"]))
```

A segment receives the embedding of the same-speaker span with the highest overlap. If no span of its speaker overlaps it, `segment.embedding` stays `None`.

**Why same speaker only:** a segment can still span a speaker change (a run under the minimum stays in its neighbour). Picking the largest overlap regardless of speaker would attach another person's voice to the segment, and `CommitService` would then mix it into this speaker's stored embedding.

**Why overlap instead of nearest distance:**

WhisperX produces fine-grained segments; diarization produces coarser spans. A "nearest by time" approach produced incorrect matches at different granularities. Overlap works correctly in both directions: when multiple transcript segments fall within one diarization span, and vice versa.

---

## Speakers without a match

`resolve()` maps only diarization speakers that have an aggregated embedding (enough speech, see `EMBEDDING_MIN_DURATION`).

- A `SPEAKER_XX` missing from `speaker_map` gets a **new UUID** — one per label within the transcript. It is an unnamed speaker without a voice profile: it shows up in the Speakers section and can be named, reassigned or deleted, but is not recognized in later recordings.
- A segment without any diarization speaker (`UNKNOWN`) gets `speaker_resolved = None` and `unassigned = True` — it waits for the user to assign someone.

So `speaker_raw` is never the effective speaker of a stored segment. Transcript schema v6 applied the same rule to rows saved earlier.
