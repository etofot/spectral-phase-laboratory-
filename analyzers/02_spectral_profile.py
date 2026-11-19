"""Independent PCM measurement: 02_spectral_profile."""

from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from analyzers.cli import run

if __name__ == "__main__":
    run("02_spectral_profile")
