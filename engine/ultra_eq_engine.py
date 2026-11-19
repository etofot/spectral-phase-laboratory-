"""CPU reference renderer and optional torchaudio CUDA implementation."""

import re
import numpy as np
from scipy import signal
from .spectral_sieve import sieve


class UltraEQEngine:
    def __init__(self, sr=48000, device="cpu"):
        self.sr, self.device = sr, device

    def process(self, audio, cmd):
        x = np.asarray(audio, dtype=np.float64).copy()
        sr = self.sr
        for b in cmd.get("cuts", []):
            f, g, q = map(float, (b["freq"], b["gain_db"], b["q"]))
            if not (10 <= f < sr / 2 and -30 <= g <= 12 and 0.1 <= q <= 50):
                raise ValueError("EQ values out of range")
            if self.device != "cpu":
                import torch, torchaudio.functional as F

                a = 10 ** (g / 40)
                w = 2 * np.pi * f / sr
                alpha = np.sin(w) / (2 * q)
                args = dict(device=self.device, dtype=torch.float64)
                num = torch.tensor(
                    [1 + alpha * a, -2 * np.cos(w), 1 - alpha * a], **args
                )
                den = torch.tensor(
                    [1 + alpha / a, -2 * np.cos(w), 1 - alpha / a], **args
                )
                x = (
                    F.lfilter(
                        torch.as_tensor(x.T.copy(), **args), den, num, clamp=False
                    )
                    .T.cpu()
                    .numpy()
                )
            else:
                a = 10 ** (g / 40)
                w = 2 * np.pi * f / sr
                alpha = np.sin(w) / (2 * q)
                x = signal.lfilter(
                    [1 + alpha * a, -2 * np.cos(w), 1 - alpha * a],
                    [1 + alpha / a, -2 * np.cos(w), 1 - alpha / a],
                    x,
                    axis=0,
                )
        for b in cmd.get("allpass", []):
            w = 2 * np.pi * float(b["freq"]) / sr
            alpha = np.sin(w) / (2 * float(b["q"]))
            den = np.array([1 + alpha, -2 * np.cos(w), 1 - alpha])
            x = signal.lfilter(den[::-1], den, x, axis=0)
        masks = list(cmd.get("sieve", []))
        for key, deg in cmd.get("phase_shift_deg", {}).items():
            m = re.fullmatch(r"(\d+(?:\.\d+)?)-(\d+(?:\.\d+)?)Hz", key)
            if not m:
                raise ValueError("phase bands use low-highHz")
            lo, hi = map(float, m.groups())
            masks.append({"low": lo, "high": hi, "phase_deg": float(deg)})
        if masks:
            x = sieve(x, sr, masks, 8192, self.device)
        return x * 10 ** (float(cmd.get("gain", 0)) / 20)


def probe(a, b, sr=48000, max_ms=12):
    """Signed cross correlation: retain polarity, non-circular overlap alignment."""
    a = np.asarray(a)
    b = np.asarray(b)
    am = a.mean(1)
    bm = b.mean(1)
    n = min(len(am), len(bm), sr)
    mx = min(int(sr * max_ms / 1000), n - 1)
    c = signal.correlate(am[:n], bm[:n], method="fft")
    middle = n - 1
    lag = int(np.argmax(np.abs(c[middle - mx : middle + mx + 1])) - mx)
    if lag > 0:
        a, b = a[lag:], b[:-lag]
    elif lag < 0:
        a, b = a[:lag], b[-lag:]
    n = min(len(a), len(b))
    return a[:n] + b[:n], a[:n] - b[:n], lag
