import copy, json
from pathlib import Path
import numpy as np
import soundfile as sf
import pytest
from engine.config import SR, ROOT, DEFAULT, IDS
from engine.ultra_eq_engine import UltraEQEngine, probe
from engine.spectral_sieve import sieve
from analyzers.metrics import loudness, correlation
from analyzers.suite import measure, load_track
from agent.agent_loop import run


@pytest.fixture(scope="module")
def baseline():
    return measure(DEFAULT)


def test_reference_files():
    for k in IDS:
        meta = sf.info(ROOT / "fixtures" / f"{k}.wav")
        assert (meta.samplerate, meta.frames, meta.channels, meta.subtype) == (
            48000,
            240000,
            2,
            "FLOAT",
        )


def test_measured_conflicts(baseline):
    r, _, _ = baseline
    core = [i for i in r["issues"] if i["type"] in ("phase", "resonance")]
    assert sorted((i["hz"], i["endHz"]) for i in core) == [
        (55, 55),
        (222, 222),
        (345, 347),
    ]
    assert {345, 346, 347}.issubset(
        {p["hz"] for p in r["trackInfo"]["lead_synth"]["peaks"]}
    )
    assert r["binHz"] == 5.859
    assert r["trackInfo"]["kick"]["resolution"] == 0.2
    assert r["meter"]["lra"] is None
    json.dumps(r, allow_nan=False)


def test_eq_is_not_a_double_gain():
    t = np.arange(SR * 2) / SR
    x = 0.3 * np.sin(2 * np.pi * 222 * t)
    x = np.column_stack([x, x])
    y = UltraEQEngine().process(x, {"cuts": [{"freq": 222, "gain_db": -6, "q": 18}]})
    assert abs(20 * np.log10(np.std(y[SR:]) / np.std(x[SR:])) + 6) < 0.02


