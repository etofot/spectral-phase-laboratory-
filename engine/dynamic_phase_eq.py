"""Cross-adaptive dynamic phase EQ.

This is not a static equalizer. After the measured mix is known, each real
conflict band gets a leader and a follower from the same hierarchy used by the
anchors (prefer / avoid / role). While the leader is active, only the
phase-locked part of the follower in that band is subtracted — the follower's
independent, out-of-phase content stays. Depth 0 or a disabled block is a no-op.
"""

import numpy as np
from scipy import signal
from analyzers.priorities import avoid_at, prefer_of, ROLE_HOME
from .ms import decode, encode

NPERSEG, HOP = 2048, 512
THIRDS = [40, 50, 63, 80, 100, 125, 160, 200, 250, 315, 400, 500, 630, 800, 1000, 1250, 1600, 2000, 2500, 3150, 4000, 5000, 6300, 8000, 10000]
# Lower number = higher priority = more likely to lead.
ROLE_RANK = {
    "low": {"drums": 0, "sub": 1, "bass": 2, "vocal": 3, "melodic": 4},
    "mid": {"vocal": 0, "melodic": 1, "bass": 2, "drums": 3, "sub": 4},
    "high": {"drums": 0, "melodic": 1, "vocal": 2, "bass": 3, "sub": 4},
}


def _class(freq):
    return "low" if freq < 250 else "high" if freq > 5000 else "mid"


def _keep_score(track, freq, anchors, roles):
    """Higher score keeps the band (leader). Avoid yields; prefer and role priority keep."""
    role = roles.get(track, "melodic")
    home = ROLE_HOME.get(role, (200, 6000))
    return (
        -80 if avoid_at(anchors, track, freq) else 0
    ) + (60 if any(abs(np.log2(p["freq"] / freq)) < 0.5 for p in prefer_of(anchors, track)) else 0) + (
        12 if home[0] <= freq <= home[1] else 0
    ) - 8 * ROLE_RANK[_class(freq)].get(role, 3)


def pairs_for(levels, states, anchors, limit=16):
    """One leader/follower pair per salient third-octave where two stems actually overlap."""
    ids = list(levels)
    roles = {s["id"]: s.get("role", "melodic") for s in states}
    found = []
    if len(ids) < 2:
        return found
    for i, hz in enumerate(THIRDS):
        audible = [k for k in ids if levels[k][i] > -55]
        if len(audible) < 2:
            continue
        ordered = sorted(audible, key=lambda k: levels[k][i], reverse=True)
        a, b = ordered[0], ordered[1]
        if abs(levels[a][i] - levels[b][i]) > 8 or min(levels[a][i], levels[b][i]) < max(levels[a][i], levels[b][i]) - 8:
            continue
        leader, follower = sorted((a, b), key=lambda k: _keep_score(k, hz, anchors, roles), reverse=True)
        if leader == follower:
            continue
        found.append({"leader": leader, "follower": follower, "hz": float(hz), "q": 2.2, "gap": round(abs(levels[a][i] - levels[b][i]), 2)})
    # Listener anchors are explicit even if the third-octave gap is wider.
    for s in states:
        for point in prefer_of(anchors, s["id"]):
            others = [k for k in ids if k != s["id"]]
            if not others:
                continue
            follower = max(others, key=lambda k: _band(levels[k], point["freq"]))
            if _band(levels[follower], point["freq"]) > -50:
                found.append({"leader": s["id"], "follower": follower, "hz": float(point["freq"]), "q": float(point["q"]), "gap": None, "reason": "prefer"})
        for point in anchors.get(s["id"], {}).get("avoid", []):
            others = [k for k in ids if k != s["id"]]
            if not others:
                continue
            leader = max(others, key=lambda k: _keep_score(k, point["freq"], anchors, roles))
            found.append({"leader": leader, "follower": s["id"], "hz": float(point["freq"]), "q": float(point["q"]), "gap": None, "reason": "avoid"})
    # De-duplicate very close pairs.
    unique = []
    for p in found:
        if not any(u["leader"] == p["leader"] and u["follower"] == p["follower"] and abs(np.log2(u["hz"] / p["hz"])) < 0.18 for u in unique):
            unique.append(p)
    return unique[:limit]


