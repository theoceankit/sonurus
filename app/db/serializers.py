import numpy as np


def serialize_embedding(emb) -> bytes | None:
    if emb is None:
        return None
    return np.asarray(emb, dtype=np.float32).tobytes()


def deserialize_embedding(blob) -> np.ndarray | None:
    if blob is None:
        return None
    return np.frombuffer(blob, dtype=np.float32).copy()
