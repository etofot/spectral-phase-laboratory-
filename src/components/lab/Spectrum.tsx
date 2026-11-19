"use client";
import { useState, useEffect, useRef, useId, useMemo } from "react";
import { AudioLines, ChartNoAxesCombined, Grid2X2, Maximize2, Minimize2, ChevronDown, Crosshair, Target, Play, Square, Save, RotateCcw, Minus, Plus, Trash2 } from "lucide-react";
import type { LabReport, Issue, Anchor, AnchorMap, AnchorSet } from "@/lib/lab-types";
import { frequency, roleOf, anchorLimit, curveDb, signed } from "@/lib/lab-types";
import { AnchorAudition, type AuditionSpec } from "./anchor-audio";

const MINORS = [20, 25, 30, 35, 40, 45, 50, 60, 70, 80, 90, 100, 125, 150, 175, 200, 250, 300, 350, 400, 450, 500, 600, 700, 800, 900, 1000, 1250, 1500, 1750, 2000, 2500, 3000, 4000, 5000, 6000, 7000, 8000, 9000, 10000, 12500, 15000, 17500, 20000];
const ZONES = [{ n: "SUB", a: 20, b: 60 }, { n: "BASS", a: 60, b: 250 }, { n: "LOW MID", a: 250, b: 500 }, { n: "MID", a: 500, b: 2000 }, { n: "HIGH MID", a: 2000, b: 6000 }, { n: "AIR", a: 6000, b: 20000 }];
const RANGES: Record<string, [number, number]> = { full: [20, 20000], low: [20, 250], mid: [150, 2000], high: [1000, 20000] };
const TICKS: Record<string, number[]> = { full: [20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000], low: [20, 30, 50, 80, 100, 150, 200, 250], mid: [150, 200, 300, 500, 800, 1000, 1500, 2000], high: [1000, 2000, 3000, 5000, 8000, 10000, 15000, 20000] };
const octaves = (q: number) => (2 / Math.LN2) * Math.asinh(1 / (2 * q));
const same = (a: Anchor[] = [], b: Anchor[] = []) => JSON.stringify(a) === JSON.stringify(b);

function Heatmap({ values, duration }: { values: number[][]; duration: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const ctx = ref.current?.getContext("2d");
    if (!ctx || !values.length) return;
    const w = values.length, h = values[0].length, img = ctx.createImageData(w, h);
    const stops = [[8, 15, 20], [20, 43, 64], [37, 100, 113], [73, 172, 147], [217, 205, 115], [255, 178, 84]];
    for (let x = 0; x < w; x++)
      for (let y = 0; y < h; y++) {
        const t = values[x][h - y - 1] / 255, i = 4 * (y * w + x), k = Math.min(4, Math.floor(t * 5)), a = t * 5 - k;
        for (let c = 0; c < 3; c++) img.data[i + c] = stops[k][c] * (1 - a) + stops[k + 1][c] * a;
        img.data[i + 3] = 255;
      }
    ctx.putImageData(img, 0, 0);
  }, [values]);
  return (
    <div className="heatmap-wrap">
      <canvas ref={ref} width={values.length} height={values[0]?.length || 68} />
      <div className="heat-y"><span>20 kHz</span><span>5 kHz</span><span>1 kHz</span><span>200 Hz</span><span>20 Hz</span></div>
      <div className="heat-x">{[0, 0.2, 0.4, 0.6, 0.8, 1].map((t) => <span key={t}>{(t * duration).toFixed(1)} s</span>)}</div>
    </div>
  );
}

type Props = {
  report: LabReport; selected: string; onSelect: (id: string) => void; onFft: (fft: number) => void; onIssue: (i: Issue) => void; onFrequency: (f: number) => void; busy: boolean;
  liveSpectrum?: number[]; anchors: AnchorMap; onSaveAnchors: (id: string, set: AnchorSet) => Promise<void>;
};

