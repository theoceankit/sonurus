import numpy as np

from app.logger import get_logger

log = get_logger("CommitService")


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
        if speaker_id.startswith('SPEAKER_'):
            return
        guard_emb = self.memory.known_speakers.get(speaker_id)
        avg, count = self._avg_from_db(speaker_id, guard_emb=guard_emb)
        if avg is None:
            return
        self.memory.update_embedding(speaker_id, avg, count)
        self.memory.save()

    def recompute_or_remove(self, speaker_id: str):
        """After reassignment: recompute FROM speaker, or remove if no segments left and unnamed."""
        if speaker_id.startswith('SPEAKER_'):
            return
        avg, count = self._avg_from_db(speaker_id)
        if avg is not None:
            self.memory.update_embedding(speaker_id, avg, count)
            self.memory.save()
        else:
            self.memory.known_names = self.memory._load_names()
            if self.memory.get_name(speaker_id) is None:
                self.memory.remove_speaker(speaker_id)

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
            avg, count = self._avg_from_db(spk_id)
            if avg is None:
                continue
            self.memory.update_embedding(spk_id, avg, count)
            updated += 1
        if updated:
            self.memory.save()

    def commit_new_speakers(self, transcript):
        """Commit embeddings for speakers NOT yet in memory."""
        new_ids = {
            (seg.speaker_final or seg.speaker_resolved)
            for seg in transcript.segments
            if (seg.speaker_final or seg.speaker_resolved)
            and not (seg.speaker_final or seg.speaker_resolved).startswith('SPEAKER_')
            and (seg.speaker_final or seg.speaker_resolved) not in self.memory.known_speakers
        }
        updated = 0
        for spk_id in new_ids:
            avg, count = self._avg_from_db(spk_id)
            if avg is None:
                continue
            self.memory.update_embedding(spk_id, avg, count)
            updated += 1
        if updated:
            self.memory.save()
