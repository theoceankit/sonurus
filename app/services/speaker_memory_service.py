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
from app.services.speaker_handle import (
    DEFAULT_FORMAT, HANDLE_FORMATS, base_handle, is_valid_handle, normalize_handle, unique_handle,
)

PALETTE_SIZE = 5

_UUID_RE = re.compile(
    r'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
    re.IGNORECASE
)

log = get_logger("SpeakerMemoryService")


def _new_speaker_id() -> str:
    return str(uuid.uuid4())


class InvalidHandle(ValueError):
    """Not a handle: see is_valid_handle()."""


class HandleNeedsName(ValueError):
    """Only a speaker with a name has a handle."""


class HandleTaken(ValueError):
    """Another speaker has this handle (case ignored)."""

    def __init__(self, handle: str, owner_id: str):
        super().__init__(f"@{handle} is taken")
        self.handle = handle
        self.owner_id = owner_id


# ---------------------------------------------------------------------------
# Repository — all SQLite I/O
# ---------------------------------------------------------------------------

class SpeakerRepository:
    """SQLite persistence for speaker embeddings and names."""

    _SCHEMA_VERSION = 4

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

            # After m001, which may name legacy speakers.
            self._assign_missing_handles(conn)

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
        if current < 4:
            # Handles: unique whatever the case, kept by the database itself since
            # the API and a pipeline job each hold their own SpeakerMemoryService.
            meta_cols = {r[1] for r in conn.execute("PRAGMA table_info(speaker_meta)").fetchall()}
            if "handle" not in meta_cols:
                conn.execute("ALTER TABLE speaker_meta ADD COLUMN handle TEXT")
            if "handle_manual" not in meta_cols:
                conn.execute("ALTER TABLE speaker_meta ADD COLUMN handle_manual INTEGER NOT NULL DEFAULT 0")
            conn.execute(
                "CREATE UNIQUE INDEX IF NOT EXISTS speaker_meta_handle ON speaker_meta (handle COLLATE NOCASE)"
            )
            conn.execute("UPDATE _meta SET value = '4' WHERE key = 'schema_version'")

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

    def save(self, dirty: set, known_speakers: dict, known_counts: dict,
             known_names: dict, name_ids: set):
        """Atomic: persist dirty embeddings + names of name_ids in one transaction."""
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
            self._write_names(conn, known_names, name_ids)

    def save_names_only(self, known_names: dict, name_ids: set):
        with self._connect() as conn:
            self._write_names(conn, known_names, name_ids)

    @staticmethod
    def _write_names(conn, known_names: dict, name_ids: set):
        """Replace the stored names of name_ids only — other rows are left untouched."""
        for spk_id in name_ids:
            conn.execute("DELETE FROM speaker_names WHERE speaker_id = ?", (spk_id,))
        conn.executemany(
            "INSERT INTO speaker_names (speaker_id, label, name) VALUES (?, ?, ?)",
            [
                (spk_id, label, name)
                for spk_id in name_ids
                for label, name in known_names.get(spk_id, {}).items()
            ],
        )

    def load_colors(self) -> dict[str, int]:
        with self._connect() as conn:
            rows = conn.execute("SELECT speaker_id, color_index FROM speaker_meta").fetchall()
        return {spk_id: color_index for spk_id, color_index in rows}

    def save_colors(self, colors: dict[str, int]):
        # An upsert: the row also holds the handle, which a colour must not wipe.
        with self._connect() as conn:
            conn.executemany(
                "INSERT INTO speaker_meta (speaker_id, color_index) VALUES (?, ?) "
                "ON CONFLICT(speaker_id) DO UPDATE SET color_index = excluded.color_index",
                list(colors.items()),
            )

    # --- handles -------------------------------------------------------------

    def load_handles(self) -> dict[str, tuple[str, bool]]:
        with self._connect() as conn:
            rows = conn.execute(
                "SELECT speaker_id, handle, handle_manual FROM speaker_meta WHERE handle IS NOT NULL"
            ).fetchall()
        return {spk_id: (handle, bool(manual)) for spk_id, handle, manual in rows}

    @staticmethod
    def _taken_handles(conn, exclude_id: str | None = None) -> dict[str, str]:
        """{handle in lowercase: speaker_id} of every speaker but exclude_id."""
        rows = conn.execute(
            "SELECT handle, speaker_id FROM speaker_meta WHERE handle IS NOT NULL AND speaker_id IS NOT ?",
            (exclude_id,),
        ).fetchall()
        return {handle.lower(): spk_id for handle, spk_id in rows}

    def taken_handles(self, exclude_id: str | None = None) -> dict[str, str]:
        with self._connect() as conn:
            return self._taken_handles(conn, exclude_id)

    @staticmethod
    def _read_handle_format(conn) -> str:
        row = conn.execute("SELECT value FROM _meta WHERE key = 'handle_format'").fetchone()
        return row[0] if row and row[0] in HANDLE_FORMATS else DEFAULT_FORMAT

    def read_handle_format(self) -> str:
        with self._connect() as conn:
            return self._read_handle_format(conn)

    def write_handle_format(self, fmt: str):
        with self._connect() as conn:
            conn.execute("INSERT OR REPLACE INTO _meta (key, value) VALUES ('handle_format', ?)", (fmt,))

    @staticmethod
    def _upsert_handle(conn, spk_id: str, handle: str, manual: bool):
        conn.execute(
            "INSERT INTO speaker_meta (speaker_id, handle, handle_manual) VALUES (?, ?, ?) "
            "ON CONFLICT(speaker_id) DO UPDATE SET handle = excluded.handle, handle_manual = excluded.handle_manual",
            (spk_id, handle, int(manual)),
        )

    def write_handle(self, spk_id: str, decide) -> tuple[str, bool]:
        """Write the handle decide(taken, current) returns, in one transaction that
        holds the write lock, so two writers cannot take one handle. taken is
        {handle: speaker_id} of the others; current is (handle, manual) or None.
        decide returns (handle, manual) or raises."""
        conn = self._connect()
        conn.isolation_level = None
        try:
            conn.execute("BEGIN IMMEDIATE")
            try:
                row = conn.execute(
                    "SELECT handle, handle_manual FROM speaker_meta WHERE speaker_id = ? AND handle IS NOT NULL",
                    (spk_id,),
                ).fetchone()
                current = (row[0], bool(row[1])) if row else None
                taken = self._taken_handles(conn, spk_id)
                handle, manual = decide(taken, current)
                if handle.lower() in taken:
                    raise HandleTaken(handle, taken[handle.lower()])
                self._upsert_handle(conn, spk_id, handle, manual)
                conn.execute("COMMIT")
            except BaseException:
                conn.execute("ROLLBACK")
                raise
        finally:
            conn.close()
        return handle, manual

    def _assign_missing_handles(self, conn):
        """Every named speaker without a handle gets one, the earliest heard first,
        so the speaker who came first keeps the handle without a number."""
        rows = conn.execute(
            """SELECT n.speaker_id, n.name FROM speaker_names n
               LEFT JOIN speaker_meta m ON m.speaker_id = n.speaker_id
               WHERE n.label = 'display' AND m.handle IS NULL"""
        ).fetchall()
        if not rows:
            return
        tables = {r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        first_seen: dict[str, str] = {}
        if {"segments", "transcriptions"} <= tables:
            first_seen = dict(conn.execute(
                """SELECT s.speaker_id, MIN(t.created_at) FROM segments s
                   JOIN transcriptions t ON t.id = s.transcription_id
                   WHERE s.speaker_id IS NOT NULL GROUP BY s.speaker_id"""
            ).fetchall())
        rows.sort(key=lambda r: (first_seen.get(r[0]) is None, first_seen.get(r[0]) or "", r[0]))
        fmt = self._read_handle_format(conn)
        taken = set(self._taken_handles(conn))
        for spk_id, name in rows:
            handle = unique_handle(base_handle(name, fmt), taken)
            taken.add(handle)
            self._upsert_handle(conn, spk_id, handle, False)
        log.info(f"Gave handles to {len(rows)} speakers")

    def remove(self, spk_id: str):
        with self._connect() as conn:
            conn.execute("DELETE FROM speaker_names WHERE speaker_id = ?", (spk_id,))
            conn.execute("DELETE FROM speaker_embeddings WHERE id = ?", (spk_id,))
            conn.execute("DELETE FROM speaker_meta WHERE speaker_id = ?", (spk_id,))

    def remove_embedding(self, spk_id: str):
        with self._connect() as conn:
            conn.execute("DELETE FROM speaker_embeddings WHERE id = ?", (spk_id,))

    def clear(self) -> int:
        """Delete every speaker (embeddings, names, colors). _meta is kept."""
        with self._connect() as conn:
            ids = {row[0] for row in conn.execute("SELECT id FROM speaker_embeddings")}
            ids |= {row[0] for row in conn.execute("SELECT speaker_id FROM speaker_names")}
            conn.execute("DELETE FROM speaker_names")
            conn.execute("DELETE FROM speaker_embeddings")
            conn.execute("DELETE FROM speaker_meta")
        return len(ids)

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
        # {speaker_id: (handle, set by hand)}; only named speakers have one.
        self.known_handles: dict[str, tuple[str, bool]] = self._repo.load_handles()
        self._dirty: set[str] = set()
        self._dirty_lock = threading.Lock()
        self._dirty_colors: set[str] = set()
        # Names changed via set_name() since the last save. Only these are
        # written, so a long-lived instance with a stale snapshot (e.g. the
        # pipeline job) never reverts names changed through another instance.
        self._dirty_names: set[str] = set()
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

    def set_color(self, spk_id: str, color_index: int):
        """Persist a user-chosen palette color. Raises ValueError outside the palette."""
        if not 0 <= color_index < PALETTE_SIZE:
            raise ValueError(f"color_index must be in 0..{PALETTE_SIZE - 1}")
        self.known_colors[spk_id] = color_index
        self._dirty_colors.discard(spk_id)
        self._repo.save_colors({spk_id: color_index})

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
        self._dirty_names.add(spk_id)

    def save(self):
        """Persist dirty embeddings and changed names of speakers that have an embedding."""
        with self._dirty_lock:
            dirty = self._dirty
            self._dirty = set()
        name_ids = {s for s in self._dirty_names if s in self.known_speakers}
        if not dirty and not name_ids:
            return
        for spk_id in dirty:
            self._ensure_color(spk_id)
        self._repo.save(dirty, self.known_speakers, self.known_counts, self.known_names, name_ids)
        self._dirty_names -= name_ids
        self._repo.save_colors(
            {spk_id: self.known_colors[spk_id] for spk_id in self._dirty_colors if spk_id in self.known_colors}
        )
        self._dirty_colors = set()
        log.info(f"Saved {len(self.known_speakers)} speakers → {self.db_path}")

    def reload_names(self):
        """Reload known_names from DB, replacing any uncommitted set_name() changes."""
        self.known_names = self._repo.load_names()
        self._dirty_names = set()

    def reload(self):
        """Reload all in-memory state from DB."""
        self.known_speakers, self.known_counts = self._repo.load()
        self.known_names = self._repo.load_names()
        self.known_colors = self._repo.load_colors()
        self.known_handles = self._repo.load_handles()
        self._dirty_names = set()

    def save_names_only(self):
        """Persist names changed since the last save without touching speaker_embeddings.
        A speaker whose handle was not set by hand gets one from the new name."""
        named = set(self._dirty_names)
        for spk_id in self._dirty_names:
            self._ensure_color(spk_id)
        self._repo.save_names_only(self.known_names, self._dirty_names)
        self._dirty_names = set()
        self._repo.save_colors(
            {spk_id: self.known_colors[spk_id] for spk_id in self._dirty_colors if spk_id in self.known_colors}
        )
        self._dirty_colors = set()
        for spk_id in named:
            self._follow_name(spk_id)

    def find_by_name(self, name: str, label: str = "display") -> str | None:
        """Returns the speaker UUID for the given display name, or None if not found."""
        for spk_id, labels in self.known_names.items():
            if labels.get(label) == name:
                return spk_id
        return self._repo.find_by_name_in_db(name, label)

    def speaker_ids(self) -> set[str]:
        """Every speaker memory knows about: with a voice profile, a name, or both."""
        return set(self.known_speakers) | set(self.known_names)

    def remove_speaker(self, spk_id: str):
        """Remove a speaker (profile, names, color) from memory and the database.
        No-op if not present."""
        self.known_speakers.pop(spk_id, None)
        self.known_counts.pop(spk_id, None)
        self.known_names.pop(spk_id, None)
        self.known_colors.pop(spk_id, None)
        self.known_handles.pop(spk_id, None)
        self._dirty_names.discard(spk_id)
        self._dirty_colors.discard(spk_id)
        with self._dirty_lock:
            self._dirty.discard(spk_id)
        self._repo.remove(spk_id)

    def remove_embedding(self, spk_id: str):
        """Forget a speaker's voice and keep their name and color."""
        self.known_speakers.pop(spk_id, None)
        self.known_counts.pop(spk_id, None)
        with self._dirty_lock:
            self._dirty.discard(spk_id)
        self._repo.remove_embedding(spk_id)

    def clear(self) -> int:
        """Delete all speakers from the database and drop the in-memory state,
        including pending (dirty) changes, so a later save() cannot restore them.
        Used only by the full data reset. Returns the number of speakers removed."""
        with self._dirty_lock:
            self._dirty = set()
            removed = self._repo.clear()
        self.known_speakers = {}
        self.known_counts = {}
        self.known_names = {}
        self.known_colors = {}
        self.known_handles = {}
        self._dirty_names = set()
        self._dirty_colors = set()
        log.info(f"Cleared all speakers ({removed})")
        return removed

    def create_named_speaker(self, name: str, label: str = "display", handle: str | None = None) -> str:
        """Create a new speaker ID with a persisted display name and a handle: the
        one given (checked before anything is created), else one from the name.

        Writes speaker_names and speaker_meta only; the embedding is added by
        CommitService once segments with embeddings are assigned to the new ID.
        """
        if handle is not None:
            self.check_handle(handle)
        spk_id = _new_speaker_id()
        self.set_name(spk_id, name, label)
        self.save_names_only()
        if handle is not None:
            self.set_handle(spk_id, handle)
        return spk_id

    # --- handles -------------------------------------------------------------

    def get_handle(self, spk_id: str) -> str | None:
        return self.known_handles.get(spk_id, (None, False))[0]

    def is_handle_manual(self, spk_id: str) -> bool:
        return self.known_handles.get(spk_id, (None, False))[1]

    def get_handle_format(self) -> str:
        return self._repo.read_handle_format()

    def set_handle_format(self, fmt: str):
        """The format of handles made from now on; handles already given stay."""
        if fmt not in HANDLE_FORMATS:
            raise ValueError(f"format must be one of {', '.join(HANDLE_FORMATS)}")
        self._repo.write_handle_format(fmt)

    def suggest_handle(self, name: str, exclude_id: str | None = None) -> str:
        """The handle a speaker named name would get now, numbered if taken."""
        return unique_handle(base_handle(name, self.get_handle_format()), set(self._repo.taken_handles(exclude_id)))

    def check_handle(self, text: str, exclude_id: str | None = None) -> str:
        """The handle text stands for, if it is valid and free. Raises InvalidHandle or HandleTaken."""
        handle = normalize_handle(text)
        if not is_valid_handle(handle):
            raise InvalidHandle(f"@{handle} is not a valid handle" if handle else "The handle is empty")
        owner = self._repo.taken_handles(exclude_id).get(handle)
        if owner is not None:
            raise HandleTaken(handle, owner)
        return handle

    def set_handle(self, spk_id: str, text: str | None):
        """Set a handle by hand, or with None go back to the one made from the name."""
        name = self.get_name(spk_id)
        if not name:
            raise HandleNeedsName("Only a speaker with a name has a handle")
        if text is None:
            self._write_auto_handle(spk_id, name, keep_manual=False)
            return
        handle = normalize_handle(text)
        if not is_valid_handle(handle):
            raise InvalidHandle(f"@{handle} is not a valid handle" if handle else "The handle is empty")

        def decide(taken, _current):
            if handle in taken:
                raise HandleTaken(handle, taken[handle])
            return handle, True

        self._store_handle(spk_id, decide)

    def _follow_name(self, spk_id: str):
        name = self.get_name(spk_id)
        if name:
            self._write_auto_handle(spk_id, name, keep_manual=True)

    def _write_auto_handle(self, spk_id: str, name: str, keep_manual: bool):
        fmt = self.get_handle_format()

        def decide(taken, current):
            if keep_manual and current and current[1]:
                return current
            return unique_handle(base_handle(name, fmt), set(taken)), False

        self._store_handle(spk_id, decide)

    def _store_handle(self, spk_id: str, decide):
        self._ensure_color(spk_id)
        self._repo.save_colors(
            {s: self.known_colors[s] for s in self._dirty_colors if s in self.known_colors}
        )
        self._dirty_colors = set()
        self.known_handles[spk_id] = self._repo.write_handle(spk_id, decide)
