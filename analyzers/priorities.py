"""Listener anchors (prefer / avoid) and spectrum-wide masking conflicts.

Anchors never change audio by themselves. They give the agent asymmetric
knowledge before the full analysis:

* prefer (up to 2, sub 1): protect the band from corrective cuts (<= 1 dB),
  carve the maskers first, emphasise last and only within a bounded budget.
* avoid (up to 2): the listener dislikes this band of this instrument. It is a
  willing donor: cuts there may go deeper (-9 dB), phase corrections are placed
  there first, and a pre-emptive cleanup is proposed even without a conflict.

Every stem keeps its full measured conflict set; the anchors change who pays
for a resolution, not whether resolution is required.
"""

import itertools
import numpy as np
from scipy import signal
from engine.config import SR
from .metrics import r, EPS

TARGET_SMR = 3.0  # a preferred band should exceed the sum of all other stems by 3 dB
CARVE_BUDGET = -4.0  # ordinary masker attenuation inside a preferred band
AVOID_CARVE_BUDGET = -9.0  # a masker that marked this band as "avoid" may yield much deeper
MASK_BUDGET = -6.0  # ordinary generic masking move budget
AVOID_MASK_BUDGET = -9.0
AVOID_PREEMPT_DB = -2.5  # proactive cleanup of a disliked band that is loud in the mix
THIRDS = [40, 50, 63, 80, 100, 125, 160, 200, 250, 315, 400, 500, 630, 800, 1000, 1250, 1600, 2000, 2500, 3150, 4000, 5000, 6300, 8000, 10000, 12500]
ROLE_HOME = {"sub": (20, 90), "bass": (40, 300), "drums": (40, 130), "vocal": (250, 5000), "melodic": (200, 6000)}


def limit(role, kind="prefer"):
    return (1 if role == "sub" else 2) if kind == "prefer" else 2


def peaking_db(freqs, f0, gain, q):
    a = 10 ** (gain / 40)
    w = 2 * np.pi * f0 / SR
    al = np.sin(w) / (2 * q)
    c = np.cos(w)
    _, h = signal.freqz([1 + al * a, -2 * c, 1 - al * a], [1 + al / a, -2 * c, 1 - al / a], worN=np.atleast_1d(np.asarray(freqs, float)), fs=SR)
    return 20 * np.log10(np.maximum(np.abs(h), 1e-12))


def eq_at(bands, f0):
    return float(sum(peaking_db([f0], b["freq"], b["gain"], b["q"])[0] for b in bands))


def edges(f0, q):
    octaves = max(1 / 6, 2 / np.log(2) * np.arcsinh(1 / (2 * q)))
    return f0 * 2 ** (-octaves / 2), f0 * 2 ** (octaves / 2)


def overlaps(a, b):
    lo1, hi1 = edges(a["freq"], a["q"])
    lo2, hi2 = edges(b["freq"], b["q"])
    return lo1 < hi2 and lo2 < hi1


def covers(point, freq):
    lo, hi = edges(point["freq"], point["q"])
    return lo <= freq <= hi


class Bands:
    """Band power of a full-length periodogram through cumulative sums."""

    def __init__(self, f, p):
        self.f = f
        self.c = np.r_[0.0, np.cumsum(p)]

    def db(self, lo, hi):
        i, j = np.searchsorted(self.f, [lo, hi])
        return 10 * np.log10(max(self.c[j] - self.c[i], EPS))


def _point(p, kind):
    gain = float(np.clip(abs(p.get("gain", 0)), 0, 12)) if kind == "prefer" else float(np.clip(p.get("gain", -6), -18, 0))
    return {"freq": float(np.clip(p["freq"], 20, 20000)), "gain": gain, "q": float(np.clip(p.get("q", 2), 0.3, 12))}


def clean(anchors, states):
    """Normalise {track: [prefer...]} (legacy) or {track: {prefer: [...], avoid: [...]}}."""
    roles = {s["id"]: s.get("role", "melodic") for s in states}
    out = {}
    for k, entry in (anchors or {}).items():
        if k not in roles:
            continue
        prefer, avoid = (entry, []) if isinstance(entry, list) else ((entry or {}).get("prefer", []), (entry or {}).get("avoid", []))
        prefer = [_point(p, "prefer") for p in prefer if isinstance(p, dict) and "freq" in p][: limit(roles[k], "prefer")]
        avoid = [_point(p, "avoid") for p in avoid if isinstance(p, dict) and "freq" in p][: limit(roles[k], "avoid")]
        if prefer or avoid:
            out[k] = {"prefer": prefer, "avoid": avoid}
    return out


