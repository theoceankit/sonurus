"""app.gpu_probe — the self-check the app runs with a new GPU download before
starting the backend on it. torch and ctranslate2 are stand-ins."""
import json
from types import SimpleNamespace

import pytest

from app import gpu_probe


class FakeTensor:
    def __init__(self, value):
        self.value = value

    def __mul__(self, k):
        return FakeTensor(self.value * k)

    def sum(self):
        return self

    def item(self):
        return self.value


def fake_torch(available=True, ones_error=None, version="2.8.0+cu128"):
    def ones(n, device=None):
        assert device == "cuda"
        if ones_error:
            raise ones_error
        return FakeTensor(n)

    cuda = SimpleNamespace(is_available=lambda: available,
                           get_device_name=lambda i: "NVIDIA GeForce RTX 4060")
    return SimpleNamespace(__version__=version, cuda=cuda, ones=ones)


def fake_ct2(count=1):
    return SimpleNamespace(get_cuda_device_count=lambda: count)


def test_probe_passes_on_a_working_gpu():
    assert gpu_probe.probe(fake_torch(), fake_ct2()) == {
        "ok": True, "torch": "2.8.0+cu128", "device": "NVIDIA GeForce RTX 4060", "error": None,
    }


@pytest.mark.parametrize("torch_mod, ct2_mod, error", [
    (fake_torch(available=False), fake_ct2(), "CUDA is not available to PyTorch"),
    (fake_torch(ones_error=RuntimeError("no kernel image is available")), fake_ct2(),
     "RuntimeError: no kernel image is available"),
    (fake_torch(), fake_ct2(count=0), "CTranslate2 does not see the GPU"),
])
def test_probe_names_what_failed(torch_mod, ct2_mod, error):
    result = gpu_probe.probe(torch_mod, ct2_mod)
    assert result["ok"] is False
    assert result["error"] == error


def test_probe_reports_an_import_error(monkeypatch):
    def broken_import():
        raise ImportError("libcudnn.so.9: cannot open shared object file")

    monkeypatch.setattr(gpu_probe, "_import_torch", broken_import)
    result = gpu_probe.probe()
    assert result["ok"] is False
    assert result["error"] == "ImportError: libcudnn.so.9: cannot open shared object file"


def test_main_prints_json_and_exits_by_the_result(monkeypatch, capsys):
    monkeypatch.setattr(gpu_probe, "probe", lambda: {"ok": False, "torch": None, "device": None,
                                                      "error": "CUDA is not available to PyTorch"})
    with pytest.raises(SystemExit) as exc:
        gpu_probe.main()
    assert exc.value.code == 1
    assert json.loads(capsys.readouterr().out.strip().splitlines()[-1])["error"] == \
        "CUDA is not available to PyTorch"

    monkeypatch.setattr(gpu_probe, "probe", lambda: {"ok": True, "torch": "2.8.0+cu128",
                                                      "device": "RTX", "error": None})
    with pytest.raises(SystemExit) as exc:
        gpu_probe.main()
    assert exc.value.code == 0
