"""Deterministic measurement-driven director. No LLM, no guessed improvement.

Every hypothesis is rendered on a copy, measured, and accepted only if the
readiness index improves while True Peak stays <= -1 dBTP. Listener anchors are
protected: a cut that would remove more than 1 dB at an anchor is narrowed or
rejected before it is even rendered.
"""

import argparse, json, sys, copy, uuid, time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from analyzers.suite import measure, save_take
from analyzers.priorities import clean, guard, prefer_of
from engine.config import DEFAULT, ROOT


def apply(states, cmd):
    tr = next((s for s in states if s["id"] == cmd["track"]), None)
    if tr is None:
        return False
    if "phase" in cmd:
        if "freq" in cmd:  # local STFT phase band around a listener anchor
            from analyzers.priorities import edges
            low, high = edges(cmd["freq"], cmd.get("q", 2.0))
            bands = tr.setdefault("phaseBands", [])
            near = next((b for b in bands if abs(b["low"] - low) < 0.5 and abs(b["high"] - high) < 0.5), None)
            if near:
                near["deg"] = round((near["deg"] + cmd["phase"] + 180) % 360 - 180, 1)
            elif len(bands) < 8:
                bands.append({"low": round(low, 2), "high": round(high, 2), "deg": round(cmd["phase"], 1)})
            else:
                return False
        else:
            tr["phase"] = round((tr["phase"] + cmd["phase"] + 180) % 360 - 180, 1)
        return True
    near = next((b for b in tr["bands"] if abs(b["freq"] - cmd["freq"]) < 1 and b["q"] == cmd["q"]), None)
    if near:
        near["gain"] = round(min(6, near["gain"] + cmd["gain"]) if cmd["gain"] > 0 else max(-30, near["gain"] + cmd["gain"]), 2)
    elif len(tr["bands"]) < 64:
        tr["bands"].append({k: cmd[k] for k in ("freq", "gain", "q")})
    else:
        return False
    return True


def run(states, fft=8192, max_iter=10, only=None, device="cpu", anchors=None, budget_s=120, extensions=None):
    anchors = clean(anchors, states)
    chosen = copy.deepcopy(states)
    before, _, _ = measure(chosen, fft, False, device, anchors, extensions)
    current, log, blocked = before, [], set()  # blocked: protected by an anchor
    run_id = uuid.uuid4().hex
    log_dir = ROOT / ".lab-data" / "logs"
    log_dir.mkdir(parents=True, exist_ok=True)
    journal = log_dir / (run_id + ".jsonl")

    def note(entry):
        log.append(entry)
        with journal.open("a", encoding="utf8") as stream:
            stream.write(json.dumps(entry, ensure_ascii=False, allow_nan=False) + "\n")

    deadline = time.monotonic() + budget_s
    # One iteration = one pass over every open conflict; each accepted move is re-measured.
    for i in range(max(1, min(10, max_iter))):
        progress, tried = False, set()
        while time.monotonic() < deadline:
            issue = next((z for z in current["issues"] if z.get("command") and z["id"] not in blocked and z["id"] not in tried and (not only or z["id"] == only)), None)
            if issue is None:
                break
            tried.add(issue["id"])
            base = {"iteration": i + 1, "issue": issue["id"], "type": issue["type"], "reason": issue["reason"], "before": current["score"], "peakBefore": current["meter"]["truePeak"]}
            cmd, why = guard(issue["command"], prefer_of(anchors, issue["command"]["track"]))
            if cmd is None:
                blocked.add(issue["id"])  # protection is deterministic: never retry
                note({**base, "command": issue["command"], "headroomTrim": 0, "after": current["score"], "peakAfter": current["meter"]["truePeak"], "accepted": False, "note": why})
                continue
            candidate = copy.deepcopy(chosen)
            if not apply(candidate, cmd):
                continue
            after, _, _ = measure(candidate, fft, False, device, anchors, extensions)
            trim = 0
            if after["meter"]["truePeak"] > -1:  # linked trim keeps the balance between stems
                trim = round(-1.1 - after["meter"]["truePeak"], 2)
                for s in candidate:
                    s["gain"] = max(-36, s["gain"] + trim)
                after, _, _ = measure(candidate, fft, False, device, anchors, extensions)
            # Listener-driven moves are judged on their own metric too: a carve that measurably
            # clears a preferred band is accepted when the global index stays within 0.4 points.
            listener = issue["type"] in ("priority", "avoid")
            gain_global = after["score"] - current["score"]
            gain_anchor = (after["priorities"]["score"] or 0) - (current["priorities"]["score"] or 0) if listener else 0
            ok = after["meter"]["truePeak"] <= -1 and (gain_global > 0.05 or (listener and gain_anchor > 0.8 and gain_global > -0.4))
            note({**base, "command": cmd, "headroomTrim": trim, "after": after["score"], "peakAfter": after["meter"]["truePeak"], "accepted": ok, "note": why})
            if ok:
                chosen, current, progress = candidate, after, True
                tried.discard(issue["id"])  # the same conflict may take another, measured step
                if only:
                    break
        if not progress or not current["issues"] or time.monotonic() >= deadline or only:
            break
    report = save_take(chosen, fft, device=device, anchors=anchors, extensions=extensions)
    return {"before": before["score"], "beforePriorities": before["priorities"], "steps": log, "runId": run_id, "report": report}


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--reference", action="store_true")
    parser.add_argument("--stdin", action="store_true")
    parser.add_argument("--out")
    parser.add_argument("--iterations", type=int, default=10)
    parser.add_argument("--anchors", type=Path, help="JSON: {track_id: [{freq, gain, q}]}")
    parser.add_argument("--device", choices=["cpu", "cuda"], default="cpu")
    a = parser.parse_args()
    file_anchors = json.loads(a.anchors.read_text()) if a.anchors else None
    if a.reference:
        out = save_take(DEFAULT, 8192, True, a.device)
    elif a.stdin:
        req = json.load(sys.stdin)
        states, fft, anchors = req.get("channels", DEFAULT), req.get("fft", 8192), req.get("anchors")
        out = run(states, fft, req.get("iterations", 10), req.get("only"), a.device, anchors, extensions=req.get("extensions")) if req.get("action") == "preview" else save_take(states, fft, device=a.device, anchors=anchors, extensions=req.get("extensions"), raw=req.get("action") == "baseline")
    else:
        out = run(DEFAULT, max_iter=a.iterations, device=a.device, anchors=file_anchors)
    result = json.dumps(out, separators=(",", ":"), ensure_ascii=False, allow_nan=False)
    if a.out:
        Path(a.out).write_text(result)
    else:
        print(result)