const preferMap = (m: AnchorMap): Record<string, Anchor[]> => Object.fromEntries(Object.entries(m).map(([k, v]) => [k, v.prefer]));
export default function Spectrum({ report: r, selected, onSelect, onFft, onIssue, onFrequency, busy, liveSpectrum, anchors: anchorSets, onSaveAnchors }: Props) {
  const anchors = useMemo(() => preferMap(anchorSets), [anchorSets]);
  const [peakHold, setPeakHold] = useState(true);
  const [mode, setMode] = useState<"spectrum" | "heat">("spectrum");
  const [full, setFull] = useState(false);
  const [hidden, setHidden] = useState<string[]>([]);
  const [hover, setHover] = useState<{ x: number; y: number } | null>(null);
  const [range, setRange] = useState("full");
  const [tool, setTool] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, Anchor[]>>(anchors);
  const [active, setActive] = useState<number | null>(null);
  const [playing, setPlaying] = useState(false);
  const [context, setContext] = useState<"solo" | "mix">("solo");
  const [bypass, setBypass] = useState(false);
  const [compensate, setCompensate] = useState(true);
  const [focusLive, setFocusLive] = useState<number[] | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const host = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ index: number; pointer: number } | null>(null);
  const engine = useRef<AnchorAudition | null>(null);
  const specRef = useRef<AuditionSpec | null>(null);
  const [size, setSize] = useState({ w: 800, h: 250 });
  const uid = useId().replace(/:/g, "");

  const focusCh = r.channels.find((c) => c.id === selected) ?? r.channels[0];
  const role = roleOf(focusCh), limit = anchorLimit(role);
  const points = useMemo(() => drafts[focusCh.id] ?? [], [drafts, focusCh.id]);
  const saved = anchors[focusCh.id] ?? [];
  const dirty = !same(points, saved);
  const dirtyAny = r.channels.some((c) => !same(drafts[c.id], anchors[c.id]));
  const anySolo = r.channels.some((c) => c.solo);
  const compensation = useMemo(() => {
    const s = r.trackInfo[focusCh.id]?.spectrum;
    if (!compensate || !points.length || !s) return 0;
    let num = 0, den = 0; // energy-weighted EQ gain over this instrument's own spectrum
    s.forEach((d, i) => { const p = 10 ** (d / 10); den += p; num += p * 10 ** (curveDb(20 * 1000 ** (i / (s.length - 1)), points) / 10); });
    return den > 0 ? -10 * Math.log10(num / den) : 0;
  }, [compensate, points, r.trackInfo, focusCh.id]);
  const spec: AuditionSpec = { take: r.key, focus: focusCh.id, context: context === "mix" ? r.channels.filter((c) => !c.muted && (!anySolo || c.solo)).map((c) => c.id) : [], points, bypass, compensationDb: compensation };
  useEffect(() => { specRef.current = spec; });

  useEffect(() => {
    const e = new AnchorAudition();
    e.onChange = setPlaying;
    engine.current = e;
    const yieldToMedia = (ev: Event) => ev.target instanceof HTMLAudioElement && e.stop();
    document.addEventListener("play", yieldToMedia, true);
    return () => { document.removeEventListener("play", yieldToMedia, true); e.dispose(); };
  }, []);
  useEffect(() => { engine.current?.update(points, bypass, compensation); }, [points, bypass, compensation]);
  useEffect(() => {
    const e = engine.current;
    if (e?.playing && specRef.current) e.play(specRef.current).catch(() => setMessage("Не удалось загрузить стем для прослушивания"));
  }, [focusCh.id, context, r.key]);
  useEffect(() => {
    if (!playing) return;
    let raf = 0, last = 0;
    const tick = (t: number) => { if (t - last > 90) { last = t; setFocusLive(engine.current?.spectrum() ?? null); } raf = requestAnimationFrame(tick); };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing]);
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setSize({ w: e.contentRect.width, h: e.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, [mode, full, tool]);
  useEffect(() => {
    if (!full) return;
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setFull(false);
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [full]);
  useEffect(() => {
    const el = host.current;
    if (!el || !tool) return;
    const wheel = (e: WheelEvent) => {
      if (active == null) return;
      e.preventDefault();
      setDrafts((d) => ({ ...d, [focusCh.id]: (d[focusCh.id] ?? []).map((p, j) => (j === active ? { ...p, q: +Math.min(12, Math.max(0.3, p.q * (e.deltaY < 0 ? 1.12 : 1 / 1.12))).toFixed(2) } : p)) }));
    };
    el.addEventListener("wheel", wheel, { passive: false });
    return () => el.removeEventListener("wheel", wheel);
  }, [tool, active, focusCh.id]);

  const { w, h } = size;
  const l = 35, rt = 14, top = 24, bt = 23, pw = Math.max(10, w - l - rt), ph = Math.max(10, h - top - bt);
  const limits = RANGES[range], markers = TICKS[range];
  const xf = (f: number) => l + (Math.log(f / limits[0]) / Math.log(limits[1] / limits[0])) * pw;
  const ff = (x: number) => limits[0] * (limits[1] / limits[0]) ** ((x - l) / pw);
  const ceiling = peakHold ? 0 : -12, span = peakHold ? 84 : 72;
  const yf = (v: number) => top + ((ceiling - v) / span) * ph;
  const ys = peakHold ? [0, -12, -24, -36, -48, -60, -72, -84] : [-12, -24, -36, -48, -60, -72, -84];
  const eqBase = top + ph * 0.9, eqSpan = ph * 0.8;
  const ye = (g: number) => eqBase - (Math.max(0, Math.min(12, g)) / 12) * eqSpan;
  const gy = (y: number) => Math.min(12, Math.max(0, ((eqBase - y) / eqSpan) * 12));
  const clampF = (f: number) => { const v = Math.min(Math.min(20000, limits[1]), Math.max(Math.max(20, limits[0]), f)); return +v.toFixed(v < 100 ? 1 : 0); };
  const setPoints = (fn: (p: Anchor[]) => Anchor[]) => setDrafts((d) => ({ ...d, [focusCh.id]: fn(d[focusCh.id] ?? []) }));
  const at = (e: React.MouseEvent<SVGSVGElement>) => {
    const m = e.currentTarget.getScreenCTM();
    if (m) { const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse()); return { x: p.x, y: p.y }; }
    const b = e.currentTarget.getBoundingClientRect(); return { x: (e.clientX - b.left) / b.width * w, y: (e.clientY - b.top) / b.height * h };
  };
  const hit = (x: number, y: number) => points.findIndex((p) => Math.hypot(xf(p.freq) - x, ye(p.gain) - y) < 24);
  const trace = (id: string) => (peakHold ? r.trackInfo[id]?.peakSpectrum || r.trackInfo[id]?.spectrum : r.trackInfo[id]?.spectrum) ?? [];
  const line = (v: number[]) => v.map((d, i) => `${i ? "L" : "M"}${xf(20 * 1000 ** (i / (v.length - 1))).toFixed(1)},${Math.min(h - bt + 5, yf(d)).toFixed(1)}`).join(" ");

  function toggleTool() {
    if (tool) engine.current?.stop();
    setTool(!tool); setMode("spectrum"); setActive(null); setMessage("");
  }
  async function audition() {
    const e = engine.current;
    if (!e) return;
    if (e.playing) return e.stop();
    setMessage("");
    try { await e.play(spec); } catch { setMessage("Не удалось загрузить стем для прослушивания"); }
  }
  async function save() {
    setSaving(true);
    try { await onSaveAnchors(focusCh.id, { prefer: points, avoid: anchorSets[focusCh.id]?.avoid ?? [] }); setMessage(""); } catch (e) { setMessage((e as Error).message); } finally { setSaving(false); }
  }
  function down(e: React.PointerEvent<SVGSVGElement>) {
    if (!tool) return;
    const { x, y } = at(e);
    if (x < l || x > w - rt || y < top - 10 || y > h - bt) return;
    const i = hit(x, y);
    if (i >= 0) { dragRef.current = { index: i, pointer: e.pointerId }; setActive(i); }
    else if (points.length < limit) { dragRef.current = { index: points.length, pointer: e.pointerId }; setActive(points.length); setPoints((ps) => [...ps, { freq: clampF(ff(x)), gain: +Math.max(3, gy(y)).toFixed(1), q: role === "sub" ? 1.4 : 2 }]); }
    else { setMessage(role === "sub" ? "Для саба — одна опорная частота. Перетащите её или удалите двойным щелчком." : "Максимум две точки. Перетащите точку или удалите её двойным щелчком."); return; }
    setMessage("");
    e.currentTarget.setPointerCapture(e.pointerId);
  }
  function move(e: React.PointerEvent<SVGSVGElement>) {
    const p = at(e);
    setHover(p);
    const d = dragRef.current;
    if (d?.pointer === e.pointerId) setPoints((ps) => ps.map((pt, j) => (j === d.index ? { ...pt, freq: clampF(ff(p.x)), gain: +gy(p.y).toFixed(1) } : pt)));
  }
  function key(e: React.KeyboardEvent) {
    if (!tool || active == null || !points[active]) return;
    const nudge: Record<string, (p: Anchor) => Anchor> = {
      ArrowLeft: (p) => ({ ...p, freq: clampF(p.freq / 2 ** (1 / 48)) }), ArrowRight: (p) => ({ ...p, freq: clampF(p.freq * 2 ** (1 / 48)) }),
      ArrowUp: (p) => ({ ...p, gain: Math.min(12, +(p.gain + 0.5).toFixed(1)) }), ArrowDown: (p) => ({ ...p, gain: Math.max(0, +(p.gain - 0.5).toFixed(1)) }),
      "[": (p) => ({ ...p, q: Math.max(0.3, +(p.q / 1.12).toFixed(2)) }), "]": (p) => ({ ...p, q: Math.min(12, +(p.q * 1.12).toFixed(2)) }),
    };
    if (e.key === "Delete" || e.key === "Backspace") { e.preventDefault(); setPoints((ps) => ps.filter((_, j) => j !== active)); setActive(null); }
    else if (nudge[e.key]) { e.preventDefault(); setPoints((ps) => ps.map((p, j) => (j === active ? nudge[e.key](p) : p))); }
  }
  const sel = active != null ? points[active] : undefined;
  const qStep = (k: number) => active != null && setPoints((ps) => ps.map((p, j) => (j === active ? { ...p, q: +Math.min(12, Math.max(0.3, p.q * k)).toFixed(2) } : p)));

  return (
    <section className={`instrument spectrum-panel ${full ? "expanded-chart" : ""} ${tool ? "anchor-mode" : ""}`}>
      <div className="panel-heading">
        <div className="heading-text"><AudioLines /><h2>Спектральный анализ</h2></div>
        <div className="panel-tools">
          <button className={`anchor-toggle ${tool ? "on" : ""}`} aria-pressed={tool} onClick={toggleTool} title="Подбор частот-ориентиров на слух"><Target size={13} />Ориентиры{dirtyAny && <i className="dot amber" />}</button>
          <label className="fft-select">FFT <select aria-label="Размер FFT" value={r.fft} disabled={busy} onChange={(e) => onFft(+e.target.value)}>{[4096, 8192, 16384, 32768].map((n) => <option key={n} value={n}>{n}</option>)}</select><ChevronDown size={10} /></label>
          <button className="icon-btn compact" title={full ? "Свернуть" : "Развернуть спектр"} aria-label={full ? "Свернуть спектр" : "Развернуть спектр"} onClick={() => setFull(!full)}>{full ? <Minimize2 /> : <Maximize2 />}</button>
        </div>
      </div>
      {tool ? (
        <div className="plot-toolbar anchor-bar">
          <button className={`audition-btn ${playing ? "on" : ""}`} onClick={audition} aria-label={playing ? "Остановить прослушивание" : "Слушать инструмент"}>{playing ? <Square size={11} fill="currentColor" /> : <Play size={11} fill="currentColor" />}{playing ? "Стоп" : "Слушать"}</button>
          <div className="view-tabs">{(["solo", "mix"] as const).map((m) => <button key={m} className={context === m ? "active" : ""} onClick={() => setContext(m)}>{m === "solo" ? "Соло" : "В миксе"}</button>)}</div>
          <button className={`chip-toggle ${bypass ? "warn" : ""}`} aria-pressed={bypass} onClick={() => setBypass(!bypass)} title="Сравнить с исходным звучанием">{bypass ? "EQ: обход" : "EQ: вкл"}</button>
          <label className="comp-toggle" title="Выравнивает громкость, чтобы сравнивать тембр, а не уровень"><input type="checkbox" checked={compensate} onChange={(e) => setCompensate(e.target.checked)} />Компенсация {compensate && points.length ? `${signed(compensation)} dB` : ""}</label>
          <span className="plot-spec push">{role === "sub" ? "SUB · 1 ПОЛЕЗНАЯ" : "2 ПОЛЕЗНЫЕ"} · НЕЖЕЛАТЕЛЬНЫЕ — В ИНСТРУКТОРЕ (2× КЛИК ПО ДОРОЖКЕ)</span>
        </div>
      ) : (
        <div className="plot-toolbar">
          <div className="view-tabs">
            <button className={mode === "spectrum" ? "active" : ""} onClick={() => setMode("spectrum")}><ChartNoAxesCombined size={12} />Спектр</button>
            <button className={mode === "heat" ? "active" : ""} onClick={() => setMode("heat")}><Grid2X2 size={11} />Спектрограмма</button>
          </div>
          <div className="display-mode"><span className="plot-spec">HANN · Δf {r.binHz.toFixed(2)} Hz</span><button className={peakHold ? "hold-active" : ""} title="Переключить пиковый и усреднённый спектр" aria-pressed={peakHold} onClick={() => { setPeakHold(!peakHold); setMode("spectrum"); }}><i />{peakHold ? "PEAK HOLD" : "AVG · 1/12 OCT"}</button></div>
        </div>
      )}
      {mode === "heat" && !tool ? (
        <div className="plot-stage heat-stage"><Heatmap values={r.heatmap} duration={r.duration} /></div>
      ) : (
        <div className="plot-stage" ref={host}>
          <svg width="100%" height="100%" viewBox={`0 0 ${w} ${h}`} role="img" tabIndex={tool ? 0 : -1} onKeyDown={key}
            aria-label={tool ? "Редактор ориентиров: щелчок ставит точку, перетаскивание меняет частоту и подъём, колесо — ширину полосы" : "Спектр 20 Гц – 20 кГц. Нажмите, чтобы открыть EQ на выбранной частоте"}
            onPointerDown={down} onPointerMove={move} onPointerUp={(e) => { if (dragRef.current?.pointer === e.pointerId) dragRef.current = null; if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId); }} onPointerCancel={() => { dragRef.current = null; }} onLostPointerCapture={() => { dragRef.current = null; }} onPointerLeave={() => setHover(null)}
            onDoubleClick={(e) => { if (!tool) return; const { x, y } = at(e); const i = hit(x, y); if (i >= 0) { setPoints((ps) => ps.filter((_, j) => j !== i)); setActive(null); } }}
            onClick={(e) => { if (tool) return; const { x } = at(e); if (x >= l && x <= w - rt) onFrequency(Math.round(ff(x) * 10) / 10); }}>
            <defs>
              <clipPath id={`clip${uid}`}><rect x={l} y={top - 3} width={pw} height={ph + 3} /></clipPath>
              {r.channels.map((c) => <linearGradient key={c.id} id={`${uid}${c.id}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={c.color} stopOpacity=".24" /><stop offset="75%" stopColor={c.color} stopOpacity=".07" /><stop offset="100%" stopColor={c.color} stopOpacity=".012" /></linearGradient>)}
            </defs>
            <g className="plot-grid">
              {MINORS.filter((n) => n >= limits[0] && n <= limits[1]).map((n) => <line key={n} x1={xf(n)} x2={xf(n)} y1={top} y2={h - bt} stroke={markers.includes(n) ? "#2a3035" : "#1e2429"} strokeWidth={markers.includes(n) ? 0.85 : 0.6} />)}
              {ys.map((d) => <g key={d}><line x1={l} x2={w - rt} y1={yf(d)} y2={yf(d)} stroke="#2a3035" strokeWidth=".7" /><text x={l - 7} y={yf(d) + 3} textAnchor="end">{d}</text></g>)}
              {markers.filter((n, i) => w > 530 || i % 2 === 0 || i === markers.length - 1).map((n) => <text key={n} x={xf(n)} y={h - 6} textAnchor={n === limits[1] ? "end" : "middle"}>{frequency(n)}</text>)}
              <text x="6" y="13" className="axis-unit">dBFS</text>
            </g>
            <g clipPath={`url(#clip${uid})`}>
              {[...r.channels].sort((a, b) => Number(a.id === focusCh.id) - Number(b.id === focusCh.id)).filter((c) => !hidden.includes(c.id) && (tool || (!c.muted && (!anySolo || c.solo)))).map((c) => {
                const d = line(trace(c.id)), focus = c.id === focusCh.id;
                return <g key={c.id} opacity={tool && !focus ? 0.2 : 1}>{(!tool || focus) && <path d={`${d} L${xf(limits[1])} ${h - bt} L${xf(limits[0])} ${h - bt} Z`} fill={`url(#${uid}${c.id})`} />}<path d={d} stroke={c.color} strokeWidth={focus ? 1.9 : 1.4} fill="none" strokeLinejoin="round" /></g>;
              })}
              {!tool && liveSpectrum && <path d={line(liveSpectrum)} fill="none" stroke="#dbefe5" strokeWidth="1.2" opacity=".85" />}
              {tool && playing && focusLive && <path d={line(focusLive)} fill="none" stroke="#f4fbf7" strokeWidth="1.1" opacity=".8" />}
            </g>
            {!tool && r.issues.filter((z) => z.hz >= limits[0] && z.hz <= limits[1]).map((z, i, list) => {
              const hz = (z.hz + z.endHz) / 2, x = xf(hz), tag = `${frequency(hz)} Hz`, tw = tag.length * 6 + 11;
              const prev = i > 0 ? xf((list[i - 1].hz + list[i - 1].endHz) / 2) : -999, stagger = Math.abs(x - prev) < tw + 4 && i % 2 === 1 ? 16 : 0;
              const t = trace(z.tracks[z.tracks.length - 1]), idx = Math.min(t.length - 1, Math.max(0, Math.round((Math.log(hz / 20) / Math.log(1000)) * (t.length - 1))));
              const warm = z.type === "priority" || z.type === "clash" || z.type === "avoid";
              return (
                <g key={z.id} className="freq-marker" onClick={(e) => { e.stopPropagation(); onIssue(z); }}>
                  <line x1={x} x2={x} y1={top - 3 + stagger} y2={h - bt} stroke={warm ? "#7fc7a8" : "#c58c4f"} strokeDasharray="3 4" opacity=".6" />
                  <rect x={x - tw / 2} y={2 + stagger} rx="2" width={tw} height="15" fill={warm ? "#1d2c26" : "#2c261e"} stroke={warm ? "#3f6a57" : "#705437"} strokeWidth=".7" />
                  <text x={x} y={12.8 + stagger} textAnchor="middle" fill={warm ? "#a9e4c9" : "#efc591"} fontSize="10" fontFamily="monospace">{tag}</text>
                  {t.length > 0 && <circle cx={x} cy={yf(t[idx])} r="2.8" fill={warm ? "#9be0c2" : "#e6b17c"} stroke="#1d1e1e" />}
                  <title>{`${z.title} · ${z.reason}`}</title>
                </g>
              );
            })}
            {!tool && r.channels.flatMap((c) => [...(anchors[c.id] ?? []).filter((a) => a.freq >= limits[0] && a.freq <= limits[1]).map((a, i) => <path key={`${c.id}p${i}`} d={`M${xf(a.freq)} ${h - bt - 1}l-4.5 -7h9z`} fill={c.color} stroke="#0d1113" strokeWidth=".8"><title>{`Полезная частота ${c.name}: ${frequency(a.freq)} Hz`}</title></path>), ...(anchorSets[c.id]?.avoid ?? []).filter((a) => a.freq >= limits[0] && a.freq <= limits[1]).map((a, i) => <path key={`${c.id}a${i}`} d={`M${xf(a.freq)} ${top + 1}l-4.5 7h9z`} fill="#e3a361" stroke="#0d1113" strokeWidth=".8"><title>{`Нежелательная частота ${c.name}: ${frequency(a.freq)} Hz`}</title></path>)])}
            {tool && (
              <g className="eq-layer">
                {sel && (() => { const half = 2 ** (octaves(sel.q) / 2); return <rect x={xf(Math.max(limits[0], sel.freq / half))} y={top} width={Math.max(1, xf(Math.min(limits[1], sel.freq * half)) - xf(Math.max(limits[0], sel.freq / half)))} height={ph} fill={focusCh.color} opacity=".07" />; })()}
                <line x1={l} x2={w - rt} y1={ye(0)} y2={ye(0)} stroke="#55665f" strokeDasharray="4 4" strokeWidth=".8" />
                {[6, 12].map((g) => <text key={g} x={w - rt - 3} y={ye(g) + 3} textAnchor="end" className="eq-scale">+{g}</text>)}
                <text x={w - rt - 3} y={ye(0) - 4} textAnchor="end" className="eq-scale">EQ 0 dB</text>
                {points.length > 0 && (() => {
                  const pts = Array.from({ length: 220 }, (_, i) => { const f = limits[0] * (limits[1] / limits[0]) ** (i / 219); return `${xf(f).toFixed(1)},${ye(curveDb(f, points)).toFixed(1)}`; });
                  return <><path d={`M${l},${ye(0)} L${pts.join(" L")} L${w - rt},${ye(0)} Z`} fill={focusCh.color} opacity=".13" /><path d={`M${pts.join(" L")}`} fill="none" stroke={focusCh.color} strokeWidth="2.2" /></>;
                })()}
                {points.map((p, i) => (
                  <g key={i} className="eq-point" transform={`translate(${xf(p.freq)},${ye(p.gain)})`}>
                    {i === active && <circle r="13" fill="none" stroke="#e8f6ef" strokeWidth="1.2" opacity=".75" />}
                    <circle r="8.5" fill={focusCh.color} stroke="#0b0f11" strokeWidth="1.5" />
                    <text y="3.4" textAnchor="middle" className="eq-point-label">{i + 1}</text>
                  </g>
                ))}
              </g>
            )}
            {hover && hover.x > l && hover.x < w - rt && hover.y > top && hover.y < h - bt && !tool && (
              <g pointerEvents="none">
                <path d={`M${hover.x} ${top}V${h - bt}M${l} ${hover.y}H${w - rt}`} stroke="#a5bcb1" strokeWidth=".7" strokeDasharray="2 3" />
                <rect x={Math.min(w - 120, hover.x + 8)} y={Math.max(top, hover.y - 23)} width="108" height="19" rx="3" fill="#202b29" stroke="#536e64" />
                <text x={Math.min(w - 115, hover.x + 13)} y={Math.max(top, hover.y - 23) + 13} fill="#c9e8db" fontFamily="monospace" fontSize="9">{frequency(ff(hover.x))} Hz · {tool ? `+${gy(hover.y).toFixed(1)} dB EQ` : `${Math.round(ceiling - ((hover.y - top) / ph) * span)} dB`}</text>
              </g>
            )}
          </svg>
          {tool && (
            <div className="anchor-readout" role="status">
              {sel ? (
                <>
                  <b style={{ color: focusCh.color }}>{focusCh.name} · {active! + 1}</b>
                  <span>{frequency(sel.freq)} Hz</span><span>+{sel.gain.toFixed(1)} dB</span>
                  <span className="q-control"><button aria-label="Шире" onClick={() => qStep(1 / 1.15)}><Minus size={10} /></button>Q {sel.q.toFixed(2)}<button aria-label="Уже" onClick={() => qStep(1.15)}><Plus size={10} /></button></span>
                  <small>{octaves(sel.q).toFixed(2)} oct</small>
                  <button className="remove-point" aria-label="Удалить точку" onClick={() => { setPoints((ps) => ps.filter((_, j) => j !== active)); setActive(null); }}><Trash2 size={11} /></button>
                </>
              ) : (
                <span className="hint">{message || (points.length ? "Выберите точку, чтобы настроить её" : `Щёлкните по спектру — поставьте ${role === "sub" ? "опорную частоту саба" : "до двух точек"}, затем тяните вверх и слушайте.`)}</span>
              )}
              {sel && message && <span className="hint warn">{message}</span>}
            </div>
          )}
        </div>
      )}
      <div className="spectrum-zones" style={{ paddingRight: rt }}>{ZONES.filter((z) => z.a < limits[1] && z.b > limits[0]).map((z) => <span key={z.n} style={{ flex: Math.log(Math.min(z.b, limits[1]) / Math.max(z.a, limits[0])) }}>{z.n}</span>)}</div>
      {tool ? (
        <div className="plot-legend anchor-legend">
          <div className="focus-chips">{r.channels.map((c) => {
            const n = (drafts[c.id] ?? []).length, lim = anchorLimit(roleOf(c)), unsaved = !same(drafts[c.id], anchors[c.id]);
            return <button key={c.id} aria-pressed={c.id === focusCh.id} className={c.id === focusCh.id ? "active" : ""} onClick={() => { onSelect(c.id); setActive(null); setMessage(""); }} title={`${c.name}: ${n}/${lim} ориентиров${unsaved ? " · не сохранено" : ""}`}><i className="dot" style={{ background: c.color }} />{c.name}<span className="slots">{Array.from({ length: lim }, (_, k) => <b key={k} className={k < n ? "on" : ""} style={k < n ? { background: c.color } : undefined} />)}</span>{unsaved && <em aria-label="не сохранено">•</em>}</button>;
          })}</div>
          <div className="anchor-actions">
            <button className="text-action" onClick={() => { setPoints(() => saved); setActive(null); }} disabled={!dirty}><RotateCcw size={11} />Отменить</button>
            <button className="btn primary mini" disabled={!dirty || saving} onClick={save}><Save size={12} />{saving ? "Сохранение…" : "Сохранить ориентиры"}</button>
          </div>
        </div>
      ) : (
        <div className="plot-legend">
          <div className="legends">
            {r.channels.map((c) => <button key={c.id} aria-pressed={!hidden.includes(c.id)} className={hidden.includes(c.id) ? "hidden-line" : ""} title={`Показать / скрыть ${c.name}`} onClick={() => setHidden((v) => (v.includes(c.id) ? v.filter((x) => x !== c.id) : [...v, c.id]))}><i className="dot" style={{ background: c.color }} />{c.name}</button>)}
            {liveSpectrum && <span className="live-legend"><i className="dot mint" />MIX LIVE</span>}
          </div>
          <label className="range-select"><select aria-label="Частотный диапазон" value={range} onChange={(e) => { setRange(e.target.value); setMode("spectrum"); }}><option value="full">20 Hz — 20 kHz</option><option value="low">20 — 250 Hz</option><option value="mid">150 Hz — 2 kHz</option><option value="high">1 — 20 kHz</option></select><ChevronDown size={10} /></label>
        </div>
      )}
      <div className="instrument-foot">
        <Crosshair size={11} />
        {tool ? <span>Двойной щелчок — удалить · колесо или [ ] — ширина Q · стрелки — точная настройка</span> : <span>Δf {r.binHz.toFixed(2)} Hz · ▲ полезные · ▼ нежелательные частоты</span>}
        {tool && <label className="range-select push"><select aria-label="Частотный диапазон" value={range} onChange={(e) => setRange(e.target.value)}><option value="full">20 Hz — 20 kHz</option><option value="low">20 — 250 Hz</option><option value="mid">150 Hz — 2 kHz</option><option value="high">1 — 20 kHz</option></select><ChevronDown size={10} /></label>}
      </div>
    </section>
  );
}