def test_allpass_unity_magnitude():
    t = np.arange(SR) / SR
    x = np.stack([np.sin(2 * np.pi * 222 * t)] * 2, axis=1)
    y = UltraEQEngine().process(x, {"allpass": [{"freq": 222, "q": 2}]})
    assert np.std(y[SR // 2 :]) == pytest.approx(np.std(x[SR // 2 :]), rel=1e-5)


def test_sieve_identity():
    x = load_track(DEFAULT[2])
    assert np.max(abs(sieve(x, SR, []) - x)) < 1e-8


def test_xcorr_alignment():
    rng = np.random.default_rng(3)
    a = rng.normal(0, 0.1, (SR, 2))
    b = np.pad(a[:-63], ((63, 0), (0, 0)))
    s, d, lag = probe(a, b)
    assert lag == -63
    assert np.max(abs(d)) < 1e-10
    assert len(s) == SR - 63


def test_mute_and_solo():
    states = copy.deepcopy(DEFAULT)
    states[1]["solo"] = True
    r, w, y = measure(states, detail=False)
    assert np.allclose(y, w["bass_guitar"])
    assert not r["pairs"]
    states[1]["muted"] = True
    r, _, y = measure(states, detail=False)
    assert np.max(abs(y)) == 0 and r["score"] == 0 and r["meter"]["lufs"] is None
    json.dumps(r, allow_nan=False)


def test_loudness_tracks_gain(baseline):
    _, _, y = baseline
    assert loudness(y * 0.5, False)["lufs"] - loudness(y, False)[
        "lufs"
    ] == pytest.approx(-6.02, abs=0.03)


def test_agent_guardrails(baseline):
    original = copy.deepcopy(DEFAULT)
    result = run(DEFAULT)
    r = result["report"]
    assert DEFAULT == original
    assert r["score"] > baseline[0]["score"]
    assert r["meter"]["truePeak"] <= -1
    assert not [i for i in r["issues"] if i["type"] in ("phase", "resonance")]
    assert max(s["iteration"] for s in result["steps"]) <= 10
    assert all(
        s["after"] > s["before"] and s["peakAfter"] <= -1
        for s in result["steps"]
        if s["accepted"]
    )
    assert abs(r["meter"]["lufs"] - baseline[0]["meter"]["lufs"]) < 1.5
    folder = ROOT / ".lab-data" / "renders" / r["key"]
    mix, _ = sf.read(folder / "mix.wav")
    parts = [sf.read(folder / f"{k}.wav")[0] for k in IDS]
    assert np.allclose(sum(parts), mix, atol=1e-6)


def test_frequency_microscope(baseline):
    r = baseline[0]
    issue = next(i for i in r["issues"] if i["id"] == "resonance_lead_synth")
    z = issue["zoom"]
    assert z["resolution"] == 0.2
    y = np.array(z["lines"]["lead_synth"])
    f = np.array(z["freqs"])
    from scipy.signal import find_peaks

    i, _ = find_peaks(y, prominence=9)
    assert {345.0, 346.0, 347.0}.issubset(set(f[i]))


def test_wiener_consistency():
    from engine.spectral_sieve import wiener_stems

    rng = np.random.default_rng(55)
    v = rng.random((8, 32, 2, 2)) + 0.01
    x = rng.normal(size=(8, 32, 2)) + 1j * rng.normal(size=(8, 32, 2))
    y = wiener_stems(v, x, iterations=0)
    assert y.shape == (8, 32, 2, 2) and np.allclose(y.sum(axis=-1), x)


def test_anchor_protection_blocks_cuts():
    from analyzers.priorities import eq_at
    res = run(DEFAULT, anchors={"bass_guitar": [{"freq": 222, "gain": 6, "q": 4}]})  # legacy list form = prefer
    bass = next(s for s in res["report"]["channels"] if s["id"] == "bass_guitar")
    assert eq_at(bass["bands"], 222) > -1.0
    assert any(not s["accepted"] and "ориентир" in s["note"] for s in res["steps"])


def test_anchor_carving_and_sub_limit():
    anchors = {"lead_synth": [{"freq": 2400, "gain": 6, "q": 2}], "bass_guitar": [{"freq": 700, "gain": 5, "q": 2}], "sub_synth": [{"freq": 45, "gain": 4, "q": 2}, {"freq": 65, "gain": 3, "q": 2}]}
    first, _, _ = measure(DEFAULT, detail=False, anchors=anchors)
    assert first["priorities"]["total"] == 3 and len(first["anchors"]["sub_synth"]["prefer"]) == 1
    res = run(DEFAULT, anchors=anchors)
    after = res["report"]["priorities"]
    smr = lambda rep, k: next(x["smr"] for x in rep["rows"] if x["track"] == k)
    assert smr(after, "lead_synth") > smr(first["priorities"], "lead_synth") + 1
    assert smr(after, "bass_guitar") > smr(first["priorities"], "bass_guitar") + 1
    assert after["score"] > first["priorities"]["score"] and res["report"]["meter"]["truePeak"] <= -1
    # Anchors are targets, not processing: an anchor with no masker gets at most 60 % of its boost.
    for ch in res["report"]["channels"]:
        assert all(b["gain"] <= 6 for b in ch["bands"])


def test_anchor_clash_reported_without_command():
    r, _, _ = measure(DEFAULT, detail=False, anchors={"bass_guitar": [{"freq": 300, "gain": 4, "q": 2}], "lead_synth": [{"freq": 315, "gain": 4, "q": 2}]})
    clash = [i for i in r["issues"] if i["type"] == "clash"]
    assert len(clash) == 1 and clash[0]["command"] is None


def test_fragment_offset_and_session_length(tmp_path):
    import shutil
    from analyzers.suite import session_frames
    t = np.arange(SR * 12) / SR
    x = np.where(t < 6, 0, 0.2 * np.sin(2 * np.pi * 440 * t))
    k = "u_" + "a" * 20
    dest = ROOT / ".lab-data" / "imports"
    dest.mkdir(parents=True, exist_ok=True)
    sf.write(dest / f"{k}.wav", x, 44100 if False else SR, subtype="PCM_24")
    ch = dict(id=k, name="Гитара", color="#dd99c3", role="melodic", offset=6, gain=0, phase=0, bands=[], muted=False, solo=False)
    assert session_frames(DEFAULT + [ch]) == SR * 6
    y = load_track(ch, SR * 6)
    assert np.std(y[:SR]) > 0.1


def test_local_anchor_phase_band_changes_phase_not_gain():
    from engine.ultra_eq_engine import UltraEQEngine
    t = np.arange(SR * 2) / SR
    x = np.stack([0.2 * np.sin(2 * np.pi * 2000 * t)] * 2, axis=1)
    y = UltraEQEngine().process(x, {"phase_shift_deg": {"1779-2245Hz": 180}})
    assert correlation(x[SR // 2 :, 0], y[SR // 2 :, 0]) < -0.98
    assert np.std(y[SR // 2 :]) == pytest.approx(np.std(x[SR // 2 :]), rel=0.02)


def test_anchor_phase_conflict_is_detected_and_corrected():
    dest = ROOT / ".lab-data" / "imports"
    dest.mkdir(parents=True, exist_ok=True)
    t = np.arange(SR * 5) / SR
    sine = 0.2 * np.sin(2 * np.pi * 2000 * t)
    ids = ["u_" + "b" * 20, "u_" + "c" * 20]
    sf.write(dest / f"{ids[0]}.wav", sine, SR, subtype="FLOAT")
    sf.write(dest / f"{ids[1]}.wav", -sine, SR, subtype="FLOAT")
    states = [dict(id=k, name=f"Vocal {i}", color="#dd99c3", role="vocal", offset=0, gain=0, phase=0, bands=[], phaseBands=[], muted=False, solo=False) for i, k in enumerate(ids)]
    anchors = {ids[0]: [{"freq": 2000, "gain": 5, "q": 2}]}
    before, _, mix = measure(states, detail=False, anchors=anchors)
    assert np.max(np.abs(mix)) < 1e-8
    assert any(i["id"].startswith("anchor_phase") for i in before["issues"])
    result = run(states, max_iter=2, budget_s=90, anchors=anchors)
    accepted = [s for s in result["steps"] if s["accepted"] and s["issue"].startswith("anchor_phase")]
    assert accepted
    corrected = next(s for s in result["report"]["channels"] if s["id"] == ids[1])
    assert corrected.get("phaseBands")


def test_legacy_anchor_lists_still_mean_prefer():
    from analyzers.priorities import clean
    out = clean({"lead_synth": [{"freq": 1000, "gain": 5, "q": 2}]}, DEFAULT)
    assert out["lead_synth"]["prefer"][0]["freq"] == 1000 and out["lead_synth"]["avoid"] == []
    both = clean({"sub_synth": {"prefer": [{"freq": 45, "gain": 4, "q": 2}, {"freq": 60, "gain": 4, "q": 2}], "avoid": [{"freq": 300, "gain": -6, "q": 2}, {"freq": 900, "gain": 4, "q": 2}, {"freq": 2000, "gain": -3, "q": 2}]}}, DEFAULT)
    assert len(both["sub_synth"]["prefer"]) == 1 and len(both["sub_synth"]["avoid"]) == 2
    assert both["sub_synth"]["avoid"][1]["gain"] == 0  # avoid gains are clamped to <= 0


def test_avoid_band_becomes_the_donor():
    """Lead prefers 1 kHz, bass dislikes 1 kHz: every cut in that zone must land on the bass."""
    anchors = {"lead_synth": {"prefer": [{"freq": 1000, "gain": 5, "q": 2}], "avoid": [{"freq": 200, "gain": -6, "q": 2}]}, "bass_guitar": {"prefer": [{"freq": 200, "gain": 5, "q": 2}], "avoid": [{"freq": 1000, "gain": -6, "q": 2}]}}
    first, _, _ = measure(DEFAULT, detail=False, anchors=anchors)
    assert {(p["keep"], p["give"]) for p in first["priorities"]["plan"]} == {("lead_synth", "bass_guitar"), ("bass_guitar", "lead_synth")}
    assert any(i["type"] == "avoid" and i["command"]["track"] == "bass_guitar" for i in first["issues"])
    res = run(DEFAULT, anchors=anchors)
    lead = next(c for c in res["report"]["channels"] if c["id"] == "lead_synth")
    bass = next(c for c in res["report"]["channels"] if c["id"] == "bass_guitar")
    from analyzers.priorities import eq_at
    assert eq_at(lead["bands"], 1000) > -1.0, "the preferred band of the lead must stay intact"
    assert eq_at(bass["bands"], 1000) <= -2.0, "the disliked band of the bass is where the cut lands"
    assert eq_at(bass["bands"], 200) > -1.0
    rows = res["report"]["priorities"]
    assert all(x["clear"] for x in rows["rows"]) and all(x["settled"] for x in rows["avoidRows"])
    assert res["report"]["meter"]["truePeak"] <= -1


def test_avoid_band_hosts_the_phase_correction():
    dest = ROOT / ".lab-data" / "imports"
    dest.mkdir(parents=True, exist_ok=True)
    t = np.arange(SR * 5) / SR
    sine = 0.2 * np.sin(2 * np.pi * 1500 * t)
    ids = ["u_" + "d" * 20, "u_" + "e" * 20]
    sf.write(dest / f"{ids[0]}.wav", sine, SR, subtype="FLOAT")
    sf.write(dest / f"{ids[1]}.wav", -sine, SR, subtype="FLOAT")
    states = [dict(id=k, name=n, color="#dd99c3", role="vocal", offset=0, gain=0, phase=0, bands=[], phaseBands=[], muted=False, solo=False) for k, n in zip(ids, ["Voice", "Synth"])]
    anchors = {ids[1]: {"prefer": [], "avoid": [{"freq": 1500, "gain": -6, "q": 2}]}}
    before, _, _ = measure(states, detail=False, anchors=anchors)
    issue = next(i for i in before["issues"] if i["id"].startswith("avoid_phase"))
    assert issue["command"]["track"] == ids[1], "the phase move is written into the disliked stem"
    res = run(states, max_iter=2, budget_s=90, anchors=anchors)
    assert any(s["accepted"] and s["issue"].startswith("avoid_phase") for s in res["steps"])
    voice = next(c for c in res["report"]["channels"] if c["id"] == ids[0])
    assert not voice.get("phaseBands") and not voice["bands"], "the partner stays untouched"


def test_disabled_dynamic_block_does_not_change_the_mix():
    plain, wavs, mix = measure(DEFAULT, detail=False)
    same, wavs2, mix2 = measure(DEFAULT, detail=False, extensions={"dynamic": False, "depth": 1, "ms": True})
    assert plain["score"] == same["score"] and np.allclose(mix, mix2)
    assert same["dynamic"]["enabled"] is False and "msReport" in same


def test_dynamic_phase_eq_follows_the_leader():
    from engine.dynamic_phase_eq import apply
    t = np.arange(SR * 2) / SR
    tone = 0.2 * np.sin(2 * np.pi * 1000 * t)
    leader = np.where((t % 0.5) < 0.12, tone, 0.0)
    wavs = {"vocal": np.column_stack([leader, leader]), "synth": np.column_stack([tone, tone])}
    states = [dict(id="vocal", role="vocal", name="Voice"), dict(id="synth", role="melodic", name="Synth")]
    anchors = {"vocal": {"prefer": [{"freq": 1000, "gain": 5, "q": 2}], "avoid": []}, "synth": {"prefer": [], "avoid": [{"freq": 1000, "gain": -6, "q": 2}]}}
    out, moves = apply(wavs, states, anchors, SR, depth=0.8)
    y = out["synth"][:, 0]
    burst, gap = np.mean(y[(t % 0.5) < 0.12] ** 2), np.mean(y[(t % 0.5) > 0.3] ** 2)
    assert burst < gap * 0.25, "follower yields only while the leader is present"
    assert gap == pytest.approx(np.mean(tone[(t % 0.5) > 0.3] ** 2), rel=0.08)
    assert moves and moves[0]["leader"] == "vocal" and moves[0]["follower"] == "synth"
    # The block can be bypassed exactly.
    bypass, _ = apply(wavs, states, anchors, SR, depth=0)
    assert np.allclose(bypass["synth"], wavs["synth"])


def test_empty_session_can_be_rendered_and_refilled():
    from analyzers.suite import save_take
    r = save_take([], 8192)
    assert r["channels"] == [] and r["score"] == 0 and r["meter"]["lufs"] is None
    assert r["key"] and (ROOT / ".lab-data" / "renders" / r["key"] / "mix.wav").exists()


def test_raw_baseline_ignores_processing_without_altering_inputs():
    from analyzers.suite import save_take
    states = copy.deepcopy(DEFAULT)
    states[0]["gain"] = -8
    states[0]["bands"] = [{"freq": 55, "gain": -9, "q": 4}]
    baseline = save_take(states, raw=True)
    processed = save_take(states)
    assert baseline["renderMode"] == "raw" and baseline["key"] != processed["key"]
    assert states[0]["gain"] == -8 and states[0]["bands"]
    assert baseline["channels"][0]["gain"] == 0 and baseline["channels"][0]["bands"] == []
    assert baseline["meter"]["lufs"] > processed["meter"]["lufs"]


def test_stereo_l_r_mid_side_measurements_preserve_separation():
    from analyzers.suite import save_take
    t = np.arange(SR * 5) / SR
    left = .17 * np.sin(2 * np.pi * 550 * t)
    right = .12 * np.sin(2 * np.pi * 2100 * t)
    stereo = np.column_stack([left, right])
    dest = ROOT / ".lab-data" / "imports"
    dest.mkdir(parents=True, exist_ok=True)
    k = "u_" + "f" * 20
    sf.write(dest / f"{k}.wav", stereo, SR, subtype="FLOAT")
    st = dict(id=k, name="Stereo guitar", color="#dd99c3", role="melodic", offset=0, gain=0, phase=0, bands=[], muted=False, solo=False)
    r = save_take([st], extensions={"dynamic":False,"depth":.55,"ms":True})
    d = r["trackInfo"][k]["domains"]
    assert d["left"]["active"] and d["right"]["active"] and d["side"]["active"]
    assert d["left"]["rmsDb"] != d["right"]["rmsDb"]
    li = np.argmax(d["left"]["spectrum"])
    ri = np.argmax(d["right"]["spectrum"])
    assert abs(li-ri) > 8, "different L/R fundamentals must remain separate"
    assert r["msReport"]["widths"][0]["sideDb"] > -40
    audio, _ = sf.read(ROOT / ".lab-data" / "renders" / r["key"] / f"{k}.wav")
    assert not np.allclose(audio[:,0], audio[:,1])
    assert r["trackInfo"][k]["domains"]["lrCorrelation"] < .1