def _band(levels_row, hz):
    if not len(levels_row):
        return -120
    idx = int(np.argmin([abs(np.log2(c / hz)) for c in THIRDS]))
    return float(levels_row[idx])


def band_levels(mono, sr):
    f, p = signal.welch(mono, sr, nperseg=4096)
    df = f[1] if len(f) > 1 else 1
    out = []
    for c in THIRDS:
        sel = (f >= c / 2 ** (1 / 6)) & (f < c * 2 ** (1 / 6))
        out.append(10 * np.log10(max(1e-20, np.sum(p[sel]) * df)))
    return out


def _smooth(env, sr):
    attack = 1 - np.exp(-HOP / sr / 0.006)
    release = 1 - np.exp(-HOP / sr / 0.090)
    y = np.empty_like(env)
    state = env[0] if len(env) else 0
    for i, x in enumerate(env):
        state += (attack if x > state else release) * (x - state)
        y[i] = state
    return y


def _activity(env):
    if not len(env) or np.max(env) <= 1e-8:
        return np.zeros_like(env)
    floor, peak = np.percentile(env, 35), np.percentile(env, 95)
    return np.clip((env - floor) / max(peak - floor, 1e-8), 0, 1)


def _transform(channels, sr):
    spec = {}
    for k, x in channels.items():
        f, _, z = signal.stft(x, sr, window="hann", nperseg=NPERSEG, noverlap=NPERSEG - HOP, boundary="zeros", padded=True)
        spec[k] = z
    return f, spec


def _invert(z, n, sr):
    _, y = signal.istft(z, sr, window="hann", nperseg=NPERSEG, noverlap=NPERSEG - HOP)
    y = y[:n]
    return np.pad(y, (0, max(0, n - len(y))))


def _subtract(spec, freqs, pairs, depth, sr):
    """Subtract the phase-locked follower component, scaled by leader activity and depth."""
    moves = []
    weight_cache = {}
    for pair in pairs:
        leader, follower = spec.get(pair["leader"]), spec.get(pair["follower"])
        if leader is None or follower is None or pair["leader"] == pair["follower"]:
            continue
        key = (round(pair["hz"], 2), round(pair["q"], 2))
        if key not in weight_cache:
            bw = max(pair["hz"] / max(pair["q"], 0.7), 18)
            weight_cache[key] = np.exp(-0.5 * ((freqs - pair["hz"]) / (bw / 2.355)) ** 2)
        w = weight_cache[key]
        sel = w > 0.18
        if not np.any(sel):
            continue
        frames = min(leader.shape[1], follower.shape[1])
        L, F = leader[sel, :frames], follower[sel, :frames]
        env = _smooth(np.sum(np.abs(L) * w[sel, None], axis=0), sr)
        g = depth * _activity(env)
        proj = np.real(F * np.conj(L) / (np.abs(L) ** 2 + 1e-12)) * L
        follower[sel, :frames] = F - g[None, :] * w[sel, None] * proj
        hot = g > 0.25
        before = np.mean(np.abs(F[:, hot] if np.any(hot) else F) ** 2)
        after = np.mean(np.abs(follower[sel, :frames][:, hot] if np.any(hot) else follower[sel, :frames]) ** 2)
        reduction = 10 * np.log10(max(after, 1e-20) / max(before, 1e-20))
        moves.append({"leader": pair["leader"], "follower": pair["follower"], "hz": pair["hz"], "reductionDb": round(float(min(0, reduction)), 2), "active": round(float(np.mean(g)), 3)})
    return moves


