import numpy as np

from app.logger import get_logger
from app.models.segment import UNASSIGNED

log = get_logger("CommitService")


def _has_no_profile(speaker_id: str) -> bool:
    """Raw diarization labels and UNASSIGNED never get a voice profile."""
    return speaker_id == UNASSIGNED or speaker_id.startswith('SPEAKER_')


class CommitService:
    def __init__(self, memory_service, storage_service):
        self.memory = memory_service
        self.storage = storage_service

    def _avg_from_db(self, speaker_id: str, guard_emb=None):
        """Query embeddings grouped by transcript; return normalised centroid-of-centroids.

        Each transcript contributes one centroid regardless of how many segments it
        contains, so a long recording with many segments does not outweigh a short one.

        guard_emb: if provided, transcripts whose centroid has cosine similarity
        below self.memory.threshold with guard_emb are excluded from the average.
        This prevents acoustically incompatible recordings from corrupting a
        speaker's stored embedding. Pass the current stored embedding to activate.
        """
        grouped = self.storage.get_embeddings_grouped_by_transcript(speaker_id)
        if not grouped:
            return None, 0
        centroids = []
        total_segments = 0
        for embeddings in grouped.values():
            c = np.mean(embeddings, axis=0)
            norm = np.linalg.norm(c)
            c_norm = c / norm if norm > 0 else c
            if guard_emb is not None:
                sim = float(np.dot(c_norm, guard_emb))
                if sim < self.memory.threshold:
                    log.info(
                        f"Excluding transcript from {speaker_id} embedding "
                        f"(centroid sim={sim:.2f} < threshold {self.memory.threshold})"
                    )
                    continue
            centroids.append(c_norm)
            total_segments += len(embeddings)
        if not centroids:
            return None, 0
        avg = np.mean(centroids, axis=0)
        norm = np.linalg.norm(avg)
        return (avg / norm if norm > 0 else avg), total_segments

    def commit(self, transcript):
        """Recompute embeddings for all speakers in transcript from all DB segments."""
        speaker_ids = {
            seg.speaker_final or seg.speaker_resolved
            for seg in transcript.segments
            if (seg.speaker_final or seg.speaker_resolved)
            and not (seg.speaker_final or seg.speaker_resolved).startswith('SPEAKER_')
        }
        updated = 0
        for spk_id in speaker_ids:
            avg, count = self._avg_from_db(spk_id)
            if avg is None:
                continue
            self.memory.update_embedding(spk_id, avg, count)
            updated += 1
        if updated:
            self.memory.save()
        log.info(f"Committed {updated} speakers to memory")

    def commit_speaker(self, speaker_id: str):
        """Recompute embedding for one speaker from all their DB segments.

        Transcripts whose centroid is incompatible with the existing stored
        embedding (cosine similarity < threshold) are excluded from the average.
        This prevents a manually-labelled recording from corrupting the embedding
        when the system itself would not have recognised the speaker there.
        """
        if _has_no_profile(speaker_id):
            return
        guard_emb = self.memory.known_speakers.get(speaker_id)
        avg, count = self._avg_from_db(speaker_id, guard_emb=guard_emb)
        if avg is None:
            return
        self.memory.update_embedding(speaker_id, avg, count)
        self.memory.save()

    def recompute_or_remove(self, speaker_id: str):
        """After reassignment: recompute FROM speaker, or remove if no segments left and unnamed."""
        if _has_no_profile(speaker_id):
            return
        # Un-guarded check: are there any segments with embeddings at all?
        any_avg, _ = self._avg_from_db(speaker_id)
        if any_avg is None:
            # No segments remain → remove if unnamed
            self.memory.reload_names()
            if self.memory.get_name(speaker_id) is None:
                self.memory.remove_speaker(speaker_id)
            return
        # Segments exist → recompute with guard to preserve embedding quality
        guard_emb = self.memory.known_speakers.get(speaker_id)
        avg, count = self._avg_from_db(speaker_id, guard_emb=guard_emb)
        if avg is None:
            # All transcripts filtered by guard → keep existing embedding unchanged
            log.info(
                f"recompute_or_remove: all transcripts for {speaker_id} filtered by guard "
                f"— keeping existing embedding"
            )
            return
        self.memory.update_embedding(speaker_id, avg, count)
        self.memory.save()

    def undo_assignment(self, transcript_id: int, ranges, speaker_id: str, holders, created_speaker_id: str | None = None):
        """Put segments back under the speaker they had before an assignment, then
        recompute that speaker and the holders, who have them now.

        created_speaker_id is a speaker the assignment made: with no segments left
        they go entirely. Otherwise the undone voice would stay as their profile and
        catch the same voice in the next recording.
        """
        self.storage.set_segments_speaker(transcript_id, ranges, speaker_id)
        self.commit_speaker(speaker_id)
        for holder in set(holders) - {speaker_id}:
            self._release(holder, created=holder == created_speaker_id)
        if created_speaker_id and created_speaker_id not in holders:
            self._release(created_speaker_id, created=True)

    def _release(self, speaker_id: str, created: bool):
        if created and not self.storage.speaker_segments(speaker_id):
            self.memory.remove_speaker(speaker_id)
            return
        self.recompute_or_remove(speaker_id)
        # Named and left with no voice to compute from: what is stored came from the undone one.
        if speaker_id in self.memory.known_speakers and self._avg_from_db(speaker_id)[0] is None:
            self.memory.remove_embedding(speaker_id)

    def delete_speaker(self, speaker_id: str) -> dict:
        """Delete a speaker: its segments become unassigned (they no longer feed
        any profile), then its profile, names and color are removed.
        Returns the affected {segments, transcripts} counts."""
        result = self.storage.unassign_speaker(speaker_id)
        self.memory.remove_speaker(speaker_id)
        log.info(f"Deleted speaker {speaker_id} ({result['segments']} segments unassigned)")
        return result

    def commit_recognized_speakers(self, transcript):
        """Update embeddings for speakers already in memory (auto-recognized in new session)."""
        recognized = {
            seg.speaker_resolved
            for seg in transcript.segments
            if seg.speaker_resolved
            and not seg.speaker_resolved.startswith('SPEAKER_')
            and seg.speaker_resolved in self.memory.known_speakers
        }
        updated = 0
        for spk_id in recognized:
            guard_emb = self.memory.known_speakers.get(spk_id)
            avg, count = self._avg_from_db(spk_id, guard_emb=guard_emb)
            if avg is None:
                continue
            self.memory.update_embedding(spk_id, avg, count)
            updated += 1
        if updated:
            self.memory.save()
