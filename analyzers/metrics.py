"""Measurements operate on rendered PCM, never on instrument metadata."""

import warnings
import numpy as np
import pyloudnorm as pyln
from scipy import signal, ndimage
from engine.config import SR, CENTERS
from engine.ultra_eq_engine import probe

EPS = 1e-12
r = lambda x, n=2: round(float(x), n)


def db(x):
    return 20 * np.log10(np.maximum(np.abs(x), EPS))


def power(x):
    return np.mean(np.square(x, dtype=np.float64))


def correlation(x, y):
    x = x - np.mean(x)
    y = y - np.mean(y)
    return float(
        np.clip(np.mean(x * y) / np.sqrt(max(power(x) * power(y), 1e-24)), -1, 1)
    )


def bandpass(x, lo, hi):
    return signal.sosfilt(
        signal.butter(3, [lo, hi], btype="bandpass", fs=SR, output="sos"), x, axis=0
    )


def loudness(x, full=True):
    meter = pyln.Meter(SR)
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        lu = meter.integrated_loudness(x)
    tp = float(np.max(np.abs(signal.resample_poly(x, 4, 1, axis=0))))
    out = {
        "lufs": r(lu) if np.isfinite(lu) else None,
        "truePeak": r(db(tp)),
        "rms": r(db(np.sqrt(power(x)))),
        "crest": r(db(np.max(np.abs(x))) - db(np.sqrt(power(x)))),
        "lra": None,
        "lraNote": "Для устойчивой оценки LRA требуется более длинная программа.",
    }
    if full:
        st = (
            [
                pyln.Meter(SR, block_size=3).integrated_loudness(x[n : n + 3 * SR])
                for n in range(0, len(x) - 3 * SR + 1, SR)
            ]
            if np.max(np.abs(x)) > EPS
            else []
        )
        out["shortMax"] = r(max(st)) if st and np.isfinite(max(st)) else None
    return out


def spectrum(x, nfft):
    mono = x.mean(1)
    f, p = signal.welch(
        mono, SR, window="hann", nperseg=nfft, noverlap=nfft // 2, scaling="density"
    )
    df = f[1]
    grid = np.geomspace(20, 20000, 600)
    c = np.r_[0, np.cumsum(p) * df]
    half = 2 ** (1 / 24)
    lo = grid / half
    hi = grid * half
    vals = np.maximum(
        np.interp(hi, f, c[1:]) - np.interp(lo, f, c[1:]), np.interp(grid, f, p) * df
    )
    line = np.maximum(-105, 10 * np.log10(np.maximum(vals, EPS)))
    # Peak-hold across real Hann frames: amplitude is calibrated to a full-scale sinusoid.
    _, _, z = signal.stft(
        mono,
        SR,
        window="hann",
        nperseg=nfft,
        noverlap=nfft // 2,
        boundary=None,
        padded=False,
    )
    held = 2 * np.max(np.abs(z), axis=1)
    peak_line = np.interp(grid, f, held)
    for i, hz in enumerate(grid):
        lo_i = np.searchsorted(f, hz / 2 ** (1 / 96))
        hi_i = np.searchsorted(f, hz * 2 ** (1 / 96))
        if hi_i > lo_i:
            peak_line[i] = max(peak_line[i], np.max(held[lo_i:hi_i]))
    held_db = np.maximum(-105, db(peak_line))
    third = [
        {
            "hz": v,
            "db": r(
                10
                * np.log10(
                    max(
                        EPS,
                        np.sum(p[(f >= v / 2 ** (1 / 6)) & (f < v * 2 ** (1 / 6))])
                        * df,
                    )
                )
            ),
        }
        for v in CENTERS
    ]
    # Genuine 0.2 Hz bins over the complete 5 s reference, independent of display FFT.
    hf, hp = signal.periodogram(mono, SR, window="hann", scaling="spectrum")
    hd = 10 * np.log10(np.maximum(hp, 1e-16))
    ids, _ = signal.find_peaks(hd, prominence=9, distance=3)
    ids = [i for i in ids if 20 <= hf[i] <= 20000 and hd[i] > np.max(hd) - 45]
    ids = sorted(ids, key=lambda i: -hd[i])[:16]
    peaks = [{"hz": r(hf[i], 1), "db": r(hd[i])} for i in ids]
    return (
        {
            "peakSpectrum": np.round(held_db, 2).tolist(),
            "spectrum": np.round(line, 2).tolist(),
            "thirdOctave": third,
            "peaks": peaks,
            "resolution": r(SR / len(x), 3),
            "centroid": r(np.sum(f * p) / max(np.sum(p), EPS), 1),
        },
        hf,
        hp,
    )


