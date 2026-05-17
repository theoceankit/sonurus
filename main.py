import os
import warnings
import logging
from dotenv import load_dotenv

load_dotenv()
os.environ["HF_TOKEN"] = os.getenv("HF_TOKEN")

from app.logger import setup_logging
setup_logging(default_level="info")

_verbose = os.getenv("VERBOSE", "false").lower() == "true"

if not _verbose:
    warnings.filterwarnings("ignore", module="lightning")
    warnings.filterwarnings("ignore", module="pyannote")
    warnings.filterwarnings("ignore", module="torch")

from app.services.service_factory import create_controller
from app.cli import CliView

if not _verbose:
    for _name in [
        "whisperx", "whisperx.asr", "whisperx.vads.pyannote", "whisperx.diarize",
        "lightning", "lightning.pytorch", "lightning.fabric",
        "lightning.fabric.utilities.rank_zero",
        "pytorch_lightning",
    ]:
        logging.getLogger(_name).setLevel(logging.ERROR)


if __name__ == "__main__":
    audio_path = "testdata/output.wav"

    controller, storage_service = create_controller()
    view = CliView()

    transcript = controller.run_pipeline(audio_path)

    view.run_main_menu(transcript, controller)
    os._exit(0)
