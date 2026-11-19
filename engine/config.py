from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SR = 48000
DURATION = 5  # minimum session length, seconds
MAX_SECONDS = 20  # longest analysed fragment per session
COLORS = ["#68dec3", "#a795f7", "#559af6", "#e6ad65"]
IDS = ["kick", "bass_guitar", "sub_synth", "lead_synth"]
NAMES = ["Kick", "Bass Guitar", "Sub Synth", "Lead Synth"]
ROLES = ["drums", "bass", "sub", "melodic", "vocal"]
DEFAULT = [
    dict(id=k, name=n, color=c, role=role, offset=0, gain=0, phase=0, bands=[], muted=False, solo=False)
    for k, n, c, role in zip(IDS, NAMES, COLORS, ["drums", "bass", "sub", "melodic"])
]
CENTERS = [20, 25, 31.5, 40, 50, 63, 80, 100, 125, 160, 200, 250, 315, 400, 500, 630, 800, 1000, 1250, 1600, 2000, 2500, 3150, 4000, 5000, 6300, 8000, 10000, 12500, 16000, 20000]
