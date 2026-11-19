"""Independent PCM measurement: x04_low_end_pressure."""

from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from analyzers.cli import run

if __name__ == "__main__":
    run("x04_low_end_pressure")
