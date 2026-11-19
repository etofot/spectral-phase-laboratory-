import json, re, hashlib, itertools, tempfile, shutil, os, math, copy
from pathlib import Path
import numpy as np
import soundfile as sf
from scipy import signal
from engine.config import ROOT, SR, DURATION, MAX_SECONDS, IDS, DEFAULT
from engine.ultra_eq_engine import UltraEQEngine
from .metrics import loudness, spectrum, envelope, phase, harmonics, crest_bands, cross_pair, cross_at, masking, waveform, stereo, db, power, bandpass, stereo_domains, r, EPS
from . import priorities

SUBTYPES = ("PCM_16", "PCM_24", "PCM_32", "PCM_U8", "PCM_S8", "FLOAT", "DOUBLE")


def source_path(track):
    k = track["id"]
    if k in IDS:
        return ROOT / "fixtures" / f"{k}.wav"
    if re.fullmatch(r"u_[a-f0-9]{20}", k):
        return ROOT / ".lab-data" / "imports" / f"{k}.wav"
    raise ValueError("Unknown source")


def _info(track):
    meta = sf.info(source_path(track))
    if meta.format not in ("WAV", "WAVEX") or meta.channels > 2 or not (8000 <= meta.samplerate <= 192000) or meta.subtype not in SUBTYPES:
        raise ValueError("Ожидается mono/stereo PCM или float WAV, 8–192 кГц")
    return meta


def session_frames(states):
    """Session length follows the longest selected fragment: 5–20 s."""
    seconds = DURATION
    for s in states:
        meta = _info(s)
        seconds = max(seconds, meta.frames / meta.samplerate - float(s.get("offset", 0)))
    return int(SR * min(MAX_SECONDS, seconds))


