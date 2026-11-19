"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { Play, Square, Save, RotateCcw, Trash2, ChevronRight, Target, LoaderCircle, ThumbsUp, ThumbsDown } from "lucide-react";
import type { Anchor, AnchorMap, AnchorSet, LabReport } from "@/lib/lab-types";
import { anchorLimit, curveDb, emptyAnchors, frequency, roleOf, signed } from "@/lib/lab-types";
import { AnchorAudition, type AuditionSpec } from "./anchor-audio";

const W = 1000, H = 370, L = 48, R = 52, T = 30, B = 34, PW = W - L - R, PH = H - T - B;
const FREQS = [20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000];
const AVOID = "#e3a361";
type Kind = "prefer" | "avoid";
type Sel = { kind: Kind; index: number } | null;
const octaves = (q: number) => (2 / Math.LN2) * Math.asinh(1 / (2 * q));
const norm = (a?: AnchorSet): AnchorSet => ({ prefer: a?.prefer ?? [], avoid: a?.avoid ?? [] });
const same = (a?: AnchorSet, b?: AnchorSet) => JSON.stringify(norm(a)) === JSON.stringify(norm(b));
const xf = (f: number) => L + (Math.log(f / 20) / Math.log(1000)) * PW;
const ff = (x: number) => 20 * 1000 ** ((x - L) / PW);
const sy = (db: number) => T + (-db / 90) * PH;
const ey = (gain: number) => T + ((12 - gain) / 30) * PH; // +12 … −18 dB EQ scale
const gy = (y: number) => Math.min(12, Math.max(-18, 12 - ((y - T) / PH) * 30));

