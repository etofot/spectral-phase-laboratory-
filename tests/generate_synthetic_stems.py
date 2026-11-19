"""Four deterministic, musical 5 s / 48 kHz / stereo float32 reference stems."""

from pathlib import Path
import numpy as np
import soundfile as sf
from scipy import signal

ROOT = Path(__file__).resolve().parents[1]
SR, DURATION = 48000, 5


def generate(destination=ROOT / "fixtures"):
    destination = Path(destination)
    destination.mkdir(parents=True, exist_ok=True)
    t = np.arange(SR * DURATION) / SR
    rng = np.random.default_rng(22055)

    def tone(f, phase=0):
        return np.sin(2 * np.pi * f * t + np.deg2rad(phase))

    def texture(profile):
        f = np.fft.rfftfreq(len(t), 1 / SR)
        xp, yp = np.array(profile).T
        db = np.interp(np.log2(np.maximum(f, 1)), np.log2(xp), yp)
        db += 3 * np.sin(np.log2(np.maximum(f, 1)) * 5.1) + 2 * np.sin(
            np.log2(np.maximum(f, 1)) * 9.3
        )
        # Irregular resonant body response, encoded into the audio, not the plot.
        mesh = np.geomspace(20, 22000, 185)
        db += np.interp(
            np.log(np.maximum(f, 1)), np.log(mesh), rng.normal(0, 3.2, len(mesh))
        )
        x = np.fft.irfft(np.fft.rfft(rng.normal(size=len(t))) * 10 ** (db / 20))
        return x / (np.std(x) + 1e-12)

    beat = t % 0.5
    e = (1 - np.exp(-beat * 1500)) * np.exp(-beat * 12)
    kick = (
        0.68 * tone(55) * e
        + 0.13 * tone(110) * e**2
        + 0.19 * tone(3500) * np.exp(-beat * 170)
    )
    kick += (
        0.13
        * e
        * texture(
            [
                (1, -30),
                (28, -19),
                (50, -2),
                (92, 0),
                (145, -8),
                (350, -15),
                (800, -16),
                (1900, -10),
                (3500, -3),
                (6000, -15),
                (16000, -34),
                (24000, -70),
            ]
        )
    )
    bass_env = (0.38 + 0.62 * np.exp(-(t % 0.25) * 8)) * np.where(
        (t % 0.75) < 0.63, 1, 0.34
    )
    bass = bass_env * (
        0.25 * tone(73.4)
        + 0.15 * tone(146.8)
        + 0.12 * tone(55)
        + 0.07 * tone(293.6)
        + 0.08 * tone(366.9)
    ) + 0.125 * tone(222)
    bass += (
        0.13
        * bass_env
        * texture(
            [
                (1, -60),
                (30, -28),
                (75, -5),
                (160, 0),
                (265, -2),
                (480, -6),
                (950, -12),
                (1800, -17),
                (4000, -23),
                (8500, -35),
                (20000, -57),
            ]
        )
    )
    sub_env = 0.23 + 0.77 * e
    sub = sub_env * (0.51 * tone(55, 165) + 0.13 * tone(45, 160) + 0.11 * tone(65, 150))
    sub += (
        0.075
        * sub_env
        * texture(
            [
                (1, -50),
                (20, -18),
                (40, -2),
                (72, 0),
                (120, -9),
                (240, -27),
                (650, -39),
                (2000, -50),
                (20000, -80),
            ]
        )
    )
    lead_env = 0.4 + 0.6 * np.sin(np.pi * (t % 0.625) / 0.625) ** 2
    lead_mid = lead_env * (
        0.11 * tone(440) + 0.055 * tone(880) + 0.04 * tone(1760) + 0.026 * tone(2640)
    )
    lead_mid += 0.062 * tone(345) + 0.070 * tone(346, 77) + 0.061 * tone(347, 129)
    profile = [
        (1, -70),
        (40, -42),
        (100, -27),
        (230, -15),
        (360, -4),
        (670, 0),
        (1300, -5),
        (2400, -1),
        (4800, -9),
        (8900, -14),
        (16000, -29),
        (24000, -55),
    ]
    lead_mid += 0.06 * lead_env * texture(profile)
    side = 0.055 * lead_env * (
        tone(660, 35) + 0.45 * tone(1320)
    ) + 0.04 * lead_env * texture(profile)
    stereo = lambda x: np.column_stack([x, x])
    wavs = {
        "kick": stereo(kick),
        "bass_guitar": stereo(bass),
        "sub_synth": stereo(sub),
        "lead_synth": np.stack([lead_mid + side, lead_mid - side], axis=1),
    }
    fade = np.minimum(1, t / 0.003) * np.minimum(1, (DURATION - t) / 0.018)
    gain = 10 ** (-3.2 / 20) / np.max(np.abs(sum(wavs.values())))
    for k, x in wavs.items():
        sf.write(
            destination / f"{k}.wav",
            (gain * fade[:, None] * x).astype("float32"),
            SR,
            subtype="FLOAT",
        )
    return list(wavs)


if __name__ == "__main__":
    import argparse, json

    p = argparse.ArgumentParser()
    p.add_argument("--out", type=Path, default=ROOT / "fixtures")
    a = p.parse_args()
    print(
        json.dumps(
            {
                "stems": generate(a.out),
                "sample_rate": SR,
                "seconds": DURATION,
                "format": "FLOAT",
            }
        )
    )
