"""The pipeline child never downloads a model: what is missing fails the job.

huggingface_hub is held offline by HF_HUB_OFFLINE; torch.hub (behind torchaudio's
pipelines and torch.hub.load) has no such switch, so the child refuses its downloads."""
from unittest.mock import MagicMock, patch

import pytest
import torch

from app.services.pipeline_process import _pipeline_worker


@pytest.fixture
def restore_torch_hub(monkeypatch):
    # Set to itself, so that monkeypatch puts the original back after the test.
    monkeypatch.setattr(torch.hub, "download_url_to_file", torch.hub.download_url_to_file)


def test_refused_torch_hub_download_names_the_url(restore_torch_hub):
    from app.offline import DownloadRefused, refuse_torch_hub_downloads

    refuse_torch_hub_downloads()

    url = "https://download.pytorch.org/torchaudio/models/wav2vec2_fairseq_base_ls960_asr_ls960.pth"
    with pytest.raises(DownloadRefused, match="download.pytorch.org"):
        torch.hub.download_url_to_file(url, "/nonexistent/x.pth")


@pytest.mark.skipif(isinstance(torch, MagicMock), reason="needs the real torch.hub")
def test_load_state_dict_from_url_is_refused_before_any_request(restore_torch_hub, tmp_path):
    """The call torchaudio's bundles make: refused, nothing written."""
    from app.offline import DownloadRefused, refuse_torch_hub_downloads

    refuse_torch_hub_downloads()

    with pytest.raises(DownloadRefused):
        torch.hub.load_state_dict_from_url(
            "https://download.pytorch.org/torchaudio/models/wav2vec2_voxpopuli_base_10k_asr_fr.pt",
            model_dir=str(tmp_path))
    assert list(tmp_path.iterdir()) == []


def test_worker_refuses_torch_hub_downloads_before_loading_models(monkeypatch):
    monkeypatch.setenv("HF_HUB_OFFLINE", "1")
    order = []
    controller = MagicMock()
    controller.analyse.side_effect = lambda *a, **k: order.append("pipeline")
    with patch("app.offline.refuse_torch_hub_downloads", side_effect=lambda: order.append("refuse")), \
         patch("app.services.service_factory.create_controller",
               side_effect=lambda **k: (order.append("models"), (controller, MagicMock()))[1]):
        _pipeline_worker({"audio_path": "/rec/a.wav", "db_path": "/data/x.db", "whisper_model": "small", "language": "en"},
                         MagicMock())

    assert order == ["refuse", "models", "pipeline"]