def apply(wavs, states, anchors=None, sr=48000, depth=0.55, ms=False):
    """Return processed copies and a compact move report. depth<=0 leaves audio untouched."""
    anchors = anchors or {}
    depth = float(np.clip(depth, 0, 1))
    if depth <= 0 or len(wavs) < 2:
        return {k: np.array(v, copy=True) for k, v in wavs.items()}, []
    n = min(len(v) for v in wavs.values())
    if ms:
        mids, sides = {}, {}
        for k, x in wavs.items():
            mids[k], sides[k] = encode(x[:n])
        moves = _domain(mids, states, anchors, sr, depth, "mid") + _domain(sides, states, anchors, sr, depth, "side")
        out = {k: decode(mids[k], sides[k]) for k in wavs}
        return out, moves
    # Linked stereo: one activity/projection per channel, shared conflict list from the mid.
    mids = {k: encode(v[:n])[0] for k, v in wavs.items()}
    levels = {k: band_levels(v, sr) for k, v in mids.items()}
    pairs = pairs_for(levels, states, anchors)
    if not pairs:
        return {k: np.array(v[:n], copy=True) for k, v in wavs.items()}, []
    out, moves = {}, []
    for ch in (0, 1):
        channels = {k: v[:n, ch] for k, v in wavs.items()}
        freqs, spec = _transform(channels, sr)
        found = _subtract(spec, freqs, pairs, depth, sr)
        if ch == 0:
            moves = found
        for k, z in spec.items():
            y = _invert(z, n, sr)
            if k not in out:
                out[k] = np.zeros((n, 2))
            out[k][:, ch] = y
    return out, moves


def _domain(channels, states, anchors, sr, depth, label):
    if label == "side" and max(np.sqrt(np.mean(v**2)) for v in channels.values()) < 1e-5:
        return []
    levels = {k: band_levels(v, sr) for k, v in channels.items()}
    pairs = pairs_for(levels, states, anchors)
    if not pairs:
        return []
    n = min(len(v) for v in channels.values())
    freqs, spec = _transform({k: v[:n] for k, v in channels.items()}, sr)
    moves = _subtract(spec, freqs, pairs, depth, sr)
    for k, z in spec.items():
        channels[k][:] = _invert(z, n, sr)
    for m in moves:
        m["domain"] = label
    return moves


def ms_report(wavs, sr):
    """Conflict view of the encoded signals. Does not modify audio."""
    mids, sides, widths = {}, {}, []
    for k, x in wavs.items():
        m, s = encode(x)
        mids[k], sides[k] = m, s
        widths.append({"id": k, "midDb": round(float(20 * np.log10(max(1e-8, np.sqrt(np.mean(m**2))))), 2), "sideDb": round(float(20 * np.log10(max(1e-8, np.sqrt(np.mean(s**2))))), 2)})
    left = {k: x[:, 0] for k, x in wavs.items()}
    right = {k: x[:, 1] for k, x in wavs.items()}
    return {"widths": widths, "left": _conflicts(left, sr), "right": _conflicts(right, sr), "mid": _conflicts(mids, sr), "side": _conflicts(sides, sr)}


def _conflicts(channels, sr):
    levels = {k: band_levels(v, sr) for k, v in channels.items()}
    rows = []
    ids = list(levels)
    for i in range(len(ids)):
        for j in range(i + 1, len(ids)):
            a, b = ids[i], ids[j]
            if max(levels[a]) < -70 or max(levels[b]) < -70:
                continue
            gaps = [(abs(levels[a][n] - levels[b][n]), THIRDS[n]) for n in range(len(THIRDS)) if min(levels[a][n], levels[b][n]) > -50]
            if not gaps:
                continue
            gap, hz = min(gaps)
            if gap < 8:
                f, pxy = signal.csd(channels[a], channels[b], sr, nperseg=4096)
                _, paa = signal.welch(channels[a], sr, nperseg=4096)
                _, pbb = signal.welch(channels[b], sr, nperseg=4096)
                idx = np.argmin(abs(f - hz))
                coherence = abs(pxy[idx])**2 / max(paa[idx] * pbb[idx], 1e-30)
                rows.append({"a": a, "b": b, "hz": hz, "gap": round(float(gap), 2), "coherence": round(float(min(1, coherence)), 3), "phaseDeg": round(float(np.rad2deg(np.angle(pxy[idx]))), 1)})
    return sorted(rows, key=lambda r: r["gap"])[:8]
