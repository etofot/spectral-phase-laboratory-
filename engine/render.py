"""Render a JSON processor command on an actual WAV; one compact JSON reply."""

import argparse
import json
import sys
from pathlib import Path
import numpy as np
import soundfile as sf
from .ultra_eq_engine import UltraEQEngine


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("source", type=Path)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--device", choices=["cpu", "cuda"], default="cpu")
    parser.add_argument("--command", type=Path, help="JSON file; defaults to stdin")
    args = parser.parse_args()
    command = (
        json.loads(args.command.read_text()) if args.command else json.load(sys.stdin)
    )
    x, sr = sf.read(args.source, always_2d=True)
    if args.output.resolve() == args.source.resolve():
        raise ValueError("Refusing to overwrite the input stem")
    y = UltraEQEngine(sr, args.device).process(x, command)
    if not np.isfinite(y).all():
        raise ValueError("Non-finite output; check parameters")
    args.output.parent.mkdir(parents=True, exist_ok=True)
    sf.write(args.output, y, sr, subtype="FLOAT")
    print(
        json.dumps(
            {
                "status": "rendered",
                "track": command.get("track", args.source.stem),
                "samples": len(y),
                "sample_rate": sr,
                "device": args.device,
                "output": str(args.output),
                "sample_peak_dbfs": round(
                    20 * float(np.log10(max(1e-12, np.max(np.abs(y))))), 3
                ),
            },
            separators=(",", ":"),
            allow_nan=False,
        )
    )


if __name__ == "__main__":
    main()
