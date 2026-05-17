---
sidebar_position: 1
---

# Testing Overview

## How to run

```bash
# All unit tests
pytest tests/ -v

# Single file
pytest tests/test_commit_service.py -v
```

---

## Current coverage

**94 unit tests** across 10 files — no ML models are loaded.

---

### `test_commit_service.py` — 4 tests

Tests that `CommitService.commit()` correctly aggregates per-segment embeddings and writes them to speaker memory.

| Test | What it verifies |
|---|---|
| `test_commit_saves_per_segment_embedding` | Each speaker gets the mean of their segments' embeddings |
| `test_reassigned_segment_gets_its_own_embedding` | A manually reassigned segment contributes its own embedding to the new speaker, not the old one |
| `test_spk_prefix_is_persisted` | `spk_*` IDs (auto-generated for new speakers) are persisted to memory |
| `test_segment_without_embedding_is_skipped` | Segments with `embedding=None` are silently skipped, no crash |

---

### `test_embedding_service.py` — 3 tests

Tests that `extract_all()` makes a single pass through pyannote instead of two separate calls.

| Test | What it verifies |
|---|---|
| `test_extract_all_calls_inference_once_per_segment` | `_get_embedding()` is called exactly N times (once per diarization segment) |
| `test_extract_all_aggregated_matches_extract` | The aggregated dict from `extract_all()` matches `extract()` called separately |
| `test_extract_all_segments_match_extract_segments` | The per-segment list from `extract_all()` matches `extract_segments()` called separately |

---

### `test_speaker_memory_service.py` — 7 tests

Tests `resolve()` purity and greedy speaker matching.

| Test | What it verifies |
|---|---|
| `test_resolve_does_not_mutate_known_speakers` | `resolve()` never adds or modifies entries in `known_speakers` |
| `test_resolve_does_not_add_unknown_speaker_to_memory` | Unrecognised speakers get a temporary `spk_*` ID that is not saved to memory |
| `test_resolve_returns_correct_mapping` | Two speakers are correctly matched to their known profiles |
| `test_save_and_reload_persists_embeddings` | `save()` writes to SQLite; a new instance reads it back correctly |
| `test_resolve_unknown_speaker_gets_uuid` | Unknown speaker (empty memory) gets a UUID4 as their resolved ID |
| `test_two_speakers_do_not_share_resolved_id` | Two new speakers cannot be assigned the same known ID |
| `test_best_match_wins_other_gets_new_id` | When two speakers compete for one known ID, the closer match wins; the other gets a new `spk_*` ID |
| `test_two_known_speakers_matched_exclusively` | Each known speaker is claimed by at most one new speaker |

---

### `test_transcript_builder.py` — 6 tests

Tests `TranscriptBuilder.attach_embeddings()` — the time-overlap matching between WhisperX segments and diarization embeddings.

| Test | What it verifies |
|---|---|
| `test_exact_match_gets_correct_embedding` | Segment with exact timestamp match gets the correct embedding |
| `test_close_segment_gets_nearby_embedding` | Slightly offset segment (under 0.5s) gets the nearest embedding via overlap |
| `test_multiple_segments_each_gets_own_embedding` | Multiple segments each get their own nearest embedding |
| `test_distant_segment_gets_no_embedding` | A short segment with no close embedding stays `None` |
| `test_segment_with_no_embeddings_at_all_stays_none` | Empty embedding list leaves all segments as `None` |
| `test_transcript_segment_inside_diarization_segment_gets_embedding` | A small WhisperX segment fully inside a large diarization segment gets that segment's embedding via overlap |

---

### `test_transcript_storage_service.py` — 6 tests

Tests `TranscriptStorageService.save()` and schema initialisation.

