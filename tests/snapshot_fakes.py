"""Stand-ins for huggingface_hub.snapshot_download in the download tests.

ModelService fails a download that leaves the repo incomplete, so a fake
snapshot must leave behind what a real one does: refs/main in the repo's cache."""
from pathlib import Path


def complete_snapshot(inner=None):
    """A snapshot_download fake that writes refs/main after calling `inner`."""
    def fake(repo, cache_dir=None, **kwargs):
        result = inner(repo, cache_dir=cache_dir, **kwargs) if inner else None
        refs = Path(cache_dir) / ("models--" + repo.replace("/", "--")) / "refs"
        refs.mkdir(parents=True, exist_ok=True)
        (refs / "main").write_text("abc123")
        return result
    return fake
