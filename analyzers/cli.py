"""Shared strict JSON CLI for the twelve independent instrument entrypoints."""

import argparse, sys, json, hashlib, shutil, copy
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from engine.config import *
from .suite import load_track, measure
from .metrics import *


def run(module):
    p = argparse.ArgumentParser(description=module)
    p.add_argument("files", nargs="*", type=Path)
    p.add_argument("--out", type=Path)
    a = p.parse_args()
    states = []
    for f in a.files:
        if (
            f.stem in IDS
            and f.resolve() == (ROOT / "fixtures" / f"{f.stem}.wav").resolve()
        ):
            states.append(copy.deepcopy(DEFAULT[IDS.index(f.stem)]))
            continue
        k = "u_" + hashlib.sha256(f.read_bytes()).hexdigest()[:20]
        d = ROOT / ".lab-data" / "imports"
        d.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(f, d / (k + ".wav"))
        states.append(
            dict(
                id=k,
                name=f.stem,
                color=COLORS[len(states) % 4],
                gain=0,
                phase=0,
                bands=[],
                solo=False,
                muted=False,
            )
        )
    states = states or copy.deepcopy(DEFAULT)
    key = module.split("_")[0]
    if key.startswith("x"):
        report, _, _ = measure(states)
        parts = {
            "x01": report["pairs"],
            "x02": [
                {k: p[k] for k in ("a", "b", "hz", "coherence", "coherentBins")}
                for p in report["pairs"]
            ],
            "x03": report["masking"],
            "x04": report["lowEnd"],
            "x05": {
                "mix": report["stereo"],
                "overlaps": report["stereoCross"],
                "channels": {i: v["stereo"] for i, v in report["trackInfo"].items()},
            },
            "x06": {
                "mix_readiness_score": report["score"],
                "recommendations": report["issues"],
            },
        }
        data = parts[key]
    else:
        data = {}
        for s in states:
            x = load_track(s)
            if key == "01":
                result = loudness(x)
            elif key == "02":
                sp, _, _ = spectrum(x, 8192)
                result = {
                    k: sp[k] for k in ("thirdOctave", "peaks", "resolution", "centroid")
                }
            elif key == "03":
                result = envelope(x)
            elif key == "04":
                result = phase(x)
            elif key == "05":
                _, f, h = spectrum(x, 8192)
                result = harmonics(f, h)
            else:
                result = crest_bands(x)
            data[s["id"]] = result
    text = json.dumps(
        {"module": module, "sample_rate": SR, "duration_s": DURATION, "result": data},
        allow_nan=False,
        ensure_ascii=False,
        separators=(",", ":"),
    )
    if a.out:
        a.out.write_text(text)
    else:
        print(text)
