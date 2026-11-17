import numpy as np

from app.config import VOICE_AVERAGING_ID
from app.logger import get_logger
from app.models.segment import UNASSIGNED
from app.services.speaker_candidates import is_possible_match
from app.services.voice_vector import voice_vector

log = get_logger("CommitService")


def _has_no_profile(speaker_id: str) -> bool:
    """Raw diarization labels and UNASSIGNED never get a voice profile."""
    return speaker_id == UNASSIGNED or speaker_id.startswith('SPEAKER_')


class CommitService:
    def __init__(self, memory_service, storage_service):
        self.memory = memory_service
        self.storage = storage_service

    def _avg_from_db(self, speaker_id: str):
        """Query embeddings grouped by transcript; return normalised centroid-of-centroids
        and how many diarization turns it was averaged from.

        A transcript's centroid is the voice of the turns the speaker owns there
        (voice_vector: unit embeddings weighted by turn duration). A turn is
        owned by whoever holds most of its sentences, so a sentence moved to
        another speaker does not take the rest of the turn's voice with it
        (TranscriptStorageService.get_embeddings_grouped_by_transcript). Each
        transcript contributes one centroid regardless of how many turns it
        contains, so a long recording does not outweigh a short one.

        The result depends on the database alone, never on the stored profile, so
        recomputing gives the same profile every time.

        Transcripts where the speaker is a possible match the user has not
        confirmed yet are left out: a guess must not shape the profile it was
        matched against.
        """
        grouped = self.storage.get_embeddings_grouped_by_transcript(speaker_id, with_durations=True)
        pending = self._unconfirmed_matches(speaker_id)
        centroids = []
        total_turns = 0
        for tid, pairs in grouped.items():
            if tid in pending:
                continue
            embeddings = [e for e, _ in pairs]
            centroids.append(voice_vector(embeddings, [d for _, d in pairs]))
            total_turns += len(embeddings)
        if not centroids:
            return None, 0
        avg = np.mean(centroids, axis=0)
        norm = np.linalg.norm(avg)
        return (avg / norm if norm > 0 else avg), total_turns

    def _unconfirmed_matches(self, speaker_id: str) -> set[int]:
        """Transcripts where speaker_id is a possible match waiting for the user.
        Only a named speaker is one: nothing asks to confirm a speaker without a name."""
        if self.memory.get_name(speaker_id) is None:
            return set()
        return {
            tid for tid, match in self.storage.matches_of_speaker(speaker_id).items()
            if is_possible_match(match)
        }

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
        """Recompute embedding for one speaker from all their DB segments. With
        nothing to recompute from the profile stays as it is."""
        if _has_no_profile(speaker_id):
            return
        avg, count = self._avg_from_db(speaker_id)
        if avg is None:
            return
        self.memory.update_embedding(speaker_id, avg, count)
        self.memory.save()

    def confirm_match(self, transcript_id: int, speaker_id: str, confirmed: bool) -> bool:
        """The user confirms a possible match, or takes the confirmation back. A
        confirmed recording joins the speaker's profile at once, as a manual
        assignment would; a taken-back one leaves it again. With
        nothing to recompute from the profile stays as it is. False when the
        speaker was not recognized in the transcript."""
        if not self.storage.set_match_confirmed(transcript_id, speaker_id, confirmed):
            return False
        self.commit_speaker(speaker_id)
        return True

    def recompute_or_remove(self, speaker_id: str):
        """After a recording is deleted: recompute the speaker from what remains.
        With nothing left an unnamed speaker goes; a named one keeps their voice,
        so deleting a recording does not make the app forget a person."""
        if _has_no_profile(speaker_id):
            return
        avg, count = self._avg_from_db(speaker_id)
        if avg is None:
            self.memory.reload_names()
            if self.memory.get_name(speaker_id) is None:
                self.memory.remove_speaker(speaker_id)
            return
        self.memory.update_embedding(speaker_id, avg, count)
        self.memory.save()

    def release_speaker(self, speaker_id: str, transcript_id: int, created: bool = False):
        """After segments of transcript_id were given to another speaker:
        recompute the one who had them from what remains. With nothing left to
        compute from, the stored voice was the given-away one and goes: an
        unnamed speaker with no segments left, or one the undone assignment
        created (created=True), goes entirely; anyone else keeps their name and
        is recognized again once given segments with a voice. Segments of an
        unconfirmed possible match were never in the profile, so giving them away
        leaves it as it is."""
        if _has_no_profile(speaker_id):
            return
        avg, count = self._avg_from_db(speaker_id)
        if avg is not None:
            self.memory.update_embedding(speaker_id, avg, count)
            self.memory.save()
            return
        self.memory.reload_names()
        unnamed = self.memory.get_name(speaker_id) is None
        if (created or unnamed) and not self.storage.speaker_segments(speaker_id):
            self.memory.remove_speaker(speaker_id)
        elif speaker_id in self.memory.known_speakers and transcript_id not in self._unconfirmed_matches(speaker_id):
            self.memory.remove_embedding(speaker_id)

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
            self.release_speaker(holder, transcript_id, created=holder == created_speaker_id)
        if created_speaker_id and created_speaker_id not in holders:
            self.release_speaker(created_speaker_id, transcript_id, created=True)

    def delete_speaker(self, speaker_id: str) -> dict:
        """Delete a speaker: its segments become unassigned (they no longer feed
        any profile), then its profile, names and color are removed.
        Returns the affected {segments, transcripts} counts."""
        result = self.storage.unassign_speaker(speaker_id)
        self.memory.remove_speaker(speaker_id)
        log.info(f"Deleted speaker {speaker_id} ({result['segments']} segments unassigned)")
        return result

    def merge_speaker(self, from_id: str, into_id: str) -> dict:
        """Merge from_id into into_id, who turned out to be the same person.

        Every segment and possible match of from_id goes to into_id. into_id keeps
        their name, handle, colour and photo; one without a name takes from_id's.
        from_id is then removed entirely. into_id's voice is recomputed from all
        their segments.
        Returns the moved {segments, transcripts} counts."""
        result = self.storage.move_speaker(from_id, into_id)
        self.memory.reload_names()
        if self.memory.get_name(into_id) is None and self.memory.get_name(from_id) is not None:
            self.memory.take_identity(from_id, into_id)
        self.memory.remove_speaker(from_id)
        avg, count = self._avg_from_db(into_id)
        if avg is not None:
            self.memory.update_embedding(into_id, avg, count)
            self.memory.save()
        log.info(f"Merged speaker {from_id} into {into_id} ({result['segments']} segments moved)")
        return result

    def recompute_outdated_profiles(self) -> int:
        """Once after an update that changes how voices are averaged: recompute
        every stored profile from the database the current way (as
        commit_speaker), then mark the memory.
        A profile with nothing left to recompute from stays as it is. Needs no
        model or audio: segment embeddings are in the database. Returns how
        many profiles were recomputed."""
        if self.memory.voice_averaging() == VOICE_AVERAGING_ID:
            return 0
        updated = 0
        for spk_id in list(self.memory.known_speakers):
            if _has_no_profile(spk_id):
                continue
            avg, count = self._avg_from_db(spk_id)
            if avg is None:
                continue
            self.memory.update_embedding(spk_id, avg, count)
            updated += 1
        if updated:
            self.memory.save()
        self.memory.set_voice_averaging(VOICE_AVERAGING_ID)
        log.info(f"Voices are averaged as {VOICE_AVERAGING_ID} now: recomputed {updated} profiles")
        return updated

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
