"""Independent PCM measurement: x02_spectral_coherence."""

from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from analyzers.cli import run

if __name__ == "__main__":
    run("x02_spectral_coherence")