| Test | What it verifies |
|---|---|
| `test_save_creates_transcription_row` | `save()` inserts a row into `transcriptions` with correct `audio_file` and `language` |
| `test_save_creates_segment_rows` | `save()` inserts all segments with correct speaker, timestamps, and text |
| `test_speaker_final_takes_priority_over_resolved` | When `speaker_final` is set, it is stored instead of `speaker_resolved` |
| `test_segment_with_no_speaker` | Segment with no speaker fields stores `NULL` in `speaker_id` |
| `test_multiple_saves_are_independent` | Saving two transcripts creates independent rows; no data leaks between them |
| `test_init_db_is_idempotent` | Creating the service twice on the same DB does not raise or duplicate schema |

---

### `test_transcript_builder_build.py` — 12 tests

Tests `TranscriptBuilder.build()` — constructing a `Transcript` from raw WhisperX output and a speaker map.

| Test | What it verifies |
|---|---|
| `test_build_creates_correct_segment_count` | Correct number of segments is created |
| `test_build_sets_timestamps_and_text` | `start`, `end`, `text` are copied from WhisperX output |
| `test_build_strips_whitespace_from_text` | Leading/trailing whitespace is stripped from text |
| `test_build_sets_audio_path_and_language` | `audio_path` and `language` are set on the transcript |
| `test_build_status_is_draft` | Newly built transcript has `status="draft"` |
| `test_build_speaker_final_starts_as_none` | `speaker_final` is `None` before any user correction |
| `test_build_sets_speaker_raw` | Raw diarization ID is stored in `speaker_raw` |
| `test_build_applies_speaker_map` | `speaker_map` is applied to set `speaker_resolved` |
| `test_build_unknown_speaker_gets_none_resolved` | Speaker not in map gets `speaker_resolved=None` |
| `test_build_missing_speaker_field_defaults_to_unknown` | Segment without a `speaker` key gets `speaker_raw="UNKNOWN"` |
| `test_build_multiple_speakers_all_resolved` | All speakers in the map are resolved correctly |
| `test_build_empty_segments` | Empty segment list produces a valid transcript with no segments |

---

### `test_transcript_storage_service_extended.py` — 16 tests

Tests `TranscriptStorageService.load()`, `update_segments_speaker()`, `update_segment_speaker()`, and `list_all()`.

| Test | What it verifies |
|---|---|
| `test_load_returns_transcript_with_correct_fields` | `load()` restores `audio_path`, `language`, `status`, `db_id` |
| `test_load_restores_segments` | Segment count, text, timestamps, and `speaker_raw` are restored |
| `test_load_restores_speaker_resolved` | `speaker_resolved` is restored from the stored `speaker_id` |
| `test_load_segments_ordered_by_start` | Segments come back sorted by `start` regardless of insert order |
| `test_load_raises_on_missing_id` | `ValueError` is raised when the given `db_id` does not exist |
| `test_update_segments_speaker_reassigns_all_matching` | All segments of a speaker are reassigned in bulk |
| `test_update_segments_speaker_leaves_other_speakers_unchanged` | Other speakers in the same transcript are not affected |
| `test_update_segments_speaker_only_affects_given_transcription` | Other transcriptions are not affected |
| `test_update_segment_speaker_changes_one_segment` | Single segment is reassigned by start/end match |
| `test_update_segment_speaker_leaves_other_segments_unchanged` | Other segments in the transcript are not affected |
| `test_list_all_returns_one_record_per_transcription` | One record per saved transcript |
| `test_list_all_record_has_expected_keys` | Each record has `id`, `title`, `section`, `status`, `duration`, `speakers` |
| `test_list_all_title_derived_from_filename` | Title is the filename stem without extension |
| `test_list_all_today_section` | Transcription saved today gets `section="Today"` |
| `test_list_all_newest_first` | Records are ordered newest first |
| `test_list_all_speakers_populated` | Speaker IDs are included in each record |

---

### `test_speaker_memory_service_names.py` — 11 tests

Tests `SpeakerMemoryService.set_name()`, `get_name()`, and name persistence through `save()` / reload.

