"""Speaker identity management — storage, resolution, and in-memory cache."""
import random
import re
import sqlite3
import threading
import uuid

import numpy as np
from sklearn.metrics.pairwise import cosine_similarity

from app.config import SPEAKER_SIMILARITY_THRESHOLD
from app.logger import get_logger

PALETTE_SIZE = 5

_UUID_RE = re.compile(
    r'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
    re.IGNORECASE
)

log = get_logger("SpeakerMemoryService")


def _new_speaker_id() -> str:
    return str(uuid.uuid4())


# ---------------------------------------------------------------------------
# Repository — all SQLite I/O
# ---------------------------------------------------------------------------

class SpeakerRepository:
    """SQLite persistence for speaker embeddings and names."""

    _SCHEMA_VERSION = 3

    def __init__(self, db_path: str):
        self.db_path = db_path
        self._init_db()

    def _connect(self):
        conn = sqlite3.connect(self.db_path, timeout=30)
        conn.execute("PRAGMA foreign_keys=ON")
        return conn

    def _init_db(self):
        with self._connect() as conn:
            conn.execute("PRAGMA journal_mode=WAL")
            conn.execute("""
                CREATE TABLE IF NOT EXISTS _meta (
                    key   TEXT PRIMARY KEY,
                    value TEXT
                )
            """)
            version_row = conn.execute(
                "SELECT value FROM _meta WHERE key='schema_version'"
            ).fetchone()
            if version_row is None:
                detected = self._detect_legacy_version(conn)
                conn.execute(
                    "INSERT INTO _meta (key, value) VALUES ('schema_version', ?)",
                    (str(detected),),
                )
                current = detected
            else:
                current = int(version_row[0])
            self._run_migrations(conn, current)

            # Data migration: rename human-name IDs to UUID4
            if not conn.execute(
                "SELECT value FROM _meta WHERE key='m001_uuid_speakers'"
            ).fetchone():
                all_rows = conn.execute(
                    "SELECT id, embedding, count FROM speaker_embeddings"
                ).fetchall()
                for (old_id, _, _) in all_rows:
                    if (old_id.startswith('spk_') or old_id.startswith('SPEAKER_')
                            or _UUID_RE.match(old_id)):
                        continue
                    new_id = _new_speaker_id()
                    conn.execute("UPDATE speaker_embeddings SET id = ? WHERE id = ?", (new_id, old_id))
                    conn.execute(
                        "INSERT INTO speaker_names (speaker_id, label, name) VALUES (?, ?, ?)",
                        (new_id, "display", old_id),
                    )
                    conn.execute(
                        "UPDATE segments SET speaker_id = ? WHERE speaker_id = ?",
                        (new_id, old_id),
                    )
                conn.execute(
                    "INSERT INTO _meta (key, value) VALUES ('m001_uuid_speakers', 'done')"
                )

    @staticmethod
    def _detect_legacy_version(conn) -> int:
        tables = {
            r[0] for r in conn.execute(
                "SELECT name FROM sqlite_master WHERE type='table'"
            ).fetchall()
        }
        if "speaker_embeddings" not in tables and "speakers" not in tables:
            return 0
        if "speakers" in tables and "speaker_embeddings" not in tables:
            return 0
        emb_cols = {r[1] for r in conn.execute("PRAGMA table_info(speaker_embeddings)").fetchall()}
        return 1 if "count" in emb_cols else 0

    @staticmethod
    def _run_migrations(conn, current: int):
        if current < 1:
            tables = {
                r[0] for r in conn.execute(
                    "SELECT name FROM sqlite_master WHERE type='table'"
                ).fetchall()
            }
            if "speakers" in tables and "speaker_embeddings" not in tables:
                conn.execute("ALTER TABLE speakers RENAME TO speaker_embeddings")
            conn.execute("""
                CREATE TABLE IF NOT EXISTS speaker_embeddings (
                    id        TEXT PRIMARY KEY,
                    embedding BLOB NOT NULL,
                    count     INTEGER NOT NULL DEFAULT 1
                )
            """)
            emb_cols = {r[1] for r in conn.execute("PRAGMA table_info(speaker_embeddings)").fetchall()}
            if "count" not in emb_cols:
                conn.execute(
                    "ALTER TABLE speaker_embeddings ADD COLUMN count INTEGER NOT NULL DEFAULT 1"
                )
            conn.execute("""
                CREATE TABLE IF NOT EXISTS speaker_names (
                    id         INTEGER PRIMARY KEY AUTOINCREMENT,
                    speaker_id TEXT NOT NULL REFERENCES speaker_embeddings(id),
                    label      TEXT NOT NULL,
                    name       TEXT NOT NULL
                )
            """)
            conn.execute("UPDATE _meta SET value = '1' WHERE key = 'schema_version'")
        if current < 2:
            # Drop the FK from speaker_names.speaker_id so names can be written
            # for speakers that do not yet have an embedding row (e.g., a new
            # speaker assigned by name before any segment embedding is available).
            # SQLite cannot ALTER a constraint, so we recreate the table.
            conn.execute("ALTER TABLE speaker_names RENAME TO speaker_names_v1")
            conn.execute("""
                CREATE TABLE speaker_names (
                    id         INTEGER PRIMARY KEY AUTOINCREMENT,
                    speaker_id TEXT NOT NULL,
                    label      TEXT NOT NULL,
                    name       TEXT NOT NULL
                )
            """)
            conn.execute("INSERT INTO speaker_names SELECT * FROM speaker_names_v1")
            conn.execute("DROP TABLE speaker_names_v1")
            conn.execute("UPDATE _meta SET value = '2' WHERE key = 'schema_version'")
        if current < 3:
            conn.execute("""
                CREATE TABLE IF NOT EXISTS speaker_meta (
                    speaker_id  TEXT PRIMARY KEY,
                    color_index INTEGER NOT NULL DEFAULT 0
                )
            """)
            conn.execute("UPDATE _meta SET value = '3' WHERE key = 'schema_version'")

    def load(self) -> tuple[dict, dict]:
        with self._connect() as conn:
            rows = conn.execute("SELECT id, embedding, count FROM speaker_embeddings").fetchall()
        speakers = {}
        counts = {}
        for spk_id, blob, count in rows:
            speakers[spk_id] = np.frombuffer(blob, dtype=np.float32).copy()
            counts[spk_id] = count
        return speakers, counts

    def load_names(self) -> dict:
        with self._connect() as conn:
            rows = conn.execute("SELECT speaker_id, label, name FROM speaker_names").fetchall()
        result: dict = {}
        for spk_id, label, name in rows:
            result.setdefault(spk_id, {})[label] = name
        return result

    def save(self, dirty: set, known_speakers: dict, known_counts: dict, known_names: dict):
        """Atomic: persist dirty embeddings + all names in one transaction."""
        speakers_with_names = [s for s in known_names if s in known_speakers]
        with self._connect() as conn:
            if dirty:
                conn.executemany(
                    "INSERT OR REPLACE INTO speaker_embeddings (id, embedding, count) VALUES (?, ?, ?)",
                    [
                        (spk_id, known_speakers[spk_id].astype(np.float32).tobytes(),
                         known_counts.get(spk_id, 1))
                        for spk_id in dirty if spk_id in known_speakers
                    ],
                )
            for spk_id in speakers_with_names:
                conn.execute("DELETE FROM speaker_names WHERE speaker_id = ?", (spk_id,))
            conn.executemany(
                "INSERT INTO speaker_names (speaker_id, label, name) VALUES (?, ?, ?)",
                [
                    (spk_id, label, name)
                    for spk_id in speakers_with_names
                    for label, name in known_names[spk_id].items()
                ],
            )

    def save_names_only(self, known_names: dict, known_speakers: dict):
        with self._connect() as conn:
            for spk_id in known_names:
                conn.execute("DELETE FROM speaker_names WHERE speaker_id = ?", (spk_id,))
            conn.executemany(
                "INSERT INTO speaker_names (speaker_id, label, name) VALUES (?, ?, ?)",
                [
                    (spk_id, label, name)
                    for spk_id in known_names
                    for label, name in known_names[spk_id].items()
                ],
            )

    def load_colors(self) -> dict[str, int]:
        with self._connect() as conn:
            rows = conn.execute("SELECT speaker_id, color_index FROM speaker_meta").fetchall()
        return {spk_id: color_index for spk_id, color_index in rows}

    def save_colors(self, colors: dict[str, int]):
        with self._connect() as conn:
            conn.executemany(
                "INSERT OR REPLACE INTO speaker_meta (speaker_id, color_index) VALUES (?, ?)",
                list(colors.items()),
            )

    def remove(self, spk_id: str):
        with self._connect() as conn:
            conn.execute("DELETE FROM speaker_names WHERE speaker_id = ?", (spk_id,))
            conn.execute("DELETE FROM speaker_embeddings WHERE id = ?", (spk_id,))
            conn.execute("DELETE FROM speaker_meta WHERE speaker_id = ?", (spk_id,))

    def find_by_name_in_db(self, name: str, label: str) -> str | None:
        with self._connect() as conn:
            row = conn.execute(
                "SELECT speaker_id FROM speaker_names WHERE name = ? AND label = ?",
                (name, label),
            ).fetchone()
        return row[0] if row else None


