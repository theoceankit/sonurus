import uuid

from app.services.transcription_service import TranscriptionService
from app.services.embedding_service import EmbeddingService
from app.services.speaker_memory_service import SpeakerMemoryService
from app.services.transcript_builder import TranscriptBuilder
from app.services.commit_service import CommitService
from app.services.transcript_storage_service import TranscriptStorageService
from app.models.transcript import Transcript


class TranscriptionController:
    def __init__(
        self,
        transcription_service: TranscriptionService,
        embedding_service: EmbeddingService,
        memory_service: SpeakerMemoryService,
        commit_service: CommitService,
        storage_service: TranscriptStorageService,
    ):
        self.transcription_service = transcription_service
        self.embedding_service = embedding_service
        self.memory_service = memory_service
        self.commit_service = commit_service
        self.storage_service = storage_service

    def run_pipeline(self, audio_path: str, on_progress=None) -> Transcript:
        def report(msg):
            if on_progress:
                on_progress(msg)

        report("Transcribing audio…")
        result, audio, diarization = self.transcription_service.transcribe(audio_path)

        report("Identifying speakers…")
        aggregated, segments = self.embedding_service.extract_all(audio, diarization)
        speaker_map = self.memory_service.resolve(aggregated)

        report("Building transcript…")
        transcript = TranscriptBuilder.build(result, speaker_map, audio_path)
        TranscriptBuilder.attach_embeddings(transcript, segments)

        return transcript

    def reassign_speaker(self, transcript: Transcript, segment_idx: int, new_speaker_id: str):
        transcript.segments[segment_idx].speaker_final = new_speaker_id

    def reassign_all_by_speaker(self, transcript: Transcript, from_speaker: str, new_speaker_id: str):
        for seg in transcript.segments:
            effective = seg.speaker_final or seg.speaker_resolved or seg.speaker_raw
            if effective == from_speaker:
                seg.speaker_final = new_speaker_id

    def create_new_speaker(self) -> str:
        return f"spk_{uuid.uuid4().hex[:8]}"

    def get_display_name(self, spk_id: str) -> str:
        return self.memory_service.get_name(spk_id, label="display") or spk_id

    def rename_speaker(self, spk_id: str, name: str, label: str = "display"):
        self.memory_service.set_name(spk_id, name, label)

    def resolve_display_name_to_id(self, name: str) -> str | None:
        for spk_id, labels in self.memory_service.known_names.items():
            if labels.get("display") == name:
                return spk_id
        return None

    def get_all_known_speakers(self) -> list[tuple[str, str]]:
        """Returns [(spk_id, display_name), ...] for all speakers in the database."""
        return [
            (spk_id, self.get_display_name(spk_id))
            for spk_id in self.memory_service.known_speakers
        ]

    def commit(self, transcript: Transcript):
        self.commit_service.commit(transcript)
        self.storage_service.save(transcript)
