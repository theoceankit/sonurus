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

    def analyse(self, audio_path: str, on_progress=None, language: str | None = None) -> dict:
        """Everything that needs the models, nothing that reads speaker memory:
        {"result": aligned WhisperX result with diarization speakers,
         "voices": {SPEAKER_XX: voice embedding},
         "turns": [{start, end, speaker, embedding}] of the diarization}.
        Plain data, so a child process can send it back."""
        def report(msg):
            if on_progress:
                on_progress(msg)

        report("Transcribing audio…")
        result, audio, diarization = self.transcription_service.transcribe(audio_path, language=language)

        report("Identifying speakers…")
        voices, turns = self.embedding_service.extract_all(audio, diarization)
        return {"result": result, "voices": voices, "turns": turns}

    def run_pipeline(self, audio_path: str, on_progress=None, language: str | None = None) -> Transcript:
        """analyse(), then build_transcript() against this controller's memory."""
        analysis = self.analyse(audio_path, on_progress=on_progress, language=language)
        return build_transcript(analysis, self.memory_service, audio_path)


def build_transcript(analysis: dict, memory: SpeakerMemoryService, audio_path: str) -> Transcript:
    """Resolve the analysis' speakers against memory and build the Transcript.
    A job calls it with memory read once its pipeline is done, so speakers
    named, created or recomputed while it ran are recognized."""
    speaker_map, match_scores = memory.resolve_with_scores(analysis["voices"])
    transcript = TranscriptBuilder.build(analysis["result"], speaker_map, audio_path)
    transcript.match_scores = match_scores
    TranscriptBuilder.attach_embeddings(transcript, analysis["turns"])
    return transcript