| Test | What it verifies |
|---|---|
| `test_get_name_returns_none_when_not_set` | `get_name()` returns `None` before any name is set |
| `test_set_and_get_name` | Name set with `set_name()` is retrieved with `get_name()` |
| `test_get_name_uses_display_label_by_default` | Default label is `"display"` |
| `test_set_name_with_custom_label` | Custom label is stored and retrieved independently |
| `test_get_name_returns_none_for_wrong_label` | Wrong label returns `None` even if another label exists |
| `test_multiple_labels_for_same_speaker` | Multiple labels per speaker are stored independently |
| `test_set_name_overwrites_existing` | Calling `set_name()` again overwrites the previous value |
| `test_save_persists_name` | `save()` writes the name to SQLite; a new instance reads it back |
| `test_reload_restores_multiple_labels` | All labels are restored on reload |
| `test_name_not_persisted_without_embedding` | Names for speakers with no embedding in `known_speakers` are not saved |
| `test_names_for_multiple_speakers_all_persisted` | Names for all speakers with embeddings are persisted |

---

### `test_archive_service.py` — 16 tests

Tests `ArchiveService.archive()` and the standalone `format_time()` helper.

| Test | What it verifies |
|---|---|
| `test_archive_creates_dest_directory` | Destination directory is created |
| `test_archive_returns_dest_dir_path` | Return value is the correct destination path |
| `test_archive_writes_txt_file` | A `.txt` file is written in the destination directory |
| `test_archive_copies_audio_file` | The audio file is copied to the destination |
| `test_archive_txt_contains_segment_text` | Segment texts appear in the `.txt` output |
| `test_archive_txt_format` | Each line follows `[HH:MM - HH:MM] Speaker: text` format |
| `test_archive_uses_speaker_final_over_resolved` | `speaker_final` takes priority over `speaker_resolved` |
| `test_archive_applies_display_fn` | Custom `display_fn` is called for each speaker ID |
| `test_archive_does_not_copy_audio_if_already_at_dest` | Audio file is not overwritten if it already exists at the destination |
| `test_archive_is_idempotent_for_txt` | Archiving twice does not raise an error |
| `test_format_time_zero` | `0s` → `"00:00"` |
| `test_format_time_under_one_minute` | `45s` → `"00:45"` |
| `test_format_time_exact_one_minute` | `60s` → `"01:00"` |
| `test_format_time_minutes_and_seconds` | `125s` → `"02:05"` |
| `test_format_time_over_one_hour` | `3661s` → `"01:01:01"` |
| `test_format_time_exact_one_hour` | `3600s` → `"01:00:00"` |

---

### `test_logger.py` — 12 tests

Tests `setup_logging()` and `get_logger()` from `app/logger.py`.

| Test | What it verifies |
|---|---|
| `test_get_logger_returns_child_of_app_logger` | Logger name is `app.<name>` |
| `test_get_logger_different_names_are_different_loggers` | Two different names return different logger instances |
| `test_setup_logging_off_by_default` | `default_level="off"` produces no output |
| `test_setup_logging_info_level` | INFO messages appear on stderr |
| `test_setup_logging_debug_level` | DEBUG messages appear when level is `debug` |
| `test_setup_logging_info_suppresses_debug` | DEBUG messages are suppressed at INFO level |
| `test_setup_logging_env_var_overrides_default` | `LOG_LEVEL` env var overrides `default_level` |
| `test_setup_logging_env_var_off_silences` | `LOG_LEVEL=off` silences even when `default_level="info"` |
| `test_output_format_strips_app_prefix` | Output shows `[TranscriptionService]`, not `[app.TranscriptionService]` |
| `test_output_contains_message` | Log message text appears in output |
| `test_log_file_written` | When `LOG_FILE` is set, output is written to the file |
| `test_log_file_not_created_when_not_set` | No file is created when `LOG_FILE` is not set |

---

## Gaps

No remaining gaps — all services are covered.

---

## Planned

Per [Product Vision → Testing](../roadmap/vision.md#6-testing):

- **Integration tests** — full pipeline without ML models (mock `TranscriptionService` and `EmbeddingService`), verifying that services wire together correctly end-to-end.
