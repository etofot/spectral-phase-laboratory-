"""Independent PCM measurement: x01_phase_cancellation."""

from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from analyzers.cli import run

if __name__ == "__main__":
    run("x01_phase_cancellation")
