"""Self-check of the GPU download, run by the Electron app before it starts the
backend on a new pack (python -m app.gpu_probe, the pack on PYTHONPATH).

Prints one JSON line {ok, torch, device, error} and exits 0 when PyTorch
computes on the GPU and CTranslate2 (faster-whisper) sees it, else 1.
"""
import json
import sys


def _import_torch():
    import torch
    return torch


def _import_ctranslate2():
    import ctranslate2
    return ctranslate2


def probe(torch_mod=None, ct2_mod=None) -> dict:
    result = {"ok": False, "torch": None, "device": None, "error": None}
    try:
        torch = torch_mod if torch_mod is not None else _import_torch()
        result["torch"] = getattr(torch, "__version__", None)
        if not torch.cuda.is_available():
            result["error"] = "CUDA is not available to PyTorch"
            return result
        if (torch.ones(8, device="cuda") * 2).sum().item() != 16:
            result["error"] = "PyTorch computed a wrong result on the GPU"
            return result
        result["device"] = torch.cuda.get_device_name(0)
        ct2 = ct2_mod if ct2_mod is not None else _import_ctranslate2()
        if ct2.get_cuda_device_count() < 1:
            result["error"] = "CTranslate2 does not see the GPU"
            return result
    except Exception as exc:
        result["error"] = f"{type(exc).__name__}: {exc}"
        return result
    result["ok"] = True
    return result


def main() -> None:
    result = probe()
    print(json.dumps(result), flush=True)
    sys.exit(0 if result["ok"] else 1)


if __name__ == "__main__":
    main()