export default function AnchorInstructor({ report: r, initialId, anchors, onSave, onDone }: {
  report: LabReport;
  initialId: string;
  anchors: AnchorMap;
  onSave: (id: string, set: AnchorSet) => Promise<void>;
  onDone: () => void;
}) {
  const [selected, setSelected] = useState(initialId);
  const [drafts, setDrafts] = useState<AnchorMap>(anchors);
  const [saved, setSaved] = useState<AnchorMap>(anchors);
  const [active, setActive] = useState<Sel>(null);
  const dragRef = useRef<{ sel: NonNullable<Sel>; pointer: number } | null>(null);
  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(false);
  const [live, setLive] = useState<number[] | null>(null);
  const [seconds, setSeconds] = useState(0);
  const [context, setContext] = useState<"solo" | "mix">("solo");
  const [bypass, setBypass] = useState(false);
  const [compensate, setCompensate] = useState(true);
  const [loopLength, setLoopLength] = useState(Math.min(6, r.duration));
  const [loopStart, setLoopStart] = useState(0);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [discard, setDiscard] = useState(false);
  const engine = useRef<AnchorAudition | null>(null);
  const specRef = useRef<AuditionSpec | null>(null);
  const ch = r.channels.find((c) => c.id === selected) ?? r.channels[0];
  const role = roleOf(ch), color = ch.color;
  const limits = { prefer: anchorLimit(role, "prefer"), avoid: anchorLimit(role, "avoid") };
  const set = useMemo(() => norm(drafts[ch.id]), [drafts, ch.id]);
  const points = useMemo(() => [...set.prefer, ...set.avoid], [set]);
  const dirty = !same(set, saved[ch.id]);
  const unsavedAny = r.channels.some((c) => !same(drafts[c.id], saved[c.id]));
  const savedAny = r.channels.some((c) => !same(saved[c.id], anchors[c.id]));
  const anySolo = r.channels.some((c) => c.solo);
  const loopOptions = [...new Set([4, 6, 8, 10, r.duration].map((n) => Math.min(n, r.duration)))].sort((a, b) => a - b);

  const compensation = useMemo(() => {
    const s = r.trackInfo[ch.id]?.spectrum;
    if (!compensate || !points.length || !s) return 0;
    let weighted = 0, energy = 0;
    s.forEach((d, i) => { const p = 10 ** (d / 10); energy += p; weighted += p * 10 ** (curveDb(20 * 1000 ** (i / (s.length - 1)), points) / 10); });
    return energy ? -10 * Math.log10(weighted / energy) : 0;
  }, [compensate, points, r.trackInfo, ch.id]);
  const spec: AuditionSpec = {
    take: r.key, focus: ch.id, points, bypass, compensationDb: compensation,
    context: context === "mix" ? r.channels.filter((c) => !c.muted && (!anySolo || c.solo)).map((c) => c.id) : [],
    loopStart, loopLength,
  };
  useEffect(() => { specRef.current = spec; });
  useEffect(() => {
    const e = new AnchorAudition();
    engine.current = e;
    e.onChange = setPlaying;
    return () => { e.dispose(); engine.current = null; };
  }, []);
  useEffect(() => { engine.current?.update(points, bypass, compensation); }, [points, bypass, compensation]);
  useEffect(() => {
    const e = engine.current;
    if (e?.playing && specRef.current) { setLoading(true); e.play(specRef.current).catch((err) => setMessage((err as Error).message)).finally(() => setLoading(false)); }
  }, [ch.id, context, loopStart, loopLength, r.key]);
  useEffect(() => {
    if (!playing) return;
    let raf = 0, last = 0;
    const tick = (t: number) => {
      if (t - last > 80) { last = t; setLive(engine.current?.spectrum() ?? null); setSeconds(engine.current?.seconds ?? 0); }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing]);

  const curve = useMemo(() => Array.from({ length: 320 }, (_, i) => { const f = 20 * 1000 ** (i / 319); return `${xf(f).toFixed(1)},${ey(curveDb(f, points)).toFixed(1)}`; }).join(" L"), [points]);
  const trace = r.trackInfo[ch.id]?.peakSpectrum ?? r.trackInfo[ch.id]?.spectrum ?? [];
  const tracePath = trace.map((d, i) => `${i ? "L" : "M"}${xf(20 * 1000 ** (i / (trace.length - 1))).toFixed(1)},${sy(Math.max(-90, d)).toFixed(1)}`).join(" ");
  const livePath = playing && live ? live.map((d, i) => `${i ? "L" : "M"}${xf(20 * 1000 ** (i / (live.length - 1))).toFixed(1)},${sy(Math.max(-90, d)).toFixed(1)}`).join(" ") : "";

  async function togglePlay() {
    const e = engine.current;
    if (!e) return;
    if (e.playing) { e.stop(); setLoading(false); return; }
    setMessage(""); setLoading(true);
    try { await e.play(spec); } catch (err) { setMessage((err as Error).message); } finally { setLoading(false); }
  }
  const at = (e: React.MouseEvent<SVGSVGElement>) => {
    const svg = e.currentTarget;
    const matrix = svg.getScreenCTM();
    if (matrix) { const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(matrix.inverse()); return { x: p.x, y: p.y }; }
    const b = svg.getBoundingClientRect();
    return { x: (e.clientX - b.left) / b.width * W, y: (e.clientY - b.top) / b.height * H };
  };
  function hit(x: number, y: number): Sel {
    const radius = Math.max(20, 28 * W / Math.max(320, window.innerWidth));
    for (const kind of ["prefer", "avoid"] as Kind[]) {
      const i = set[kind].findIndex((p) => Math.hypot(xf(p.freq) - x, ey(p.gain) - y) < radius);
      if (i >= 0) return { kind, index: i };
    }
    return null;
  }
  function mutate(kind: Kind, fn: (p: Anchor[]) => Anchor[]) {
    setDrafts((d) => { const cur = norm(d[ch.id]); return { ...d, [ch.id]: { ...cur, [kind]: fn(cur[kind]) } }; });
  }
  function patch(sel: Sel, fn: (p: Anchor) => Anchor) { if (sel) mutate(sel.kind, (ps) => ps.map((p, i) => (i === sel.index ? fn(p) : p))); }
  function remove(sel: Sel) { if (sel) { mutate(sel.kind, (ps) => ps.filter((_, i) => i !== sel.index)); setActive(null); } }
  const clampF = (f: number) => +Math.max(20, Math.min(20000, f)).toFixed(1);
  const clampG = (kind: Kind, g: number) => kind === "prefer" ? +Math.max(0, Math.min(12, g)).toFixed(1) : +Math.max(-18, Math.min(0, g)).toFixed(1);
  function down(e: React.PointerEvent<SVGSVGElement>) {
    const { x, y } = at(e);
    if (x < L || x > W - R || y < T || y > H - B) return;
    const h = hit(x, y);
    if (h) { setActive(h); dragRef.current = { sel: h, pointer: e.pointerId }; }
    else {
      const kind: Kind = gy(y) >= 0 ? "prefer" : "avoid";
      if (set[kind].length >= limits[kind]) {
        setMessage(kind === "prefer" ? (role === "sub" ? "У саба одна полезная частота. Перетащите её или удалите двойным щелчком." : "Уже две полезные частоты. Перетащите существующую или удалите её двойным щелчком.") : "Уже две нежелательные частоты. Перетащите существующую или удалите её двойным щелчком.");
        return;
      }
      const sel = { kind, index: set[kind].length };
      mutate(kind, (ps) => [...ps, { freq: clampF(ff(x)), gain: kind === "prefer" ? Math.max(3, clampG(kind, gy(y))) : Math.min(-3, clampG(kind, gy(y))), q: role === "sub" && kind === "prefer" ? 1.4 : 2 }]);
      setActive(sel); dragRef.current = { sel, pointer: e.pointerId };
    }
    setMessage("");
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* pointer was cancelled before capture */ }
  }
  function move(e: React.PointerEvent<SVGSVGElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointer !== e.pointerId) return;
    const { x, y } = at(e);
    patch(drag.sel, (p) => ({ ...p, freq: clampF(ff(x)), gain: clampG(drag.sel.kind, gy(y)) }));
  }
  function key(e: React.KeyboardEvent) {
    if (!active) return;
    const p = set[active.kind][active.index];
    if (!p) return;
    if (["Delete", "Backspace"].includes(e.key)) { e.preventDefault(); remove(active); return; }
    const k = active.kind;
    const map: Record<string, (p: Anchor) => Anchor> = {
      ArrowLeft: (p) => ({ ...p, freq: clampF(p.freq / 2 ** (1 / 48)) }), ArrowRight: (p) => ({ ...p, freq: clampF(p.freq * 2 ** (1 / 48)) }),
      ArrowUp: (p) => ({ ...p, gain: clampG(k, p.gain + 0.5) }), ArrowDown: (p) => ({ ...p, gain: clampG(k, p.gain - 0.5) }),
      "[": (p) => ({ ...p, q: Math.max(0.3, +(p.q / 1.12).toFixed(2)) }), "]": (p) => ({ ...p, q: Math.min(12, +(p.q * 1.12).toFixed(2)) }),
    };
    if (!map[e.key]) return;
    e.preventDefault();
    patch(active, map[e.key]);
  }
  async function save(next = false) {
    setSaving(true); setMessage("");
    try {
      await onSave(ch.id, set);
      const nextSaved = { ...saved, [ch.id]: set };
      setSaved(nextSaved);
      const otherUnsaved = r.channels.some((c) => c.id !== ch.id && !same(drafts[c.id], nextSaved[c.id]));
      if (next) { const i = r.channels.findIndex((c) => c.id === ch.id); setSelected(r.channels[(i + 1) % r.channels.length].id); setActive(null); }
      else if (!otherUnsaved) { engine.current?.stop(); onDone(); }
    } catch (e) { setMessage((e as Error).message); } finally { setSaving(false); }
  }
  function done() { engine.current?.stop(); if (unsavedAny) setDiscard(true); else onDone(); }
  const sel = active ? set[active.kind][active.index] : undefined;
  const bandCard = (kind: Kind, i: number) => {
    const p = set[kind][i], isActive = active?.kind === kind && active.index === i, tint = kind === "prefer" ? color : AVOID;
    return (
      <div key={`${kind}${i}`} className={`instructor-band ${kind} ${isActive ? "active" : ""}`} onClick={() => p && setActive({ kind, index: i })}>
        <b style={{ color: tint }}>{kind === "prefer" ? <ThumbsUp size={11} /> : <ThumbsDown size={11} />}{kind === "prefer" ? "GOOD" : "BAD"} {i + 1}</b>
        {p ? (
          <>
            <label>Частота<input aria-label={`${kind === "prefer" ? "Полезная" : "Нежелательная"} частота ${i + 1}`} type="number" min="20" max="20000" step="1" value={p.freq} onChange={(e) => patch({ kind, index: i }, (v) => ({ ...v, freq: clampF(+e.target.value) }))} /><small>Hz</small></label>
            <label>Gain<input aria-label={`Усиление ${kind} ${i + 1}`} type="number" min={kind === "prefer" ? 0 : -18} max={kind === "prefer" ? 12 : 0} step="0.1" value={p.gain} onChange={(e) => patch({ kind, index: i }, (v) => ({ ...v, gain: clampG(kind, +e.target.value) }))} /><small>dB</small></label>
            <label>Q<input aria-label={`Q ${kind} ${i + 1}`} type="number" min="0.3" max="12" step="0.05" value={p.q} onChange={(e) => patch({ kind, index: i }, (v) => ({ ...v, q: Math.max(0.3, Math.min(12, +e.target.value)) }))} /><small>{octaves(p.q).toFixed(2)} oct</small></label>
            <button className="icon-btn compact" aria-label={`Удалить ${kind} ${i + 1}`} onClick={(e) => { e.stopPropagation(); remove({ kind, index: i }); }}><Trash2 size={13} /></button>
          </>
        ) : (
          <button className="empty-band" onClick={() => { mutate(kind, (ps) => [...ps, { freq: kind === "prefer" ? (i ? 2500 : 800) : (i ? 3200 : 250), gain: kind === "prefer" ? 4 : -5, q: 2 }]); setActive({ kind, index: i }); }}>+ {kind === "prefer" ? "полезная" : "нежелательная"} частота</button>
        )}
      </div>
    );
  };

  return (
    <div className="instructor">
      <div className="instructor-intro"><Target size={16} /><p>Поднимите <b style={{ color }}>полезные</b> частоты и опустите <b style={{ color: AVOID }}>нежелательные</b>. EQ слышен только здесь и <b>не меняет звук в сессии</b>: система использует точки как приоритеты при разрешении конфликтов.</p><span className="micro-tag">GOOD 2 · BAD 2</span></div>
      <div className="instructor-tracks">{r.channels.map((c) => {
        const d = norm(drafts[c.id]), unsaved = !same(drafts[c.id], saved[c.id]);
        return <button key={c.id} className={c.id === ch.id ? "active" : ""} aria-pressed={c.id === ch.id} onClick={() => { setSelected(c.id); setActive(null); setMessage(""); }}><i className="dot" style={{ background: c.color }} />{c.name}<small><span style={{ color: c.color }}>▲{d.prefer.length}</span> <span style={{ color: AVOID }}>▼{d.avoid.length}</span></small>{unsaved && <em>•</em>}</button>;
      })}</div>
      <div className="instructor-toolbar">
        <button className={`instructor-play ${playing ? "playing" : ""}`} onClick={togglePlay} disabled={loading}>{loading ? <LoaderCircle size={15} className="spin" /> : playing ? <Square size={13} fill="currentColor" /> : <Play size={14} fill="currentColor" />}{loading ? "Подготовка…" : playing ? "Стоп" : "Play · цикл"}</button>
        <div className="view-tabs">{(["solo", "mix"] as const).map((m) => <button key={m} className={context === m ? "active" : ""} onClick={() => setContext(m)}>{m === "solo" ? "Соло" : "В миксе"}</button>)}</div>
        <button className={`chip-toggle ${bypass ? "warn" : ""}`} onClick={() => setBypass(!bypass)} aria-pressed={bypass}>{bypass ? "EQ: обход" : "EQ: вкл"}</button>
        <label className="comp-toggle"><input type="checkbox" checked={compensate} onChange={(e) => setCompensate(e.target.checked)} />Ровная громкость {points.length && compensate ? signed(compensation) + " dB" : ""}</label>
        <span className="instructor-position" data-playing={playing} data-position={seconds.toFixed(3)}>{playing ? `● LIVE ${seconds.toFixed(2)} s` : "○ STOP"}</span>
      </div>
      <div className="loop-strip">
        <label>Длина цикла<select aria-label="Длина цикла" value={loopLength} onChange={(e) => { const n = +e.target.value; setLoopLength(n); setLoopStart((s) => Math.min(s, Math.max(0, r.duration - n))); }}>{loopOptions.map((n) => <option key={n} value={n}>{n.toFixed(1)} s</option>)}</select></label>
        <label className="loop-range">Начало <b>{loopStart.toFixed(2)} s</b><input aria-label="Начало цикла" type="range" min="0" max={Math.max(0, r.duration - loopLength)} step="0.01" value={Math.min(loopStart, Math.max(0, r.duration - loopLength))} onChange={(e) => setLoopStart(+e.target.value)} /></label>
        <span>{loopStart.toFixed(2)} — {Math.min(r.duration, loopStart + loopLength).toFixed(2)} s · crossfade 20 ms</span>
      </div>
      <div className="instructor-plot" style={{ "--ch": color } as React.CSSProperties}>
        <svg viewBox={`0 0 ${W} ${H}`} role="img" tabIndex={0} aria-label="Параметрический эквалайзер: верхняя половина — полезные частоты, нижняя — нежелательные" onKeyDown={key}
          onWheel={(e) => { if (!active || !sel) return; e.preventDefault(); patch(active, (p) => ({ ...p, q: +Math.max(0.3, Math.min(12, p.q * (e.deltaY < 0 ? 1.12 : 1 / 1.12))).toFixed(2) })); }}
          onPointerDown={down} onPointerMove={move}
          onPointerUp={(e) => { if (dragRef.current?.pointer === e.pointerId) dragRef.current = null; if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId); }}
          onPointerCancel={() => { dragRef.current = null; }} onLostPointerCapture={() => { dragRef.current = null; }} onDoubleClick={(e) => { const { x, y } = at(e); remove(hit(x, y)); }}>
          <defs>
            <linearGradient id="eq-fill-good" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor={color} stopOpacity=".28" /><stop offset="1" stopColor={color} stopOpacity=".02" /></linearGradient>
            <linearGradient id="eq-fill-bad" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor={AVOID} stopOpacity=".02" /><stop offset="1" stopColor={AVOID} stopOpacity=".3" /></linearGradient>
            <clipPath id="clip-good"><rect x={L} y={T} width={PW} height={ey(0) - T} /></clipPath>
            <clipPath id="clip-bad"><rect x={L} y={ey(0)} width={PW} height={H - B - ey(0)} /></clipPath>
          </defs>
          <rect x={L} y={ey(0)} width={PW} height={H - B - ey(0)} fill={AVOID} opacity=".035" />
          <g className="eq-grid">{FREQS.map((f) => <g key={f}><line x1={xf(f)} x2={xf(f)} y1={T} y2={H - B} /><text x={xf(f)} y={H - 11} textAnchor="middle">{frequency(f)} Hz</text></g>)}{[0, -12, -24, -36, -48, -60, -72, -84].map((d) => <g key={d}><line x1={L} x2={W - R} y1={sy(d)} y2={sy(d)} /><text x={L - 9} y={sy(d) + 3} textAnchor="end">{d}</text></g>)}</g>
          {tracePath && <path d={tracePath} fill="none" stroke={color} strokeWidth="1.35" opacity=".5" />}
          {livePath && <path d={livePath} fill="none" stroke="#f2f8f5" strokeWidth="1.2" opacity=".8" />}
          <g className="eq-response">
            <line x1={L} x2={W - R} y1={ey(0)} y2={ey(0)} className="eq-zero" />
            {[12, 6, 0, -6, -12, -18].map((g) => <text key={g} x={W - R + 9} y={ey(g) + 3} fill={g < 0 ? AVOID : undefined}>{g > 0 ? "+" : ""}{g}</text>)}
            <text x={L + 6} y={T + 12} className="zone-label" fill={color}>▲ ПОЛЕЗНЫЕ</text>
            <text x={L + 6} y={H - B - 6} className="zone-label" fill={AVOID}>▼ НЕЖЕЛАТЕЛЬНЫЕ</text>
            {points.length > 0 && (
              <>
                <path clipPath="url(#clip-good)" d={`M${L},${ey(0)} L${curve} L${W - R},${ey(0)} Z`} fill="url(#eq-fill-good)" />
                <path clipPath="url(#clip-bad)" d={`M${L},${ey(0)} L${curve} L${W - R},${ey(0)} Z`} fill="url(#eq-fill-bad)" />
                <path d={`M${curve}`} fill="none" stroke="#e9f3ee" strokeWidth="3" strokeLinejoin="round" opacity=".92" />
              </>
            )}
            {(["prefer", "avoid"] as Kind[]).flatMap((kind) => set[kind].map((p, i) => {
              const isActive = active?.kind === kind && active.index === i, tint = kind === "prefer" ? color : AVOID;
              return <g key={`${kind}${i}`} className={`instructor-node ${kind}`} transform={`translate(${xf(p.freq)},${ey(p.gain)})`}>{isActive && <circle r="18" fill="none" stroke="#e8f6ef" strokeWidth="1.5" opacity=".7" />}{kind === "prefer" ? <circle r="12" fill={tint} stroke="#0b1210" strokeWidth="2" /> : <rect x="-11" y="-11" width="22" height="22" rx="4" fill={tint} stroke="#0b1210" strokeWidth="2" />}<text y="4" textAnchor="middle">{kind === "prefer" ? i + 1 : `−${i + 1}`}</text></g>;
            }))}
          </g>
          <text x={L - 9} y={T - 11} textAnchor="end" className="axis-caption">dBFS</text><text x={W - R + 9} y={T - 11} className="axis-caption">EQ dB</text>
        </svg>
        {!points.length && <div className="plot-empty">Щёлкните выше нулевой линии — полезная частота, ниже — нежелательная</div>}
      </div>
      <div className="instructor-band-grid">
        <div className="band-column">{Array.from({ length: limits.prefer }, (_, i) => bandCard("prefer", i))}</div>
        <div className="band-column">{Array.from({ length: limits.avoid }, (_, i) => bandCard("avoid", i))}</div>
      </div>
      <div className="instructor-help">Тяните узлы во время звука · колесо над графиком — Q · двойной щелчок — удалить · стрелки — точная настройка. Нежелательные полосы станут донорами при конфликтах: вырезы и фазовые правки лягут туда в первую очередь.</div>
      {message && <p className="error-note" role="alert">{message}</p>}
      <div className="instructor-footer">
        <button className="text-action" disabled={!points.length || saving} onClick={() => setDrafts((d) => ({ ...d, [ch.id]: emptyAnchors() }))}><RotateCcw size={12} />Очистить точки</button>
        <span>{dirty ? "Есть несохранённые изменения" : savedAny ? "Точки сохранены · нужен новый анализ" : "Изменений нет"}</span>
        <button className="btn secondary" onClick={done}>{unsavedAny ? "Закрыть" : "Готово"}<ChevronRight size={13} /></button>
        <button className="btn secondary" disabled={!dirty || saving} onClick={() => void save(true)}>Сохранить и следующий</button>
        <button className="btn primary" disabled={!dirty || saving} onClick={() => void save(false)}>{saving ? <LoaderCircle size={13} className="spin" /> : <Save size={13} />}Сохранить точки</button>
      </div>
      {discard && <div className="discard-banner"><p>Есть несохранённые изменения. Закрыть без сохранения?</p><button className="btn secondary" onClick={() => setDiscard(false)}>Вернуться</button><button className="btn primary" onClick={onDone}>Закрыть</button></div>}
    </div>
  );
}