def envelope(x):
    n = round(SR * 0.002)
    env = np.sqrt(np.mean(x[: len(x) // n * n].reshape(-1, n, 2) ** 2, axis=(1, 2)))
    env = ndimage.gaussian_filter1d(env, 1)
    peaks, _ = signal.find_peaks(
        env, prominence=max(EPS, env.max() * 0.15), distance=60
    )
    if not len(peaks):
        return {"attackMs": 0, "decayMs": 0, "sustain": 0, "transientRatio": 0}
    attacks = []
    decays = []
    flags = np.zeros_like(env, dtype=bool)
    for i in peaks:
        start = max(0, i - 75)
        a = np.where(env[start:i] < env[i] * 0.2)[0]
        onset = (
            start + int(a[-1])
            if len(a)
            else start + int(np.argmin(env[start:i])) if i > start else i
        )
        hits = np.where(env[i : i + 200] < env[i] / np.e)[0]
        decay = int(hits[0]) if len(hits) else min(200, len(env) - i)
        attacks.append((i - onset) * 2)
        decays.append(decay * 2)
        flags[onset : min(len(env), i + 10)] = True
    return {
        "attackMs": r(np.median(attacks), 1),
        "decayMs": r(np.median(decays), 1),
        "sustain": r(np.median(env) / max(env.max(), EPS)),
        "transientRatio": r(np.sum(env[flags] ** 2) / max(np.sum(env**2), EPS)),
    }


def phase(x):
    low = signal.sosfilt(
        signal.butter(3, 120, fs=SR, btype="low", output="sos"), x, axis=0
    )
    high = signal.sosfilt(
        signal.butter(3, 120, fs=SR, btype="high", output="sos"), x, axis=0
    )
    f, cross = signal.csd(x[:, 0], x[:, 1], SR, nperseg=4096)
    sel = (np.abs(cross) > np.max(np.abs(cross)) * 0.15) & (f > 20)
    gd = -np.gradient(np.unwrap(np.angle(cross)), 2 * np.pi * f) * 1000
    win = [correlation(v[:, 0], v[:, 1]) for v in np.array_split(x, 32)]
    return {
        "correlation": r(correlation(x[:, 0], x[:, 1]), 3),
        "lowCorrelation": r(correlation(low[:, 0], low[:, 1]), 3),
        "highCorrelation": r(correlation(high[:, 0], high[:, 1]), 3),
        "groupDelayLRMs": r(np.median(gd[sel]), 4) if sel.any() else None,
        "stability": r(1 - np.std(win), 3),
        "trace": np.round(win, 3).tolist(),
    }


def harmonics(f, p):
    if np.max(p) < EPS:
        return {
            "f0": None,
            "harmonicEnergyRatio": None,
            "even": None,
            "odd": None,
            "subharmonicRatio": 0,
        }
    ix = np.where((f >= 35) & (f < 1600))[0]
    ix = ix[np.argmax(p[ix])]
    fundamental = float(f[ix])
    h = []
    for m in range(1, 10):
        h.append(np.sum(p[np.abs(f - fundamental * m) < 0.9]))
    return {
        "f0": r(fundamental, 1),
        "harmonicEnergyRatio": r(sum(h[1:]) / max(h[0], EPS)),
        "even": r(sum(h[1::2]) / max(sum(h), EPS)),
        "odd": r(sum(h[::2]) / max(sum(h), EPS)),
        "subharmonicRatio": r(
            np.sum(p[(f > 20) & (f < fundamental * 0.9)]) / max(np.sum(p), EPS)
        ),
    }


def crest_bands(x):
    out = []
    for lo, hi in [
        (20, 80),
        (80, 250),
        (250, 500),
        (500, 2000),
        (2000, 6000),
        (6000, 20000),
    ]:
        y = bandpass(x, lo, hi)
        out.append(
            {
                "lo": lo,
                "hi": hi,
                "crest": r(db(np.max(np.abs(y))) - db(np.sqrt(power(y)))),
            }
        )
    return out


def cross_pair(a, b, aid, bid):
    am, bm = a.mean(1), b.mean(1)
    n = 8192
    f, paa = signal.welch(am, SR, nperseg=n)
    _, pbb = signal.welch(bm, SR, nperseg=n)
    _, pab = signal.csd(am, bm, SR, nperseg=n)
    coh = np.clip(abs(pab) ** 2 / np.maximum(paa * pbb, 1e-32), 0, 1)
    active = (
        (paa > max(paa.max() * 0.04, 1e-13))
        & (pbb > max(pbb.max() * 0.04, 1e-13))
        & (f >= 20)
        & (f < 12000)
    )
    loss = 10 * np.log10(
        np.maximum(paa + pbb + 2 * np.real(pab), 1e-24) / np.maximum(paa + pbb, 1e-24)
    )
    ids = np.where(active)[0]
    worst = ids[np.argmin(2 * np.real(pab[ids]))] if len(ids) else 0
    summed, diff, lag = probe(a, b)
    _, ps = signal.welch(summed.mean(1), SR, nperseg=n)
    _, pd = signal.welch(diff.mean(1), SR, nperseg=n)
    bands = []
    for lo, hi in [(20, 80), (80, 250), (250, 500), (500, 2000), (2000, 20000)]:
        band = (f >= lo) & (f < hi)
        ref = np.sum((paa + pbb)[band])
        actual = np.sum((paa + pbb + 2 * np.real(pab))[band])
        bands.append(
            {
                "lo": lo,
                "hi": hi,
                "sumDb": r(10 * np.log10(max(EPS, np.sum(ps[band]) * f[1]))),
                "diffDb": r(10 * np.log10(max(EPS, np.sum(pd[band]) * f[1]))),
                "alignedLoss": r(
                    10
                    * np.log10(
                        max(EPS, np.sum(ps[band]))
                        / max(EPS, 0.5 * np.sum((ps + pd)[band]))
                    )
                ),
                "loss": r(10 * np.log10(max(actual, 1e-20) / max(ref, 1e-20))),
            }
        )
    return {
        "validBins": int(len(ids)),
        "a": aid,
        "b": bid,
        "coherence": r(coh[worst], 3),
        "hz": r(f[worst], 1),
        "phase": r(np.rad2deg(np.angle(pab[worst])), 1),
        "loss": r(min(0, loss[worst])),
        "lagSamples": lag,
        "lagMs": r(lag / SR * 1000, 3),
        "sumDb": r(db(np.sqrt(power(summed)))),
        "diffDb": r(db(np.sqrt(power(diff)))),
        "bands": bands,
        "coherentBins": [r(v, 1) for v in f[active & (coh > 0.6)][:40]],
    }


def masking(tracks):
    # Integrated band energies in non-overlapping 20 ms windows.
    n = int(SR * 0.02)
    windows = {}
    for k, x in tracks.items():
        windows[k] = []
        for lo, hi in [(20, 150), (150, 500), (500, 2000), (2000, 20000)]:
            y = bandpass(x.mean(1), lo, hi)
            windows[k].append(
                10
                * np.log10(
                    np.maximum(
                        np.mean(y[: len(y) // n * n].reshape(-1, n) ** 2, axis=1), EPS
                    )
                )
            )
    res = []
    for i, (a, aa) in enumerate(windows.items()):
        for b, bb in list(windows.items())[i + 1 :]:
            v, w = np.array(aa), np.array(bb)
            active = np.maximum(v, w) > -55
            res.append(
                {
                    "a": a,
                    "b": b,
                    "overlap": r(np.mean((abs(v - w) < 6) & active)),
                    "aDominates": r(np.mean((v > w) & active)),
                    "windowMs": 20,
                }
            )
    return res


def waveform(x, n=140):
    return [r(np.max(np.abs(v)), 4) for v in np.array_split(x, n)]


def stereo(x):
    m = x.mean(1)
    s = (x[:, 0] - x[:, 1]) / 2
    return {
        "midDb": r(db(np.sqrt(power(m)))),
        "sideDb": r(db(np.sqrt(power(s)))),
        "width": r(np.sqrt(power(s) / max(power(m), EPS)), 3),
    }


def cross_at(a, b, f0):
    """Coherence, relative phase and cancellation at one arbitrary anchor frequency."""
    am, bm = a.mean(1), b.mean(1)
    n = 8192
    f, paa = signal.welch(am, SR, nperseg=n)
    _, pbb = signal.welch(bm, SR, nperseg=n)
    _, pab = signal.csd(am, bm, SR, nperseg=n)
    coh = np.clip(abs(pab) ** 2 / np.maximum(paa * pbb, 1e-32), 0, 1)
    band = (f >= f0 / 2 ** (1 / 12)) & (f <= f0 * 2 ** (1 / 12))
    ids = np.where(band & (paa > max(paa.max() * 0.04, 1e-13)) & (pbb > max(pbb.max() * 0.04, 1e-13)))[0]
    if not len(ids):
        return {"valid": False, "hz": r(f0, 1), "coherence": 0, "phase": 0, "loss": 0}
    # Prioritise actual lost power over the largest relative dip.
    i = ids[np.argmin(2 * np.real(pab[ids]))]
    loss = 10 * np.log10(max(paa[i] + pbb[i] + 2 * np.real(pab[i]), 1e-24) / max(paa[i] + pbb[i], 1e-24))
    return {"valid": True, "hz": r(f[i], 1), "coherence": r(coh[i], 3), "phase": r(np.rad2deg(np.angle(pab[i])), 1), "loss": r(min(0, loss))}


def stereo_domains(x, sr=SR):
    """Measured L/R and M/S spectra from the same processed PCM, never mono proxies."""
    left, right = x[:, 0], x[:, 1]
    mid, side = (left + right) * 0.5, (left - right) * 0.5
    out = {}
    for label, y in (("left", left), ("right", right), ("mid", mid), ("side", side)):
        energy = float(np.mean(y * y))
        if energy < 1e-18:
            out[label] = {"active": False, "rmsDb": None, "peakDb": None, "spectrum": []}
            continue
        f, p = signal.welch(y, sr, nperseg=4096, noverlap=2048)
        df = f[1]
        centers = np.geomspace(20, min(20000, sr / 2 - 100), 96)
        profile = []
        for c in centers:
            sel = (f >= c / 2 ** (1 / 12)) & (f <= c * 2 ** (1 / 12))
            profile.append(r(10 * np.log10(max(1e-16, np.sum(p[sel]) * df))))
        out[label] = {"active": True, "rmsDb": r(10 * np.log10(energy)), "peakDb": r(db(np.max(np.abs(y)))), "spectrum": profile}
    out["lrCorrelation"] = r(correlation(left, right), 3)
    return out
