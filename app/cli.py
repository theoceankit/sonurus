import os
from app.models.transcript import Transcript
from app.controllers.transcription_controller import TranscriptionController
from app.services.archive_service import ArchiveService


class CliView:
    def display_transcript(self, transcript: Transcript, controller: TranscriptionController):
        print("\n=== Transcript ===")
        for i, seg in enumerate(transcript.segments):
            spk_id = seg.speaker_final or seg.speaker_resolved or seg.speaker_raw
            speaker = controller.get_display_name(spk_id)
            print(f"[{i}] [{seg.start:.2f}-{seg.end:.2f}] {speaker}: {seg.text}")

    def run_main_menu(self, transcript: Transcript, controller: TranscriptionController):
        while True:
            self.display_transcript(transcript, controller)

            print("\n=== Menu ===")
            print("  [1] Edit segments")
            print("  [2] Edit speakers")
            print("  [3] Export transcript to text file")
            print("  [4] Save to database")
            print("  Enter — exit without saving")

            choice = input("\nSelect option: ").strip()

            if choice == "":
                break
            elif choice == "1":
                self._handle_segments(transcript, controller)
            elif choice == "2":
                self._handle_rename(transcript, controller)
            elif choice == "3":
                self._handle_export(transcript, controller)
            elif choice == "4":
                self._handle_save(transcript, controller)
            else:
                print("Invalid input")

    def _handle_segments(self, transcript: Transcript, controller: TranscriptionController):
        while True:
            self.display_transcript(transcript, controller)

            choice = input("\nSelect segment (Enter to go back): ").strip()

            if choice == "":
                break

            if not choice.isdigit():
                print("Invalid input")
                continue

            idx = int(choice)

            if idx < 0 or idx >= len(transcript.segments):
                print("No such segment")
                continue

            seg = transcript.segments[idx]
            current_id = seg.speaker_final or seg.speaker_resolved or seg.speaker_raw
            current_display = controller.get_display_name(current_id)
            print(f"Current speaker: {current_display}")

            seen = {}
            for s in transcript.segments:
                spk_id = s.speaker_final or s.speaker_resolved or s.speaker_raw
                if spk_id and spk_id not in seen:
                    seen[spk_id] = controller.get_display_name(spk_id)
            for spk_id, display in controller.get_all_known_speakers():
                if spk_id not in seen:
                    seen[spk_id] = display
            speakers = list(seen.items())

            print("\n=== Assign speaker ===")
            for i, (spk_id, display) in enumerate(speakers):
                marker = "" if spk_id in {
                    s.speaker_final or s.speaker_resolved or s.speaker_raw
                    for s in transcript.segments
                } else "  [db]"
                print(f"  [{i}] {display}  ({spk_id}){marker}")
            print(f"  [n] New speaker")
            print(f"  Enter — cancel")

            spk_input = input("\nSelect: ").strip().lower()

            if spk_input == "":
                continue
            elif spk_input == "n":
                new_id = controller.create_new_speaker()
                name = input(f"Name for {new_id} (Enter to skip): ").strip()
                if name:
                    controller.rename_speaker(new_id, name)
                print(f"New speaker created: {controller.get_display_name(new_id)}")
            elif spk_input.isdigit() and 0 <= int(spk_input) < len(speakers):
                new_id, _ = speakers[int(spk_input)]
            else:
                print("Invalid selection")
                continue

            print(f"  [1] All [{current_display}] segments")
            print(f"  Enter — this segment only")
            scope = input("Select: ").strip()

            if scope == "1":
                controller.reassign_all_by_speaker(transcript, current_id, new_id)
            else:
                controller.reassign_speaker(transcript, idx, new_id)

    def _handle_export(self, transcript: Transcript, controller: TranscriptionController):
        dest_dir = ArchiveService().archive(transcript, display_fn=controller.get_display_name)
        stem = os.path.splitext(os.path.basename(transcript.audio_path))[0]
        print(f"Exported → {os.path.join(dest_dir, stem + '.txt')}")
        print(f"Audio → {os.path.join(dest_dir, os.path.basename(transcript.audio_path))}")

    def _handle_save(self, transcript: Transcript, controller: TranscriptionController):
        controller.commit(transcript)
        print("Transcription saved.")

    def _handle_rename(self, transcript: Transcript, controller: TranscriptionController):
        seen = {}
        for seg in transcript.segments:
            spk_id = seg.speaker_final or seg.speaker_resolved or seg.speaker_raw
            if spk_id and spk_id not in seen:
                seen[spk_id] = controller.get_display_name(spk_id)

        if not seen:
            print("No speakers found in transcript.")
            return

        speakers = list(seen.items())
        print("\n=== Speakers in this session ===")
        for i, (spk_id, display) in enumerate(speakers):
            print(f"  [{i}] {spk_id}  →  {display}")

        spk_input = input("\nSelect speaker number: ").strip()
        if not spk_input.isdigit() or not (0 <= int(spk_input) < len(speakers)):
            print("Invalid selection.")
            return
        spk_id, _ = speakers[int(spk_input)]

        label = input("Label (Enter for 'display'): ").strip() or "display"
        name = input(f"New name [{label}]: ").strip()
        if name:
            controller.rename_speaker(spk_id, name, label)
            print(f"Saved: {spk_id} [{label}] → {name}")
