"""Complex STFT masks; FFT resolution = sample rate / N, not 1 Hz at N=8192."""

import numpy as np
from scipy import signal


def sieve(audio, sr, bands, n_fft=8192, device="cpu"):
    if n_fft not in (4096, 8192, 16384, 32768):
        raise ValueError("unsupported FFT size")
    f = np.fft.rfftfreq(n_fft, 1 / sr)
    mask = np.ones(f.shape, dtype=np.complex128)
    for b in bands:
        use = (f >= float(b["low"])) & (f <= float(b["high"]))
        mask[use] *= 10 ** (float(b.get("gain_db", 0)) / 20) * np.exp(
            1j * np.deg2rad(float(b.get("phase_deg", 0)))
        )
    mask[0] = abs(mask[0])
    mask[-1] = abs(mask[-1])
    if device != "cpu":
        import torch

        x = torch.as_tensor(audio.T.copy(), dtype=torch.float64, device=device)
        win = torch.hann_window(n_fft, device=device, dtype=x.dtype)
        z = torch.stft(x, n_fft, n_fft // 4, window=win, return_complex=True)
        out = torch.istft(
            z * torch.as_tensor(mask, device=device)[:, None],
            n_fft,
            n_fft // 4,
            window=win,
            length=len(audio),
        )
        return out.T.cpu().numpy()
    out = []
    for x in audio.T:
        _, _, z = signal.stft(
            x, sr, nperseg=n_fft, noverlap=3 * n_fft // 4, window="hann"
        )
        _, y = signal.istft(
            z * mask[:, None], sr, nperseg=n_fft, noverlap=3 * n_fft // 4, window="hann"
        )
        out.append(y[: len(x)])
    return np.stack(out, axis=1)


def wiener_stems(magnitudes, mix_stft, iterations=1):
    """Norbert expects [time,frequency,channels,sources] and a complex mixture."""
    import norbert

    return norbert.wiener(magnitudes, mix_stft, iterations=iterations)
