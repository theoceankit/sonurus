-- Made by tests/fixtures/db/make_snapshots.py from v0.3.1.
CREATE TABLE _meta (
                    key   TEXT PRIMARY KEY,
                    value TEXT
                );
INSERT INTO _meta (key, value) VALUES ('schema_version', '5');
INSERT INTO _meta (key, value) VALUES ('m001_uuid_speakers', 'done');
INSERT INTO _meta (key, value) VALUES ('embedding_model', 'wespeaker-resnet34-lm');
CREATE TABLE speaker_embeddings (
                    id        TEXT PRIMARY KEY,
                    embedding BLOB NOT NULL,
                    count     INTEGER NOT NULL DEFAULT 1
                );
INSERT INTO speaker_embeddings (id, embedding, count) VALUES ('6f1c2b8e-4a3d-4f7e-9b2a-1c5d8e7f9a01', X'000102030405060708090a0b0c0d0e0f', 3);
CREATE TABLE speaker_names (
                    id         INTEGER PRIMARY KEY AUTOINCREMENT,
                    speaker_id TEXT NOT NULL,
                    label      TEXT NOT NULL,
                    name       TEXT NOT NULL
                );
INSERT INTO speaker_names (id, speaker_id, label, name) VALUES (1, '6f1c2b8e-4a3d-4f7e-9b2a-1c5d8e7f9a01', 'display', 'Anna');
CREATE TABLE speaker_meta (
                    speaker_id  TEXT PRIMARY KEY,
                    color_index INTEGER NOT NULL DEFAULT 0
                , handle TEXT, handle_manual INTEGER NOT NULL DEFAULT 0, photo TEXT);
INSERT INTO speaker_meta (speaker_id, color_index, handle, handle_manual, photo) VALUES ('6f1c2b8e-4a3d-4f7e-9b2a-1c5d8e7f9a01', 2, 'anna', 0, NULL);
CREATE TABLE _ts_schema_version (version INTEGER NOT NULL DEFAULT 0);
INSERT INTO _ts_schema_version (version) VALUES (8);
CREATE TABLE transcriptions (
                id         INTEGER PRIMARY KEY AUTOINCREMENT,
                audio_file TEXT NOT NULL,
                language   TEXT,
                status     TEXT DEFAULT 'draft',
                created_at TEXT
            , title TEXT, opened INTEGER NOT NULL DEFAULT 0);
INSERT INTO transcriptions (id, audio_file, language, status, created_at, title, opened) VALUES (1, 'recordings/meeting.wav', 'en', 'draft', '2026-09-01T10:00:00', 'Weekly sync', 1);
CREATE TABLE segments (
                id               INTEGER PRIMARY KEY AUTOINCREMENT,
                transcription_id INTEGER NOT NULL REFERENCES transcriptions(id),
                speaker_id       TEXT,
                start            REAL NOT NULL,
                end              REAL NOT NULL,
                text             TEXT NOT NULL,
                speaker_raw      TEXT
            , embedding BLOB, unassigned INTEGER NOT NULL DEFAULT 0);
INSERT INTO segments (id, transcription_id, speaker_id, start, end, text, speaker_raw, embedding, unassigned) VALUES (1, 1, '6f1c2b8e-4a3d-4f7e-9b2a-1c5d8e7f9a01', 0.0, 2.5, 'Good morning everyone', 'SPEAKER_00', X'000102030405060708090a0b0c0d0e0f', 0);
INSERT INTO segments (id, transcription_id, speaker_id, start, end, text, speaker_raw, embedding, unassigned) VALUES (2, 1, NULL, 2.5, 4.0, 'Ёлки зелёные', NULL, NULL, 1);
CREATE TABLE speaker_matches (
                transcription_id INTEGER NOT NULL,
                speaker_id TEXT NOT NULL,
                score REAL NOT NULL,
                confirmed INTEGER NOT NULL DEFAULT 0,
                PRIMARY KEY (transcription_id, speaker_id)
            );
INSERT INTO speaker_matches (transcription_id, speaker_id, score, confirmed) VALUES (1, '6f1c2b8e-4a3d-4f7e-9b2a-1c5d8e7f9a01', 0.81, 1);
CREATE TABLE transcription_jobs (
                    id             TEXT PRIMARY KEY,
                    position       INTEGER NOT NULL,
                    audio_path     TEXT NOT NULL,
                    title          TEXT NOT NULL,
                    whisper_model  TEXT NOT NULL,
                    language       TEXT,
                    status         TEXT NOT NULL DEFAULT 'waiting',
                    error          TEXT,
                    error_code     TEXT,
                    error_language TEXT,
                    created_at     TEXT NOT NULL
                );
INSERT INTO transcription_jobs (id, position, audio_path, title, whisper_model, language, status, error, error_code, error_language, created_at) VALUES ('job-1', 0, 'recordings/next.wav', 'Next', 'small', NULL, 'waiting', NULL, NULL, NULL, '2026-09-01T12:00:00');
CREATE TABLE transcription_queue_settings (
                    key   TEXT PRIMARY KEY,
                    value TEXT NOT NULL
                );
INSERT INTO transcription_queue_settings (key, value) VALUES ('paused', '0');
INSERT INTO sqlite_sequence (name, seq) VALUES ('segments', 2);
INSERT INTO sqlite_sequence (name, seq) VALUES ('speaker_names', 1);
INSERT INTO sqlite_sequence (name, seq) VALUES ('transcriptions', 1);
CREATE UNIQUE INDEX speaker_meta_handle ON speaker_meta (handle COLLATE NOCASE);
CREATE INDEX idx_segments_transcription ON segments(transcription_id);
CREATE INDEX idx_segments_speaker ON segments(speaker_id);