def prefer_of(anchors, k):
    return anchors.get(k, {}).get("prefer", [])


def avoid_of(anchors, k):
    return anchors.get(k, {}).get("avoid", [])


def avoid_at(anchors, k, freq):
    """The listener's 'avoid' point of stem k that covers freq, if any."""
    return next((p for p in avoid_of(anchors, k) if covers(p, freq)), None)


def cut_budget(anchors, k, freq, default):
    return AVOID_CARVE_BUDGET if avoid_at(anchors, k, freq) else default


def guard(cmd, points):
    """Narrow, or reject, a cut so it removes at most 1 dB at a preferred anchor."""
    if not points or cmd.get("gain", 0) >= 0:
        return cmd, ""
    q = cmd["q"]
    f = [p["freq"] for p in points]
    while min(peaking_db(f, cmd["freq"], cmd["gain"], q)) < -1.0:
        if q >= 50:
            return None, f"Отклонено: вырез {cmd['freq']:g} Гц задевает ориентир {', '.join(f'{x:g}' for x in f)} Гц"
        q = min(50.0, q * 1.5)
    if q != cmd["q"]:
        return {**cmd, "q": r(q, 2)}, f"Q сужена {cmd['q']:g} → {q:.1f}, ориентир сохранён"
    return cmd, ""


def donor_order(candidates, anchors, freq, levels, roles):
    """Who should yield at freq. Lower key = more willing donor.

    Order: listener 'avoid' band → not a 'prefer' band → outside the role's home
    range → louder stems (they contribute more masking energy)."""

    def key(k):
        avoid = avoid_at(anchors, k, freq) is not None
        prefer = any(covers(p, freq) for p in prefer_of(anchors, k))
        lo, hi = ROLE_HOME.get(roles.get(k, "melodic"), (200, 6000))
        home = lo <= freq <= hi
        return (0 if avoid else 1, 1 if prefer else 0, 1 if home else 0, -levels.get(k, -300.0))

    return sorted(candidates, key=key)


