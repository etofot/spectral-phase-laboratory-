"""Independent PCM measurement: 06_crest_by_band."""

from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from analyzers.cli import run

if __name__ == "__main__":
    run("06_crest_by_band")