# ---------------------------------------------------------------------------
# Resolver — pure matching logic, no storage
# ---------------------------------------------------------------------------

def _resolve_speakers(
    new_embeddings: dict,
    known_speakers: dict,
    threshold: float,
) -> dict:
    """Greedy exclusive assignment of session speakers to known profiles.

    Vectorised: one cosine_similarity call per session speaker against the full
    known-embeddings matrix instead of one call per pair.
    Returns {SPEAKER_XX: uuid4}. Does NOT mutate known_speakers.
    """
    resolved: dict = {}

    if known_speakers and new_embeddings:
        known_ids = list(known_speakers.keys())
        known_matrix = np.stack([known_speakers[k] for k in known_ids])

        candidates = []
        for speaker_id, emb in new_embeddings.items():
            scores = cosine_similarity(emb.reshape(1, -1), known_matrix)[0]
            for j, score in enumerate(scores):
                candidates.append((float(score), speaker_id, known_ids[j]))

        candidates.sort(reverse=True)

        assigned_new: set[str] = set()
        assigned_known: set[str] = set()

        for score, speaker_id, known_name in candidates:
            if score < threshold:
                break
            if speaker_id in assigned_new or known_name in assigned_known:
                continue
            resolved[speaker_id] = known_name
            assigned_new.add(speaker_id)
            assigned_known.add(known_name)
            log.info(f"{speaker_id} → {known_name} (similarity {score:.2f})")

    for speaker_id in new_embeddings:
        if speaker_id not in resolved:
            new_name = _new_speaker_id()
            log.info(f"{speaker_id} → {new_name} (new)")
            resolved[speaker_id] = new_name

    return resolved