def evaluate(spectra, states, active, anchors):
    names = {s["id"]: s["name"] for s in states}
    roles = {s["id"]: s.get("role", "melodic") for s in states}
    eq = {s["id"]: s["bands"] for s in states}
    rows, issues = [], []
    for tid, entry in anchors.items():
        if tid not in active:
            continue
        for j, a in enumerate(entry["prefer"]):
            lo, hi = edges(a["freq"], a["q"])
            own = spectra[tid].db(lo, hi)
            others = {k: spectra[k].db(lo, hi) for k in active if k != tid}
            rest = 10 * np.log10(sum(10 ** (v / 10) for v in others.values()) + EPS) if others else -300.0
            smr = float(min(60, own - rest))
            masker = max(others, key=others.get) if others else None
            rows.append({"track": tid, "index": j, "freq": r(a["freq"], 1), "gain": a["gain"], "q": a["q"], "ownDb": r(own), "restDb": r(rest) if others else None, "smr": r(smr), "masker": masker, "clear": bool(smr >= TARGET_SMR)})
            if smr >= TARGET_SMR or own < -110:
                continue
            deficit = TARGET_SMR - smr
            cmd, how = None, ""
            donors = [k for k in others if others[k] >= own - 9 and not any(overlaps(a, b) for b in prefer_of(anchors, k))]
            for k in donor_order(donors, anchors, a["freq"], others, roles):
                budget = cut_budget(anchors, k, a["freq"], CARVE_BUDGET)
                if eq_at(eq[k], a["freq"]) > budget + 0.25:
                    willing = avoid_at(anchors, k, a["freq"]) is not None
                    depth = min(4.5 if willing else 3.0, max(1.5, deficit * (0.85 if willing else 0.6)))
                    cmd = {"track": k, "freq": r(a["freq"], 1), "gain": r(-depth, 1), "q": r(float(np.clip(a["q"], 1.2, 6)), 2)}
                    how = f"освободить полосу, ослабив {names[k]}" + (" — слушатель отметил её у этого инструмента как неудачную" if willing else "")
                    break
            if cmd is None:
                cap, have = min(6.0, a["gain"] * 0.6), eq_at(eq[tid], a["freq"])
                if have < cap - 0.25:
                    cmd = {"track": tid, "freq": r(a["freq"], 1), "gain": r(min(1.5, cap - have), 1), "q": r(a["q"], 2)}
                    how = f"мягко подчеркнуть {names[tid]} (бюджет +{cap:.1f} дБ)"
            issues.append({
                "id": f"priority_{tid}_{j}", "type": "priority", "title": "Ориентир замаскирован", "severity": "medium",
                "tracks": [tid] + ([masker] if masker else []), "hz": r(a["freq"], 1), "endHz": r(a["freq"], 1), "value": r(smr), "unit": "dB SMR",
                "reason": f"Ориентир {names[tid]} {a['freq']:g} Гц громче суммы остальных стемов лишь на {smr:+.1f} дБ (цель +{TARGET_SMR:g}). Главный маскер — {names.get(masker, '—')}. "
                + (f"Решение: {how}." if cmd else "Бюджеты коррекции исчерпаны — нужна аранжировка или другой ориентир."),
                "command": cmd, "penalty": r(min(16, 1.5 + deficit * 2.4)),
                "metrics": [["SMR ориентира", f"{smr:+.1f} dB"], ["Главный маскер", names.get(masker, "—")]],
            })
        # Pre-emptive cleanup: a disliked band that is loud in the mix is cleaned even without a conflict.
        for j, a in enumerate(entry["avoid"]):
            lo, hi = edges(a["freq"], a["q"])
            own = spectra[tid].db(lo, hi)
            total = 10 * np.log10(sum(10 ** (spectra[k].db(lo, hi) / 10) for k in active) + EPS)
            share = own - total
            have = eq_at(eq[tid], a["freq"])
            rows.append({"track": tid, "index": j, "kind": "avoid", "freq": r(a["freq"], 1), "gain": a["gain"], "q": a["q"], "ownDb": r(own), "shareDb": r(share), "cutDb": r(have), "settled": bool(have <= AVOID_PREEMPT_DB + 0.25 or share < -12)})
            if share < -12 or have <= AVOID_PREEMPT_DB + 0.25 or own < -110:
                continue
            issues.append({
                "id": f"avoid_{tid}_{j}", "type": "avoid", "title": "Нежелательная полоса", "severity": "low", "tracks": [tid],
                "hz": r(a["freq"], 1), "endHz": r(a["freq"], 1), "value": r(share), "unit": "dB",
                "reason": f"Слушатель отметил {a['freq']:g} Гц у {names[tid]} как неудачную полосу; она даёт {share:+.1f} дБ от суммарной энергии микса здесь. Мягкая предварительная очистка до {AVOID_PREEMPT_DB:g} дБ — ещё до поиска конфликтов.",
                "command": {"track": tid, "freq": r(a["freq"], 1), "gain": r(max(AVOID_PREEMPT_DB - have, -2.5), 1), "q": r(float(np.clip(a["q"], 1.0, 8)), 2)},
                "penalty": r(min(4.0, 1.0 + max(0.0, share + 12) * 0.25)),
                "metrics": [["Доля в миксе", f"{share:+.1f} dB"], ["Текущий вырез", f"{have:+.1f} dB"]],
            })
    plan = []
    for (a, pa), (b, pb) in itertools.combinations(anchors.items(), 2):
        if a not in active or b not in active:
            continue
        for x in pa["prefer"]:
            for y in pb["prefer"]:
                if overlaps(x, y):
                    cents = 1200 * abs(np.log2(x["freq"] / y["freq"]))
                    issues.append({
                        "id": f"clash_{a}_{b}_{x['freq']:.0f}", "type": "clash", "title": "Ориентиры перекрываются", "severity": "low", "tracks": [a, b],
                        "hz": r(min(x["freq"], y["freq"]), 1), "endHz": r(max(x["freq"], y["freq"]), 1), "value": r(cents), "unit": "cent",
                        "reason": f"{names[a]} {x['freq']:g} Гц и {names[b]} {y['freq']:g} Гц претендуют на одну полосу. Защищённые частоты не вырезаются; разведите ориентиры хотя бы на 1/3 октавы.",
                        "command": None, "penalty": 0, "metrics": [["Расстояние", f"{cents:.0f} cent"], ["Автокоррекция", "нет"]],
                    })
        # Preference plan: prefer of one stem overlapping avoid of another is the ideal asymmetric case.
        for keep, give, kp, gp in ((a, b, pa, pb), (b, a, pb, pa)):
            for x in kp["prefer"]:
                for y in gp["avoid"]:
                    if overlaps(x, y):
                        plan.append({"keep": keep, "give": give, "hz": r(x["freq"], 1), "note": f"{names[keep]} сохраняется, {names[give]} уступает до {AVOID_CARVE_BUDGET:g} дБ"})
    prefer_rows = [x for x in rows if x.get("kind") != "avoid"]
    avoid_rows = [x for x in rows if x.get("kind") == "avoid"]
    score = r(100 * np.mean([np.clip((x["smr"] + 6) / (TARGET_SMR + 6), 0, 1) for x in prefer_rows]), 1) if prefer_rows else None
    return {"rows": prefer_rows, "avoidRows": avoid_rows, "plan": plan, "target": TARGET_SMR, "score": score, "clear": int(sum(x["clear"] for x in prefer_rows)), "total": len(prefer_rows), "avoidTotal": len(avoid_rows), "avoidSettled": int(sum(x["settled"] for x in avoid_rows))}, issues


