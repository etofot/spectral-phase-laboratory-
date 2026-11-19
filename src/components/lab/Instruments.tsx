"use client";
import { useId } from "react";
import {
  Trash2,
  Target,
  Activity,
  AudioLines,
  Blend,
  Gauge,
  TriangleAlert,
  Layers3,
  Plus,
  SlidersHorizontal,
  ArrowUpRight,
  Waves,
  ScanLine,
  Radio,
} from "lucide-react";
import type { Channel, LabReport } from "@/lib/lab-types";
import { value, signed } from "@/lib/lab-types";

export function Logo() {
  return (
    <div className="brand">
      <div className="brand-mark">
        <svg viewBox="0 0 36 36" fill="none" aria-hidden="true">
          <path
            d="M5 16v5m5-12v17m5-21v22m5-16v20m5-23v16m5-11v6"
            stroke="currentColor"
            strokeWidth="2.6"
            strokeLinecap="square"
          />
        </svg>
      </div>
      <span className="wordmark">
        Phase<span>Lab</span>
      </span>
      <span className="version">v2.0</span>
    </div>
  );
}
export function Waveform({
  data,
  color = "currentColor",
  className = "",
  bars = 100,
}: {
  data: number[];
  color?: string;
  className?: string;
  bars?: number;
}) {
  const top = Math.max(...data, 0.001);
  const n = Math.min(data.length, bars);
  const points = Array.from({ length: n }, (_, i) => {
    const v = data[Math.floor((i * data.length) / n)] / top;
    const h = Math.max(0.6, Math.pow(v, 0.77) * 11);
    return `M${i * 2 + 1} ${12 - h}v${h * 2}`;
  }).join(" ");
  return (
    <svg
      viewBox={`0 0 ${n * 2} 24`}
      preserveAspectRatio="none"
      className={`waveform ${className}`}
      aria-hidden="true"
    >
      <path d={points} fill="none" stroke={color} strokeWidth="1.22" />
    </svg>
  );
}
export function Sparkline({
  data,
  color = "#68dec3",
  fill = true,
}: {
  data: number[];
  color?: string;
  fill?: boolean;
}) {
  const id = useId().replace(/:/g, "");
  const min = Math.min(...data),
    max = Math.max(...data);
  const points = data
    .map(
      (v, i) =>
        `${(i / (data.length - 1)) * 88},${26 - ((v - min) / (max - min || 1)) * 18}`,
    )
    .join(" ");
  return (
    <svg
      viewBox="0 0 89 32"
      preserveAspectRatio="none"
      className="sparkline"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={color} stopOpacity=".23" />
          <stop offset="1" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      {fill && <polygon points={`0,32 ${points} 88,32`} fill={`url(#${id})`} />}
      <polyline
        points={points}
        fill="none"
        stroke={color}
        strokeWidth="1.3"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}
export function SegmentMeter({
  db = -6,
  n = 36,
  gradient = false,
}: {
  db?: number;
  n?: number;
  gradient?: boolean;
}) {
  return (
    <div className="segments" aria-label={`${value(db)} dBFS`}>
      {Array.from({ length: n }, (_, i) => {
        const on = i / n < (db + 60) / 60;
        return (
          <i
            key={i}
            style={{
              background: on
                ? gradient
                  ? `hsl(${155 - (i / n) * 110} 55% ${53 + (i / n) * 9}%)`
                  : "var(--mint)"
                : "var(--unlit)",
            }}
          />
        );
      })}
    </div>
  );
}
export function MetricRack({ report: r, pending = false }: { report: LabReport; pending?: boolean }) {
  const high = r.issues.filter((i) => i.severity === "high").length;
  return (
    <section className="metric-rack" aria-label="Измерения мастер-шины">
      <div className="metric">
        <div className="metric-label">
          <Gauge />
          Готовность микса
        </div>
        <div className="metric-reading">
          <strong>{Math.round(r.score)}</strong>
          <span>/ 100</span>
          <div className="readiness-spark">
            {Array.from({ length: 19 }, (_, i) => (
              <i
                key={i}
                style={{
                  height: 5 + i * 0.9,
                  background:
                    i / 19 < r.score / 100 ? "var(--mint)" : "#25312d",
                }}
              />
            ))}
          </div>
        </div>
        <div className="metric-caption">
          <i className="dot mint" />
          Mix readiness
        </div>
      </div>
      <div className="metric">
        <div className="metric-label">
          <AudioLines />
          Громкость
        </div>
        <div className="metric-reading">
          <strong>{value(r.meter.lufs)}</strong>
          <span>LUFS</span>
          <Sparkline data={r.traces.energy} />
        </div>
        <div className="metric-caption">Integrated · BS.1770</div>
      </div>
      <div className="metric">
        <div className="metric-label">
          <Activity />
          Истинный пик
        </div>
        <div className="metric-reading">
          <strong>{value(r.meter.truePeak, 2)}</strong>
          <span>dBTP</span>
          <div className="peak-mini">
            {Array.from({ length: 17 }, (_, i) => (
              <i
                key={i}
                style={{
                  height: Math.max(
                    2,
                    Math.min(24, ((r.traces.peak[i] || -60) + 40) * 0.6),
                  ),
                  background: i > 14 ? "#817457" : "#62b39c",
                }}
              />
            ))}
          </div>
        </div>
        <div className="metric-caption">
          <i className={`dot ${r.meter.truePeak > -1 ? "amber" : "mint"}`} />
          {r.meter.truePeak >= 0
            ? "Риск клиппинга"
            : r.meter.truePeak > -1
              ? "Малый запас"
              : "Без клиппинга"}{" "}
          · 4×
        </div>
      </div>
      <div className={`metric anchor-metric ${pending ? "stale" : ""}`}>
        <div className="metric-label"><Target />Ориентиры</div>
        <div className="metric-reading">
          {r.priorities?.total || r.priorities?.avoidTotal ? <><strong>{r.priorities.clear}/{r.priorities.total}</strong><span>▲ ясны · ▼ {r.priorities.avoidSettled ?? 0}/{r.priorities.avoidTotal ?? 0}</span></> : <><strong>—</strong><span>не заданы</span></>}
          <div className="anchor-bars">{[...(r.priorities?.rows ?? []).map((x) => ({ h: 4 + Math.max(0, Math.min(18, (x.smr + 6) * 2)), c: x.clear ? "var(--mint)" : "#b48a5e", t: `▲ ${x.track} ${x.freq} Hz: SMR ${x.smr} dB` })), ...(r.priorities?.avoidRows ?? []).map((x) => ({ h: 4 + Math.max(0, Math.min(18, -x.cutDb * 2)), c: x.settled ? "#e3a361" : "#6f5a44", t: `▼ ${x.track} ${x.freq} Hz: вырез ${x.cutDb} dB` }))].slice(0, 14).map((b, i) => <i key={i} title={b.t} style={{ height: b.h, background: b.c }} />)}</div>
        </div>
        <div className="metric-caption"><i className={`dot ${pending ? "amber" : r.priorities?.total || r.priorities?.avoidTotal ? "mint" : "gray"}`} />{pending ? "Изменены · нужен анализ" : r.priorities?.total ? `мин. SMR ${signed(Math.min(...r.priorities.rows.map((x) => x.smr)))} dB · цель +3` : r.priorities?.avoidTotal ? "Нежелательные полосы — доноры" : "Двойной клик по дорожке"}</div>
      </div>
<div className="metric conflict-metric">
        <div className="metric-label">
          <TriangleAlert />
          Конфликты
        </div>
        <div className="metric-reading">
          <strong>{String(r.issues.length).padStart(2, "0")}</strong>
          <span>обнаружено</span>
          <div className="alert-stripes" />
        </div>
        <div className="metric-caption">
          <i className="dot amber" />
          {high} высокий · {r.issues.length - high} средних
        </div>
      </div>
    </section>
  );
}

export function StemsPanel({
  report: r,
  selected,
  onSelect,
  onEdit,
  onInstructor,
  onRemove,
  onToggle,
  onImport,
  disabled,
}: {
  report: LabReport;
  selected: string;
  onSelect: (id: string) => void;
  onEdit: (id: string) => void;
  onInstructor: (id: string) => void;
  onRemove?: (id: string) => void;
  onToggle: (id: string, key: "muted" | "solo") => void;
  onImport: () => void;
  disabled: boolean;
}) {
  return (
    <section className="instrument stems-panel">
      <div className="panel-heading">
        <div className="heading-text">
          <Layers3 />
          <h2>Входные стемы</h2>
          <b className="count-badge">
            {String(r.channels.length).padStart(2, "0")}
          </b>
        </div>
        <button
          className="icon-btn compact"
          onClick={onImport}
          disabled={disabled}
          aria-label="Импортировать WAV"
          title="Импортировать WAV"
        >
          <Plus />
        </button>
      </div>
      <div className="channel-list">
        {!r.channels.length && <div className="empty-stems"><AudioLines size={24}/><b>Микс пуст</b><span>Загрузите WAV через «+». Начните со своих дорожек.</span><button className="btn primary mini" onClick={onImport} disabled={disabled}>+ Загрузить дорожку</button></div>}
        {r.channels.map((c, i) => {
          const t = r.trackInfo[c.id];
          return (
            <div
              key={c.id}
              className={`channel ${selected === c.id ? "selected" : ""} ${c.muted ? "muted-channel" : ""}`}
              style={{ "--ch": c.color } as React.CSSProperties}
            >
              <div className="channel-top">
                <button
                  className="channel-name"
                  onClick={() => onSelect(c.id)}
                  onDoubleClick={() => onInstructor(c.id)}
                >
                  <span className="channel-no">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <i className="dot" style={{ background: c.color }} />
                  <b>{c.name}</b>
                </button>
                <div className="channel-buttons">
                  {onRemove && <button className="channel-delete" aria-label={`Удалить ${c.name}`} title={`Удалить ${c.name} из микса`} onClick={(e) => { e.stopPropagation(); onRemove(c.id); }} disabled={disabled}><Trash2 size={12}/></button>}
                  <button
                    className={c.muted ? "m-on" : ""}
                    aria-label={`Mute ${c.name}`}
                    aria-pressed={c.muted}
                    onClick={() => onToggle(c.id, "muted")}
                    disabled={disabled}
                  >
                    M
                  </button>
                  <button
                    className={c.solo ? "s-on" : ""}
                    aria-label={`Solo ${c.name}`}
                    aria-pressed={c.solo}
                    onClick={() => onToggle(c.id, "solo")}
                    disabled={disabled}
                  >
                    S
                  </button>
                </div>
              </div>
              <button
                className="wave-hit"
                onClick={() => onSelect(c.id)}
                onDoubleClick={() => onInstructor(c.id)}
                title={`Двойной клик — инструктор частот ${c.name}`}
              >
                <Waveform data={t.wave} color={c.color} bars={130} />
              </button>
              <div className="channel-meta">
                <span>{c.id.startsWith("u_") ? c.name : c.id}.wav</span>
                <span>
                  {value(t.lufs)} <small>LUFS</small>
                </span>
              </div>
            </div>
          );
        })}
      </div>
      <button className="channel-foot" disabled={!r.channels.length} onClick={() => onEdit(selected)}>
        <SlidersHorizontal size={13} />
        <span>Инспектор канала</span>
        <ArrowUpRight size={13} />
      </button>
    </section>
  );
}
export function PhaseScope({
  points,
  large = false,
}: {
  points: number[][];
  large?: boolean;
}) {
  const id = useId().replace(/:/g, "");
  const p = points
    .map(
      ([l, r], i) =>
        `${i ? "L" : "M"}${(100 + l * 78).toFixed(1)},${(74 - r * 63).toFixed(1)}`,
    )
    .join(" ");
  return (
    <svg
      className={`phase-scope ${large ? "large" : ""}`}
      viewBox="0 0 200 148"
      role="img"
      aria-label="Фазоскоп: измеренная траектория левого и правого канала"
    >
      <defs>
        <pattern
          id={`grid${id}`}
          width="15"
          height="15"
          patternUnits="userSpaceOnUse"
        >
          <circle cx="1" cy="1" r=".65" fill="#37443f" />
        </pattern>
        <filter id={`glow${id}`} x="-30%" y="-30%" width="160%" height="160%">
          <feGaussianBlur stdDeviation="1.5" />
        </filter>
      </defs>
      <rect width="200" height="148" fill={`url(#grid${id})`} />
      <g stroke="#2c3834" fill="none" strokeWidth=".65">
        <circle cx="100" cy="74" r="61" />
        <circle cx="100" cy="74" r="40" />
        <circle cx="100" cy="74" r="21" />
        <path d="M18 74h164M100 4v140" />
        <path d="M44 18l112 112m0-112L44 130" strokeDasharray="3 3" />
        <path d="M100 13l61 61-61 61-61-61z" />
      </g>
      <g fill="#81908a" fontSize="8" fontFamily="monospace">
        <text x="34" y="20">
          L
        </text>
        <text x="160" y="20">
          R
        </text>
        <text x="104" y="10">
          +1
        </text>
        <text x="169" y="78">
          0
        </text>
      </g>
      <path
        d={p}
        stroke="#6ce6b5"
        strokeWidth="2"
        fill="none"
        opacity=".48"
        filter={`url(#glow${id})`}
      />
      <path
        d={p}
        stroke="#80e8c6"
        strokeWidth=".78"
        fill="none"
        opacity=".73"
      />
      <path d="M96 74h8m-4-4v8" stroke="#d4e8dc" strokeWidth=".7" />
    </svg>
  );
}
export function PhasePanel({
  report: r,
  live,
}: {
  report: LabReport;
  live?: { scope: number[][]; levels: number[]; correlation: number } | null;
}) {
  return (
    <section className="instrument phase-panel">
      <div className="panel-heading">
        <div className="heading-text">
          <Radio />
          <h2>Фазовый монитор</h2>
        </div>
        <span className="micro-tag">X/Y</span>
      </div>
      <div className="scope-wrap">
        <PhaseScope points={live?.scope || r.scope} />
      </div>
      <div className="correlation-block">
        <div className="tiny-reading">
          <span>Корреляция L/R</span>
          <b>{signed(live?.correlation ?? r.correlation, 2)}</b>
        </div>
        <div className="correlation-scale">
          <i
            style={{
              left: `${((live?.correlation ?? r.correlation) + 1) * 50}%`,
            }}
          />
        </div>
        <div className="scale-labels">
          <span>−1</span>
          <span>0</span>
          <span>+1</span>
        </div>
      </div>
      <div className="master-level">
        <div className="level-title">
          <span>
            <AudioLines size={12} />
            Мастер-уровень
          </span>
          <small>dBFS</small>
        </div>
        {["L", "R"].map((s, i) => (
          <div key={s} className="level-row">
            <span>{s}</span>
            <SegmentMeter
              db={live?.levels[i] ?? r.masterLR[i]}
              n={32}
              gradient
            />
            <b>{value(live?.levels[i] ?? r.masterLR[i])}</b>
          </div>
        ))}
      </div>
      <div className="instrument-foot">
        <span className="dot mint" />
        {live ? "LIVE MONITOR" : "СТЕРЕОСИГНАЛ"}
        <span className="push">L + R</span>
      </div>
    </section>
  );
}
export function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="section-label">
      <span className="short-rule" />
      {children}
    </div>
  );
}
export function SignalIcon({ type }: { type: string }) {
  return type === "phase" ? <Waves size={15} /> : <ScanLine size={15} />;
}
export function ChannelTag({ channel }: { channel: Channel | undefined }) {
  return (
    <span className="channel-tag">
      <i className="dot" style={{ background: channel?.color }} />
      {channel?.name || "—"}
    </span>
  );
}
