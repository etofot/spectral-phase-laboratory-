"""Independent PCM measurement: 01_loudness_dynamics."""

from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from analyzers.cli import run

if __name__ == "__main__":
    run("01_loudness_dynamics")
