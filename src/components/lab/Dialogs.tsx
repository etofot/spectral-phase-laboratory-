"use client";
import { useRef, useEffect, useState, useId } from "react";
import {
  X,
  Plus,
  Trash2,
  SlidersHorizontal,
  ArrowRight,
  RotateCcw,
  Check,
  Play,
  Headphones,
  Activity,
  ChevronDown,
  LoaderCircle,
  GitCompareArrows,
  ShieldCheck,
  FileAudio,
  TriangleAlert,
} from "lucide-react";
import type { LabReport, Channel, Preview, Role } from "@/lib/lab-types";
import { frequency, value, signed, roleOf, ROLES } from "@/lib/lab-types";
import { Waveform } from "./Instruments";
export function Dialog({
  title,
  sub,
  onClose,
  children,
  wide = false,
  xl = false,
  locked = false,
}: {
  title: string;
  sub?: string;
  onClose: () => void;
  children: React.ReactNode;
  wide?: boolean;
  xl?: boolean;
  locked?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const id = useId();
  useEffect(() => {
    const el = ref.current;
    el?.showModal();
    const before = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = before;
      el?.close();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      aria-labelledby={id}
      className={`lab-dialog ${xl ? "xl" : wide ? "wide" : ""}`}
      onCancel={(e) => {
        e.preventDefault();
        if (!locked) onClose();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget && !locked) {
          const r = e.currentTarget.getBoundingClientRect();
          if (
            e.clientX < r.left ||
            e.clientX > r.right ||
            e.clientY < r.top ||
            e.clientY > r.bottom
          )
            onClose();
        }
      }}
    >
      <div className="dialog-heading">
        <div>
          {sub && <span className="eyebrow">{sub}</span>}
          <h2 id={id}>{title}</h2>
        </div>
        <button
          className="icon-btn"
          onClick={onClose}
          disabled={locked}
          aria-label="Закрыть"
        >
          <X size={17} />
        </button>
      </div>
      <div className="dialog-body">{children}</div>
    </dialog>
  );
}
export function ChannelEditor({ r, id, initialFreq, onSave, onRemove, busy }: { r: LabReport; id: string; initialFreq?: number; onSave: (c: Channel) => void; onRemove: (id: string) => void; busy: boolean }) {
  const original = r.channels.find((c) => c.id === id)!;
  const [draft, setDraft] = useState<Channel>({ ...original, role: roleOf(original), bands: original.bands.map((b) => ({ ...b })) });
  const [f, setF] = useState(String(initialFreq || r.trackInfo[id]?.harmonics.f0 || 55));
  const [gain, setGain] = useState("-3.5");
  const [q, setQ] = useState("18");
  const [err, setErr] = useState("");
  const [confirm, setConfirm] = useState(false);
  const info = r.trackInfo[id];
  function add() {
    const freq = +f, g = +gain, qual = +q;
    if (!f || !gain || !q || !Number.isFinite(freq + g + qual) || freq < 15 || freq > 22000 || g < -30 || g > 12 || qual < 0.1 || qual > 50 || draft.bands.length >= 64) {
      setErr("Частота 15–22 000 Гц, gain −30…+12 дБ, Q 0.1–50. До 64 полос.");
      return;
    }
    setErr("");
    setDraft({ ...draft, bands: [...draft.bands, { freq, gain: g, q: qual }] });
  }
  return (
    <div className="editor">
      <div className="editor-banner" style={{ "--ch": draft.color } as React.CSSProperties}>
        <span className="eyebrow"><i className="dot" style={{ background: draft.color }} />{draft.name.toUpperCase()} · {ROLES.find((x) => x.id === draft.role)?.label}</span>
        {info && <Waveform data={info.wave} color={draft.color} />}
        <div className="microtext">{value(info?.lufs)} LUFS <b>·</b> {value(info?.truePeak)} dBTP{draft.offset ? <><b>·</b>фрагмент с {draft.offset} с</> : null}</div>
      </div>
      <div className="field-row">
        <label className="field">Название<input value={draft.name} maxLength={48} onChange={(e) => setDraft({ ...draft, name: e.target.value })} /></label>
        <label className="field">Роль<select value={draft.role} onChange={(e) => setDraft({ ...draft, role: e.target.value as Role })}>{ROLES.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}</select></label>
      </div>
      <div className="section-heading"><h3><SlidersHorizontal size={15} />Параметрический EQ · звук</h3><span className="count-badge">{draft.bands.length} / 64</span></div>
      {draft.bands.length > 0 ? (
        <div className="band-list">{draft.bands.map((b, i) => <div key={i}><b>B{String(i + 1).padStart(2, "0")}</b><span>{frequency(b.freq)} Hz</span><span>{signed(b.gain)} dB</span><span>Q {b.q}</span><button className="icon-btn compact" onClick={() => setDraft({ ...draft, bands: draft.bands.filter((_, j) => i !== j) })} aria-label={`Удалить полосу ${i + 1}`}><Trash2 size={12} /></button></div>)}</div>
      ) : <p className="muted-copy">Нейтральная АЧХ. Эти полосы меняют звук; частоты-ориентиры задаются на спектре кнопкой «Ориентиры».</p>}
      <div className="band-inputs">
        <label>Частота, Hz<input type="number" min="15" max="22000" step="0.1" value={f} onChange={(e) => setF(e.target.value)} /></label>
        <label>Gain, dB<input type="number" min="-30" max="12" step="0.1" value={gain} onChange={(e) => setGain(e.target.value)} /></label>
        <label>Q<input type="number" min="0.1" max="50" step="0.1" value={q} onChange={(e) => setQ(e.target.value)} /></label>
        <button className="btn secondary" onClick={add} title="Добавить полосу" aria-label="Добавить полосу EQ"><Plus size={17} /></button>
      </div>
      {err && <p className="error-note" role="alert">{err}</p>}
      <div className="slider-param"><label htmlFor="phase">Фаза <small>32–85 Hz · STFT</small></label><b>{signed(draft.phase, 0)}°</b><input id="phase" type="range" min="-180" max="180" step="1" value={draft.phase} onChange={(e) => setDraft({ ...draft, phase: +e.target.value })} /><div className="scale-labels"><span>−180°</span><span>0°</span><span>+180°</span></div></div>
      <div className="slider-param"><label htmlFor="gain">Уровень канала</label><b>{signed(draft.gain)} dB</b><input id="gain" type="range" min="-36" max="12" step=".1" value={draft.gain} onChange={(e) => setDraft({ ...draft, gain: +e.target.value })} /></div>
      <div className="dialog-actions">
        <button className="btn secondary" onClick={() => setDraft({ ...draft, bands: [], phase: 0, gain: 0 })} disabled={busy}><RotateCcw size={13} />Сбросить</button>
        <button className="btn primary" disabled={busy || !draft.name.trim()} onClick={() => onSave({ ...draft, name: draft.name.trim() })}>{busy ? <LoaderCircle className="spin" size={14} /> : <Check size={14} />}Применить и измерить</button>
      </div>
      <div className="reset-section">
        {confirm ? (
          <><p><TriangleAlert size={14} />Удалить «{original.name}» из сессии? Источник останется в истории снимков.</p><div className="dialog-actions"><button className="btn secondary" onClick={() => setConfirm(false)}>Отмена</button><button className="btn amber-btn" disabled={busy} onClick={() => onRemove(id)}>Удалить канал</button></div></>
        ) : <button className="text-action" onClick={() => setConfirm(true)}><Trash2 size={12} />Удалить канал из сессии</button>}
      </div>
    </div>
  );
}
export type ImportSpec = { file: File; name: string; role: Role; offset: number; autoFit: boolean };
export function ImportBody({ busy, error, onImport }: { busy: boolean; error: string; onImport: (spec: ImportSpec) => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState("");
  const [role, setRole] = useState<Role>("melodic");
  const [offset, setOffset] = useState("0");
  const [autoFit, setAutoFit] = useState(true);
  const [local, setLocal] = useState("");
  function pick(f: File | undefined) {
    if (!f) return;
    if (!/\.wav$/i.test(f.name)) { setLocal("Выберите WAV-файл (PCM или float)."); return; }
    if (f.size > 64 * 1024 * 1024) { setLocal("Максимальный размер — 64 МБ."); return; }
    setLocal(""); setFile(f); setName(f.name.replace(/\.wav$/i, "").slice(0, 48));
  }
  const off = Number(offset);
  const valid = file && name.trim() && Number.isFinite(off) && off >= 0 && off <= 3600;
  return (
    <div className="import-body">
      {!file ? (
        <div className="file-drop" onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); pick(e.dataTransfer.files[0]); }}>
          <FileAudio size={32} /><h3>Перетащите WAV-файл</h3><p>PCM или float · до 64 МБ · mono / stereo · 8–192 кГц</p>
          <input ref={fileRef} type="file" accept=".wav,audio/wav,audio/x-wav" hidden onChange={(e) => pick(e.target.files?.[0])} />
          <button className="btn primary" onClick={() => fileRef.current?.click()}><Plus size={14} />Выбрать файл на компьютере</button>
        </div>
      ) : (
        <div className="import-form">
          <div className="picked-file"><FileAudio size={18} /><span><b>{file.name}</b><small>{(file.size / 1048576).toFixed(1)} МБ</small></span><button className="text-action" disabled={busy} onClick={() => setFile(null)}>Другой файл</button></div>
          <label className="field">Название дорожки<input autoFocus value={name} maxLength={48} placeholder="Например, Гитара" onChange={(e) => setName(e.target.value)} /></label>
          <div className="field-row">
            <label className="field">Роль в миксе<select value={role} onChange={(e) => setRole(e.target.value as Role)}>{ROLES.map((x) => <option key={x.id} value={x.id}>{x.label} — {x.hint}</option>)}</select></label>
            <label className="field">Начало фрагмента, с<input type="number" min="0" max="3600" step="0.5" value={offset} onChange={(e) => setOffset(e.target.value)} /></label>
          </div>
          <label className="check-row"><input type="checkbox" checked={autoFit} onChange={(e) => setAutoFit(e.target.checked)} /><span><b>Вписать в микс</b><small>После анализа агент подберёт коррекции для всех стемов. Вы прослушаете A/B и решите, применять ли их.</small></span></label>
          <button className="btn primary full" disabled={!valid || busy} onClick={() => file && onImport({ file, name: name.trim(), role, offset: off, autoFit })}>{busy ? <LoaderCircle className="spin" size={14} /> : <Check size={14} />}{busy ? "Загрузка и анализ…" : "Добавить в микс"}</button>
        </div>
      )}
      <p className="info-note">Анализируется фрагмент до 20 с от указанного начала. Звук приводится к 48 кГц. Если загруженные дорожки короче сессии, они дополняются тишиной. До 24 стемов.</p>
      {(local || error) && <p className="error-note" role="alert">{local || error}</p>}
    </div>
  );
}
export function PreviewBody({
  preview,
  before,
  busy,
  onApply,
  onCancel,
  onListen,
  listening,
}: {
  preview: Preview | null;
  before: LabReport;
  busy: boolean;
  onApply: () => void;
  onCancel: () => void;
  onListen: (key: string, label: string, trimDb: number) => void;
  listening: string | undefined;
}) {
  if (!preview)
    return (
      <div className="render-progress">
        <div className="render-glyph">
          <Activity size={29} />
        </div>
        <h3>Проверяем коррекции</h3>
        <p>
          Рендер стемов → измерение фазы и громкости → проверка запаса до
          клиппинга.
        </p>
        <div className="indeterminate" />
        <small>CPU DSP ENGINE · ИСХОДНИКИ НЕ ИЗМЕНЯЮТСЯ</small>
      </div>
    );
  const after = preview.report,
    yes = preview.steps.filter((s) => s.accepted);
  return (
    <div>
      <div className="preview-status">
        <ShieldCheck size={18} />
        <div>
          <b>
            {yes.length
              ? "Пробный рендер готов"
              : "Безопасного улучшения не найдено"}
          </b>
          <p>
            {yes.length
              ? `Проверено коррекций: ${yes.length}. Рабочая сессия пока не изменена.`
              : "Исходная версия сохранена."}
          </p>
        </div>
      </div>
      <div className="comparison">
        <div className="comparison-head">
          <span>Измерение</span>
          <span>A · До</span>
          <span>B · После</span>
        </div>
        {[
          [
            "Готовность",
            Math.round(before.score) + "/100",
            Math.round(after.score) + "/100",
          ],
          [
            "Integrated",
            value(before.meter.lufs) + " LUFS",
            value(after.meter.lufs) + " LUFS",
          ],
          [
            "True Peak",
            value(before.meter.truePeak) + " dBTP",
            value(after.meter.truePeak) + " dBTP",
          ],
          ["Конфликты", before.issues.filter((z) => z.command).length, after.issues.filter((z) => z.command).length],
          ...(after.priorities?.total ? [["▲ Полезные ясны", `${(preview.beforePriorities ?? before.priorities)?.clear ?? 0}/${after.priorities.total}`, `${after.priorities.clear}/${after.priorities.total}`]] : []),
          ...(after.priorities?.avoidTotal ? [["▼ Нежелательные очищены", `${(preview.beforePriorities ?? before.priorities)?.avoidSettled ?? 0}/${after.priorities.avoidTotal}`, `${after.priorities.avoidSettled ?? 0}/${after.priorities.avoidTotal}`]] : []),
        ].map(([k, a, b]) => (
          <div key={k}>
            <span>{k}</span>
            <b>{a}</b>
            <b>{b}</b>
          </div>
        ))}
      </div>
      <div className="ab-listen">
        <Headphones size={14} />
        <button
          className={listening === before.key ? "active" : ""}
          onClick={() =>
            onListen(
              before.key,
              "A · ИСХОДНЫЙ",
              Math.min(
                0,
                (after.meter.lufs ?? -70) - (before.meter.lufs ?? -70),
              ),
            )
          }
        >
          <Play size={12} />A · Исходный
        </button>
        <button
          className={listening === after.key ? "active" : ""}
          onClick={() =>
            onListen(
              after.key,
              "B · ОБРАБОТКА",
              Math.min(
                0,
                (before.meter.lufs ?? -70) - (after.meter.lufs ?? -70),
              ),
            )
          }
        >
          <Play size={12} />B · Обработка
        </button>
      </div>
      <p className="match-note">
        <ShieldCheck size={11} />
        Уровни A/B согласованы по LUFS. Экспорт — без компенсации.
      </p>
      <details className="step-details">
        <summary>
          Протокол измерений <span>{preview.steps.length} шагов</span>
          <ChevronDown size={13} />
        </summary>
        <div>
          {preview.steps.map((s, i) => (
            <div className="step-line" key={i}>
              <b>{String(s.iteration).padStart(2, "0")}</b>
              <div>
                <strong>
                  {s.command.track} ·{" "}
                  {s.command.phase != null ? `φ ${signed(s.command.phase)}°${s.command.freq ? ` @ ${s.command.freq} Hz` : ""}` : `${s.command.freq} Hz / ${signed(s.command.gain ?? 0)} dB · Q ${s.command.q}`}
                </strong>
                <p>{s.reason}</p>
                <small>
                  {s.before} → {s.after} ·{" "}
                  {s.accepted ? "Принято" : "Отклонено"}
                  {s.headroomTrim !== 0 ? ` · trim ${s.headroomTrim} dB` : ""}
                  {s.note ? ` · ${s.note}` : ""}
                </small>
              </div>
            </div>
          ))}
        </div>
      </details>
      <div className="dialog-actions">
        <button className="btn secondary" onClick={onCancel} disabled={busy}>
          Оставить исходный
        </button>
        <button
          className="btn primary"
          disabled={busy || !yes.length}
          onClick={onApply}
        >
          <Check size={14} />
          Применить коррекции
        </button>
      </div>
    </div>
  );
}
export function SettingsBody({
  name,
  fft,
  onSave,
  onReset,
  busy,
}: {
  name: string;
  fft: number;
  onSave: (n: string, fft: number) => void;
  onReset: () => void;
  busy: boolean;
}) {
  const [n, setN] = useState(name);
  const [f, setF] = useState(fft);
  const [confirm, setConfirm] = useState(false);
  return (
    <div className="settings-body">
      <label className="field">
        Название сессии
        <input
          value={n}
          maxLength={50}
          onChange={(e) => setN(e.target.value)}
        />
      </label>
      <label className="field">
        Окно спектроанализатора
        <select value={f} onChange={(e) => setF(+e.target.value)}>
          {[4096, 8192, 16384, 32768].map((z) => (
            <option value={z} key={z}>
              FFT {z} · {(48000 / z).toFixed(2)} Hz / bin
            </option>
          ))}
        </select>
      </label>
      <div className="spec-list">
        <div>
          <span>Аудиоформат</span>
          <b>48 000 Hz / 32-bit float</b>
        </div>
        <div>
          <span>Обработка</span>
          <b>SciPy CPU · Stereo</b>
        </div>
        <div>
          <span>Анализ узких пиков</span>
          <b>240 000 samples · 0.2 Hz</b>
        </div>
        <div>
          <span>Политика агента</span>
          <b>Проверка перед применением</b>
        </div>
      </div>
      <button
        className="btn primary full"
        onClick={() => onSave(n.trim(), f)}
        disabled={!n.trim() || busy}
      >
        <Check size={14} />
        Сохранить параметры
      </button>
      <div className="reset-section">
        {confirm ? (
          <>
            <p>
              <TriangleAlert size={14} />
              Вернуть начальные 4 стема? Текущая версия останется в журнале.
            </p>
            <div className="dialog-actions">
              <button
                className="btn secondary"
                onClick={() => setConfirm(false)}
              >
                Отмена
              </button>
              <button
                className="btn amber-btn"
                onClick={onReset}
                disabled={busy}
              >
                Восстановить исходники
              </button>
            </div>
          </>
        ) : (
          <button className="text-action" onClick={() => setConfirm(true)}>
            <RotateCcw size={12} />
            Вернуть эталонную сессию
          </button>
        )}
      </div>
    </div>
  );
}
export function ExportBody({ r }: { r: LabReport }) {
  return (
    <div className="export-list">
      <p className="muted-copy">
        Текущий измеренный снимок. WAV-файлы включают принятые EQ, фазу, Mute и
        Solo.
      </p>
      {[
        {
          fmt: "wav",
          title: "Мастер микса",
          desc: "Стерео WAV · 48 kHz · 32-bit float",
          icon: FileAudio,
        },
        {
          fmt: "zip",
          title: "Обработанные стемы",
          desc: `${r.channels.length} стемов, мастер и отчёт · ZIP`,
          icon: GitCompareArrows,
        },
        {
          fmt: "json",
          title: "Отчёт измерений",
          desc: "Метрики, спектр, конфликты и настройки · JSON",
          icon: Activity,
        },
      ].map((o) => (
        <a
          key={o.fmt}
          href={`/api/audio?key=${r.key}&format=${o.fmt}&download=1`}
          download
        >
          <o.icon size={20} />
          <span>
            <b>{o.title}</b>
            <small>{o.desc}</small>
          </span>
          <ArrowRight size={15} />
        </a>
      ))}
    </div>
  );
}
