"""The backend reads no .env file: the HuggingFace token comes with each model
download request, and VERBOSE or LOG_LEVEL are set in the shell."""

from pathlib import Path

APP = Path(__file__).parent.parent / "app"


def test_app_does_not_load_a_dotenv_file():
    users = [str(p.relative_to(APP)) for p in APP.rglob("*.py") if "dotenv" in p.read_text()]
    assert users == []
