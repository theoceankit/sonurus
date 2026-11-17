"""Models are downloaded only when the user asks for it (Settings, the alignment
dialog), never by a library in the middle of a job.

huggingface_hub is held to its local cache by HF_HUB_OFFLINE. torch.hub has no
such switch: torchaudio's pipelines and torch.hub.load download through it
whenever a file is missing. The pipeline child refuses those downloads, so a
model the app did not download fails the job instead of fetching it."""


class DownloadRefused(RuntimeError):
    pass


def refuse_torch_hub_downloads() -> None:
    import torch

    def refuse(url, *args, **kwargs):
        raise DownloadRefused(f"Refused to download {url} during a job: models are downloaded in Settings.")

    # load_state_dict_from_url() and torch.hub.load() look the function up in
    # the module at each call, so replacing it here covers them both.
    torch.hub.download_url_to_file = refuse