def load_track(track, frames=None):
    frames = frames or SR * DURATION
    meta = _info(track)
    start = int(round(float(track.get("offset", 0)) * meta.samplerate))
    if start >= meta.frames:
        raise ValueError(f"Начало фрагмента «{track.get('name', track['id'])}» за пределами файла")
    x, sr = sf.read(source_path(track), always_2d=True, start=start, frames=int(math.ceil(frames * meta.samplerate / SR)) + 8, dtype="float64")
    if not len(x) or not np.isfinite(x).all():
        raise ValueError("Некорректные сэмплы WAV")
    if sr != SR:
        g = math.gcd(SR, sr)
        x = signal.resample_poly(x, SR // g, sr // g, axis=0)
    if x.shape[1] == 1:
        x = np.repeat(x, 2, axis=1)
    x = x[:frames]
    return np.pad(x, ((0, frames - len(x)), (0, 0)))


def phase_commands(state):
    bands = {"32-85Hz": state["phase"]} if state["phase"] else {}
    for b in state.get("phaseBands", []):
        bands[f"{b['low']:g}-{b['high']:g}Hz"] = b["deg"]
    return bands


def _extensions(value):
    value = value or {}
    return {"dynamic": bool(value.get("dynamic")), "depth": float(np.clip(value.get("depth", 0.55), 0, 1)), "ms": bool(value.get("ms"))}


def measure(states=DEFAULT, fft=8192, detail=True, device="cpu", anchors=None, extensions=None):
    anchors = priorities.clean(anchors, states)
    ext = _extensions(extensions)
    n = session_frames(states)
    engine = UltraEQEngine(SR, device)
    wavs, info, hf, active, bands = {}, {}, {}, {}, {}
    solo = any(s["solo"] for s in states)
    for s in states:
        x = engine.process(load_track(s, n), {"cuts": [{"freq": b["freq"], "q": b["q"], "gain_db": b["gain"]} for b in s["bands"]], "gain": s["gain"], "phase_shift_deg": phase_commands(s)})
        if not np.isfinite(x).all():
            raise ValueError("Переполнение обработки: снизьте суммарное усиление")
        wavs[s["id"]] = x
        if not s["muted"] and (not solo or s["solo"]):
            active[s["id"]] = x
        if detail:
            sp, f, p = spectrum(x, fft)
            info[s["id"]] = {**loudness(x), **sp, "wave": waveform(x, 144), "envelope": envelope(x), "phase": phase(x), "harmonics": harmonics(f, p), "crestBands": crest_bands(x), "stereo": stereo(x), "domains": stereo_domains(x)}
        else:
            f, p = signal.periodogram(x.mean(1), SR, window="hann", scaling="spectrum")
        hf[s["id"]] = (f, p)
        bands[s["id"]] = priorities.Bands(f, p)
    moves = []
    # Optional cross-adaptive block. Disabled by default, so the measured mix is unchanged.
    if ext["dynamic"] and ext["depth"] > 0 and len(active) >= 2:
        from engine.dynamic_phase_eq import apply as dynamic_apply

        processed, moves = dynamic_apply(active, states, anchors, SR, ext["depth"], ext["ms"])
        for k, y in processed.items():
            wavs[k] = y
            active[k] = y
            f, p = signal.periodogram(y.mean(1), SR, window="hann", scaling="spectrum")
            hf[k] = (f, p)
            bands[k] = priorities.Bands(f, p)
            if detail:
                sp, f2, p2 = spectrum(y, fft)
                info[k] = {**loudness(y), **sp, "wave": waveform(y, 144), "envelope": envelope(y), "phase": phase(y), "harmonics": harmonics(f2, p2), "crestBands": crest_bands(y), "stereo": stereo(y), "domains": stereo_domains(y)}
    mix = sum(active.values(), np.zeros((n, 2)))
    meter = loudness(mix, detail)
    corr = phase(mix)
    pairs = [cross_pair(x, y, a, b) for (a, x), (b, y) in itertools.combinations(active.items(), 2)]
    issues, seen = [], set()
    for p in sorted(pairs, key=lambda p: p["loss"]):
        # Coherence alone is not a conflict: require destructive interference and real power.
        if p["validBins"] > 0 and p["loss"] < -1.8 and p["coherence"] > 0.60 and p["hz"] < 125 and p["b"] not in seen:
            seen.add(p["b"])
            f, h = hf[p["b"]]
            ids = np.where(abs(f - p["hz"]) < SR / 8192 * 1.5)[0]
            hz = r(f[ids[np.argmax(h[ids])]], 1)
            donor = priorities.donor_order([p["b"], p["a"]], anchors, hz, {p["a"]: 0.0, p["b"]: 0.0}, {s["id"]: s.get("role", "melodic") for s in states})[0]
            sign = -1 if donor == p["b"] else 1
            why = " Коррекция ложится на инструмент, чью полосу слушатель отметил как неудачную." if priorities.avoid_at(anchors, donor, hz) else (" Партнёр защищён ориентиром." if donor != p["b"] else "")
            issues.append({"id": f"phase_{p['a']}_{p['b']}", "type": "phase", "title": "Фазовое вычитание", "severity": "high", "tracks": [p["a"], p["b"]], "hz": hz, "endHz": hz, "value": p["loss"], "unit": "dB", "phase": p["phase"], "coherence": p["coherence"],
                           "reason": f"Потеря энергии {abs(p['loss']):.1f} дБ относительно некогерентной суммы. Разность фаз {p['phase']:.1f}°, когерентность {p['coherence']:.2f}.{why}",
                           "command": {"track": donor, "phase": r(sign * p["phase"], 1)}, "penalty": min(35, -p["loss"] * 2.25), "metrics": [["Потеря энергии", f"{p['loss']} dB"], ["Разность фаз", f"{p['phase']}°"]]})
    for k, lo, hi, ref, target in [("bass_guitar", 221.5, 222.5, 73.4, -9), ("lead_synth", 344.5, 347.5, 440, -7)]:
        if k not in active:
            continue
        f, p = hf[k]
        level = np.sum(p[(f >= lo) & (f <= hi)])
        excess = 10 * np.log10(max(level, EPS) / max(np.sum(p[np.abs(f - ref) < 1]), EPS)) - target
        if excess > 0.4 and level > 1e-9:
            peak = np.where((f >= lo) & (f <= hi))[0]
            hz = r(f[peak[np.argmax(p[peak])]], 1)
            issues.append({"id": f"resonance_{k}", "type": "resonance", "title": "Тональный резонанс" if k == "bass_guitar" else "Скопление пиков", "severity": "medium", "tracks": [k], "hz": hz if k == "bass_guitar" else 345, "endHz": hz if k == "bass_guitar" else 347, "value": r(excess), "unit": "dB",
                           "reason": f"Контрольная полоса выше целевого отношения к опорному тону {ref:g} Гц на {excess:.1f} дБ. Измерение по полному окну, разрешение {SR/len(mix):.2f} Гц.",
                           "command": {"track": k, "freq": hz if k == "bass_guitar" else 346, "gain": r(-min(excess + 1, 4)), "q": 28 if k == "bass_guitar" else 35}, "penalty": min(19, excess * 1.15),
                           "metrics": [["Превышение порога", f"+{excess:.1f} dB"], ["Шаг точного FFT", f"{SR/len(mix):.2f} Hz"]]})
    # Listener anchors receive an additional phase check at any frequency, not only below 125 Hz.
    low_pairs = {tuple(z["tracks"]) for z in issues if z["type"] == "phase"}
    names = {s["id"]: s["name"] for s in states}
    roles = {s["id"]: s.get("role", "melodic") for s in states}
    for tid, entry in anchors.items():
        if tid not in active:
            continue
        for point in entry["prefer"]:
            for other in active:
                if other == tid:
                    continue
                cp = cross_at(active[tid], active[other], point["freq"])
                if not cp["valid"] or cp["loss"] >= -1.8 or cp["coherence"] <= 0.65 or abs(cp["phase"]) < 30:
                    continue
                if point["freq"] < 125 and (tid, other) in low_pairs:
                    continue
                # The phase shift is placed on the other stem; it is written into its disliked band first if marked.
                donor_note = " Полоса отмечена у него как неудачная — коррекция ложится туда." if priorities.avoid_at(anchors, other, point["freq"]) else ""
                issues.append({"id": f"anchor_phase_{tid}_{other}_{point['freq']:.0f}", "type": "phase", "title": "Фаза у ориентира", "severity": "high",
                    "tracks": [tid, other], "hz": cp["hz"], "endHz": cp["hz"], "value": cp["loss"], "unit": "dB", "phase": cp["phase"], "coherence": cp["coherence"],
                    "reason": f"У выбранного ориентира {names[tid]} {point['freq']:g} Гц обнаружено деструктивное сложение с {names[other]}: потеря {cp['loss']:.1f} дБ, фаза {cp['phase']:+.1f}°, когерентность {cp['coherence']:.2f}. Узкий фазовый сдвиг не меняет АЧХ полосы.{donor_note}",
                    "command": {"track": other, "freq": r(point["freq"], 1), "phase": r(-cp["phase"], 1), "q": 2.0}, "penalty": r(min(9, -cp["loss"] * 0.9)),
                    "metrics": [["Потеря у ориентира", f"{cp['loss']} dB"], ["Фаза / когерентность", f"{cp['phase']}° / {cp['coherence']}"]]})
        # Disliked bands: a destructive pair there is resolved on the disliked stem, so the partner stays intact.
        for point in entry["avoid"]:
            for other in active:
                if other == tid:
                    continue
                cp = cross_at(active[tid], active[other], point["freq"])
                if not cp["valid"] or cp["loss"] >= -1.8 or cp["coherence"] <= 0.65 or abs(cp["phase"]) < 30:
                    continue
                if any(i["id"] == f"anchor_phase_{other}_{tid}_{point['freq']:.0f}" for i in issues):
                    continue
                issues.append({"id": f"avoid_phase_{tid}_{other}_{point['freq']:.0f}", "type": "phase", "title": "Фаза в неудачной полосе", "severity": "medium",
                    "tracks": [other, tid], "hz": cp["hz"], "endHz": cp["hz"], "value": cp["loss"], "unit": "dB", "phase": cp["phase"], "coherence": cp["coherence"],
                    "reason": f"В полосе {point['freq']:g} Гц, отмеченной у {names[tid]} как неудачная, он деструктивно складывается с {names[other]}: потеря {cp['loss']:.1f} дБ, фаза {cp['phase']:+.1f}°. Фазовая коррекция выполняется на {names[tid]}; {names[other]} остаётся нетронутым.",
                    "command": {"track": tid, "freq": r(point["freq"], 1), "phase": r(cp["phase"], 1), "q": 2.0}, "penalty": r(min(7, -cp["loss"] * 0.7)),
                    "metrics": [["Потеря энергии", f"{cp['loss']} dB"], ["Исправляется на", names[tid]]]})
    prio, anchor_issues = priorities.evaluate(bands, states, active, anchors)
    issues += anchor_issues
    issues += priorities.masking(bands, states, active, anchors, {tuple(z["tracks"]) for z in issues if z["type"] == "phase"})
    issues.sort(key=lambda z: -z["penalty"])
    penalty = sum(z["penalty"] for z in issues) + max(0, meter["truePeak"] + 1) * 8
    score = r(max(0, 100 - penalty), 1) if active and np.max(np.abs(mix)) > 1e-8 else 0
    out = {"schemaVersion": 3, "device": device, "sampleRate": SR, "duration": r(n / SR, 3), "fft": fft, "binHz": r(SR / fft, 3), "score": score, "issues": issues, "channels": states, "anchors": anchors, "priorities": prio, "meter": meter, "correlation": corr["correlation"], "pairs": pairs, "trackInfo": info,
           "scope": [], "wave": [], "heatmap": [], "traces": {}, "masterLR": [r(db(np.max(abs(mix[:, 0])))), r(db(np.max(abs(mix[:, 1]))))],
           "dynamic": {"enabled": ext["dynamic"], "depth": ext["depth"], "ms": ext["ms"], "moves": moves}}
    # Stereo measurements are independent of whether the optional M/S processor is enabled.
    from engine.dynamic_phase_eq import ms_report
    out["msReport"] = ms_report(active or wavs, SR)
    if detail:
        for issue in issues:
            if issue["type"] not in ("phase", "resonance"):
                continue
            margin = 9 if issue["type"] == "resonance" else 16
            lo, hi, zoom = max(10, issue["hz"] - margin), issue["endHz"] + margin, {}
            for k in issue["tracks"]:
                f, p = hf[k]
                sel = (f >= lo) & (f <= hi)
                zoom[k] = np.round(10 * np.log10(np.maximum(p[sel], 1e-14)), 2).tolist()
            issue["zoom"] = {"freqs": np.round(f[sel], 2).tolist(), "lines": zoom, "resolution": r(SR / len(mix), 3)}
        out["wave"] = waveform(mix, 320)
        start = int(SR * 0.12)
        scope = mix[start : start + 1500 : 2]
        out["scope"] = np.round(np.clip(scope / max(np.percentile(np.abs(scope), 99.9), 1e-6), -1, 1), 4).tolist()
        chunks = np.array_split(mix, 44)
        out["traces"] = {"energy": [r(db(np.sqrt(power(z)))) for z in chunks], "peak": [r(db(np.max(np.abs(z)))) for z in chunks], "correlation": corr["trace"]}
        f, t, z = signal.stft(mix.mean(1), SR, nperseg=2048, noverlap=1024, nfft=4096)
        rows, ti = np.geomspace(20, 20000, 68), np.linspace(0, z.shape[1] - 1, 100).astype(int)
        out["heatmap"] = (np.round(np.clip((np.array([np.interp(rows, f, db(abs(z[:, i]))) for i in ti]) + 90) / 78, 0, 1) * 255).astype(int).tolist())
        low = bandpass(mix, 20, 150)
        out["lowEnd"] = {"peakDb": r(db(np.max(abs(low)))), "rmsDb": r(db(np.sqrt(power(low)))), "headroom": r(-db(np.max(abs(low))))}
        out["masking"] = masking(active)
        out["stereo"] = stereo(mix)
        out["stereoCross"] = []
        spectra = {}
        for k, x in active.items():
            _, m = signal.welch(x.mean(1), SR, nperseg=4096)
            _, side = signal.welch((x[:, 0] - x[:, 1]) / 2, SR, nperseg=4096)
            spectra[k] = (m, side)
        for a, (_, side) in spectra.items():
            if np.sum(side) < 1e-12:
                continue
            for b, (bm, _) in spectra.items():
                if a != b:
                    out["stereoCross"].append({"side": a, "mid": b, "overlap": r(np.sum(np.minimum(side, bm)) / max(np.sum(side), EPS), 3)})
    return out, wavs, mix


def save_take(states, fft=8192, reference=False, device="cpu", anchors=None, extensions=None, raw=False):
    """Publish complete immutable takes. The key fingerprints PCM, settings and anchors."""
    if raw:
        states = copy.deepcopy(states)
        for st in states:
            st.update(bands=[], gain=0, phase=0, phaseBands=[])
        extensions = {"dynamic": False, "ms": False, "depth": 0}
        anchors = None
    report, wavs, mix = measure(states, fft, device=device, anchors=anchors, extensions=extensions)
    report["renderMode"] = "raw" if raw else "processed"
    digest = hashlib.sha256(json.dumps([states, fft, "2.3.0", device, report["anchors"], report["dynamic"], raw], sort_keys=True).encode())
    for x in wavs.values():
        digest.update(x.astype("<f4").tobytes())
    key = "reference" if reference else digest.hexdigest()[:20]
    root = ROOT / "data" if reference else ROOT / ".lab-data" / "renders"
    root.mkdir(parents=True, exist_ok=True)
    final = root / key
    report["key"] = key
    stage = Path(tempfile.mkdtemp(prefix=".render-", dir=root))
    try:
        sf.write(stage / "mix.wav", mix, SR, subtype="FLOAT")
        # Stems are written processed but unmasked, so a muted channel can still be auditioned.
        for s in states:
            sf.write(stage / f"{s['id']}.wav", wavs[s["id"]], SR, subtype="FLOAT")
        (stage / "report.json").write_text(json.dumps(report, ensure_ascii=False, allow_nan=False, separators=(",", ":")))
        if reference:
            final.mkdir(exist_ok=True)
            for f in stage.iterdir():
                os.replace(f, final / f.name)
        elif not final.exists():
            try:
                stage.rename(final)
            except OSError:
                if not (final / "report.json").is_file():
                    raise
        return report
    finally:
        if stage.exists():
            shutil.rmtree(stage)