def masking(spectra, states, active, anchors, skip):
    """Third-octave pairs that are equally loud where both instruments are salient."""
    roles = {s["id"]: s.get("role", "melodic") for s in states}
    names = {s["id"]: s["name"] for s in states}
    eq = {s["id"]: s["bands"] for s in states}
    lv = {k: np.array([spectra[k].db(c / 2 ** (1 / 6), c * 2 ** (1 / 6)) for c in THIRDS]) for k in active}
    if len(lv) < 2:
        return []
    mix = 10 * np.log10(sum(10 ** (v / 10) for v in lv.values()) + EPS)
    relevant = mix > mix.max() - 30
    found = []
    for a, b in itertools.combinations(lv, 2):
        A, B = lv[a], lv[b]
        sa, sb = A - A.max(), B - B.max()
        worst = None
        for i, c in enumerate(THIRDS):
            gap = abs(A[i] - B[i])
            if not relevant[i] or gap >= 4 or sa[i] < -12 or sb[i] < -12 or (c < 125 and ((a, b) in skip or (b, a) in skip)):
                continue
            weight = (4 - gap) + (mix[i] - mix.max() + 30) / 10
            if worst is None or weight > worst[0]:
                worst = (weight, i, c, gap)
        if not worst:
            continue
        _, i, c, gap = worst
        point = {"freq": c, "q": 4.3}
        order = donor_order([a, b], anchors, c, {a: A[i], b: B[i]}, roles)
        victim = next((k for k in order if not any(overlaps(point, p) for p in prefer_of(anchors, k)) and eq_at(eq[k], c) > cut_budget(anchors, k, c, MASK_BUDGET) + 0.25), None)
        if victim is None:
            continue
        other = b if victim == a else a
        willing = avoid_at(anchors, victim, c) is not None
        found.append({
            "id": f"masking_{a}_{b}", "type": "masking", "title": "Частотное маскирование", "severity": "medium" if gap < 2 else "low",
            "tracks": [other, victim], "hz": float(c), "endHz": float(c), "value": r(gap), "unit": "dB",
            "reason": f"{names[a]} и {names[b]} почти равны по уровню в третьоктаве {c:g} Гц (разница {gap:.1f} дБ), и полоса существенна для обоих. Уступает {names[victim]}: "
            + ("слушатель отметил эту полосу у него как неудачную." if willing else "с учётом роли и ориентиров эта полоса для него менее характерна."),
            "command": {"track": victim, "freq": float(c), "gain": -3.0 if willing else -2.0, "q": 2.9}, "penalty": r(1 + 2 * (1 - gap / 4)),
            "metrics": [["Разница уровней", f"{gap:.1f} dB"], ["Уступает", names[victim] + (" · avoid" if willing else "")]],
        })
    return sorted(found, key=lambda z: -z["penalty"])[:5]
