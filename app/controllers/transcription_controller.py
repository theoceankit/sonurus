from app.services.transcription_service import TranscriptionService
from app.services.embedding_service import EmbeddingService
from app.services.speaker_memory_service import SpeakerMemoryService
from app.services.transcript_builder import TranscriptBuilder
from app.models.transcript import Transcript


class TranscriptionController:
    def __init__(
        self,
        transcription_service: TranscriptionService,
        embedding_service: EmbeddingService,
        memory_service: SpeakerMemoryService,
    ):
        self.transcription_service = transcription_service
        self.embedding_service = embedding_service
        self.memory_service = memory_service

    def run_pipeline(self, audio_path: str, on_progress=None, language: str | None = None) -> Transcript:
        def report(msg):
            if on_progress:
                on_progress(msg)

        report("Transcribing audio…")
        result, audio, diarization = self.transcription_service.transcribe(audio_path, language=language)

        report("Identifying speakers…")
        aggregated, segments = self.embedding_service.extract_all(audio, diarization)
        speaker_map = self.memory_service.resolve(aggregated)

        report("Building transcript…")
        transcript = TranscriptBuilder.build(result, speaker_map, audio_path)
        TranscriptBuilder.attach_embeddings(transcript, segments)

        return transcript

    def get_display_name(self, spk_id: str) -> str:
        return self.memory_service.get_name(spk_id, label="display") or spk_id
