"""Energy-preserving Mid/Side encode and decode.

mid = (L + R) / 2, side = (L - R) / 2 is a perfect round trip:
L = mid + side, R = mid - side. Mono material has side = 0.
"""

import numpy as np


def encode(audio):
    x = np.asarray(audio, dtype=np.float64)
    if x.ndim == 1:
        x = np.column_stack([x, x])
    return (x[:, 0] + x[:, 1]) * 0.5, (x[:, 0] - x[:, 1]) * 0.5


def decode(mid, side):
    mid = np.asarray(mid, dtype=np.float64)
    side = np.asarray(side, dtype=np.float64)
    return np.column_stack([mid + side, mid - side])