# ---------------------------------------------------------------------------
# Facade — public API (unchanged interface)
# ---------------------------------------------------------------------------

class SpeakerMemoryService:
    """
    Facade over SpeakerRepository (I/O) and _resolve_speakers (matching).

    Speaker embeddings are persisted in a SQLite database.
    resolve() is a pure function — it never mutates known_speakers.
    Only CommitService.commit() writes to memory via update_embedding() + save().
    """

    def __init__(self, db_path="speaker_memory.db", threshold=SPEAKER_SIMILARITY_THRESHOLD):
        self.db_path = db_path
        self.threshold = threshold
        self._repo = SpeakerRepository(db_path)
        self.known_speakers, self.known_counts = self._repo.load()
        self.known_names = self._repo.load_names()
        self.known_colors: dict[str, int] = self._repo.load_colors()
        self._dirty: set[str] = set()
        self._dirty_lock = threading.Lock()
        self._dirty_colors: set[str] = set()
        log.info(f"Loaded {len(self.known_speakers)} known speakers")

    def _assign_color(self, spk_id: str) -> int:
        counts = [0] * PALETTE_SIZE
        for idx in self.known_colors.values():
            if 0 <= idx < PALETTE_SIZE:
                counts[idx] += 1
        min_count = min(counts)
        candidates = [i for i, c in enumerate(counts) if c == min_count]
        chosen = random.choice(candidates)
        self.known_colors[spk_id] = chosen
        self._dirty_colors.add(spk_id)
        return chosen

    def _ensure_color(self, spk_id: str):
        if spk_id not in self.known_colors:
            self._assign_color(spk_id)

    def get_color_index(self, spk_id: str) -> int | None:
        return self.known_colors.get(spk_id)

    def resolve(self, new_embeddings: dict) -> dict:
        """Pure speaker matching — does NOT mutate known_speakers."""
        log.info(
            f"Resolving {len(new_embeddings)} speakers against "
            f"{len(self.known_speakers)} known profiles"
        )
        return _resolve_speakers(new_embeddings, self.known_speakers, self.threshold)

    def update_embedding(self, spk_id: str, embedding: np.ndarray, count: int = 1):
        norm = np.linalg.norm(embedding)
        self.known_speakers[spk_id] = embedding / norm if norm > 0 else embedding
        self.known_counts[spk_id] = count
        with self._dirty_lock:
            self._dirty.add(spk_id)

    def get_name(self, spk_id: str, label: str = "display") -> str | None:
        return self.known_names.get(spk_id, {}).get(label)

    def set_name(self, spk_id: str, name: str, label: str = "display"):
        self.known_names.setdefault(spk_id, {})[label] = name

    def save(self):
        """Persist dirty embeddings and all names to SQLite."""
        with self._dirty_lock:
            dirty = self._dirty
            self._dirty = set()
        speakers_with_names = [s for s in self.known_names if s in self.known_speakers]
        if not dirty and not speakers_with_names:
            return
        for spk_id in dirty:
            self._ensure_color(spk_id)
        self._repo.save(dirty, self.known_speakers, self.known_counts, self.known_names)
        self._repo.save_colors(
            {spk_id: self.known_colors[spk_id] for spk_id in self._dirty_colors if spk_id in self.known_colors}
        )
        self._dirty_colors = set()
        log.info(f"Saved {len(self.known_speakers)} speakers → {self.db_path}")

    def reload_names(self):
        """Reload known_names from DB, replacing any uncommitted set_name() changes."""
        self.known_names = self._repo.load_names()

    def reload(self):
        """Reload all in-memory state from DB."""
        self.known_speakers, self.known_counts = self._repo.load()
        self.known_names = self._repo.load_names()
        self.known_colors = self._repo.load_colors()

    def save_names_only(self):
        """Persist known_names without touching speaker_embeddings."""
        for spk_id in self.known_names:
            self._ensure_color(spk_id)
        self._repo.save_names_only(self.known_names, self.known_speakers)
        self._repo.save_colors(
            {spk_id: self.known_colors[spk_id] for spk_id in self._dirty_colors if spk_id in self.known_colors}
        )
        self._dirty_colors = set()

    def find_by_name(self, name: str, label: str = "display") -> str | None:
        """Returns the speaker UUID for the given display name, or None if not found."""
        for spk_id, labels in self.known_names.items():
            if labels.get(label) == name:
                return spk_id
        return self._repo.find_by_name_in_db(name, label)

    def remove_speaker(self, spk_id: str):
        """Remove a speaker from memory and the database. No-op if not present."""
        if spk_id not in self.known_speakers:
            return
        del self.known_speakers[spk_id]
        self.known_counts.pop(spk_id, None)
        self.known_names.pop(spk_id, None)
        self.known_colors.pop(spk_id, None)
        self._repo.remove(spk_id)

    @staticmethod
    def _generate_new_speaker_id() -> str:
        return _new_speaker_id()
