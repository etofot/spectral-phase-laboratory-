"use client";
import { useState, useCallback, useEffect, useRef } from "react";
import { BookmarkPlus, AudioLines, PanelsTopLeft, ScanLine, History as HistoryIcon, Settings2, Cpu, Download, FolderOpen, LoaderCircle, RotateCcw, FileAudio, Activity, FileJson, Info, ShieldCheck, TriangleAlert, Check, Target } from "lucide-react";
import type { LabReport, Channel, Preview, Issue, HistoryEntry, AnchorMap, AnchorSet, Extensions } from "@/lib/lab-types";
import { anchorCount, frequency, DEFAULT_EXTENSIONS } from "@/lib/lab-types";
import { Logo, MetricRack, PhasePanel, StemsPanel } from "./Instruments";
import Spectrum from "./Spectrum";
import { Diagnostics, IssueDetail } from "./Diagnostics";
import AnalyzerDesk from "./AnalyzerDesk";
import Transport, { type Audition, type LiveSignal } from "./Transport";
import AnchorInstructor from "./AnchorInstructor";
import Presets, { type Preset } from "./Presets";
import { Dialog, ChannelEditor, ExportBody, PreviewBody, SettingsBody, ImportBody, type ImportSpec } from "./Dialogs";

type View = "lab" | "analyzers" | "history";
type Modal = "settings" | "export" | "editor" | "issue" | "preview" | "method" | "import" | "restore" | "instructor" | "anchorReview" | "remove" | "presets" | null;
type Bundle = { name: string; report: LabReport; history: HistoryEntry[]; anchors: AnchorMap; extensions: Extensions };
const PALETTE = ["#dd99c3", "#92bd7c", "#68bacc", "#ba9fe2", "#e7c06b", "#7fd0b1", "#e38f7d", "#9fb4ea"];

async function post<T>(path: string, body: object): Promise<T> {
  const res = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(190000) });
  const data = await res.json();
  if (!res.ok || data.error) throw new Error(data.error || "Сервер не ответил");
  return data;
}

export default function Workspace({ initial, online }: { initial: Bundle; online: boolean }) {
  const [r, setR] = useState(initial.report);
  const [name, setName] = useState(initial.name);
  const [entries, setEntries] = useState(initial.history);
  const [anchors, setAnchors] = useState(initial.anchors);
  const [extensions, setExtensions] = useState(initial.extensions ?? DEFAULT_EXTENSIONS);
  const [depthUi, setDepthUi] = useState((initial.extensions ?? DEFAULT_EXTENSIONS).depth);
  const [pending, setPending] = useState(false);
  const [view, setView] = useState<View>("lab");
  const [modal, setModal] = useState<Modal>(null);
  const [busy, setBusy] = useState("");
  const [selected, setSelected] = useState(r.channels[0]?.id ?? "");
  const [freq, setFreq] = useState<number | undefined>();
  const [issue, setIssue] = useState<Issue | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [audition, setAudition] = useState<Audition | null>(null);
  const [baseline, setBaseline] = useState<{ key: string; meter: { lufs: number | null }; forKey: string } | null>(null);
  const [live, setLive] = useState<LiveSignal | null>(null);
  const [toast, setToast] = useState<{ message: string; error: boolean } | null>(null);
  const [moduleIndex, setModuleIndex] = useState(0);
  const [filter, setFilter] = useState("all");
  const [restoreKey, setRestoreKey] = useState("reference");
  const [removeId, setRemoveId] = useState("");
  const [presets, setPresets] = useState<Preset[]>([]);
  const [importError, setImportError] = useState("");
  const [instructorId, setInstructorId] = useState(r.channels[0]?.id ?? "");
  const instructorTouched = useRef(false);
  const guard = useRef(false);

  useEffect(() => {
    let live = true;
    const forKey = r.key;
    fetch("/api/baseline", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ channels: r.channels, fft: r.fft }) })
      .then((res) => res.ok ? res.json() : Promise.reject(new Error("Исходный мастер недоступен")))
      .then((data) => { if (live) setBaseline({ ...data, forKey }); })
      .catch(() => { if (live) setBaseline({ key: "", meter: { lufs: null }, forKey }); });
    return () => { live = false; };
  }, [r.key, r.channels, r.fft]);

  const baselineReady = baseline?.forKey === r.key && baseline.key ? baseline : null;
  const notify = useCallback((message: string, error = false) => setToast({ message, error }), []);
  const audioError = useCallback((s: string) => notify(s, true), [notify]);
  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 5200);
    return () => clearTimeout(id);
  }, [toast]);

  const close = () => { if (busy) return; setModal(null); setAudition(null); };
  function begin(label: string) { if (guard.current) return false; guard.current = true; setBusy(label); return true; }
  function end() { guard.current = false; setBusy(""); }
  function accept(next: LabReport) { setR(next); if (!next.channels.some((c) => c.id === selected)) setSelected(next.channels[0]?.id ?? ""); setAudition(null); }
  async function refreshHistory() {
    const res = await fetch("/api/session", { cache: "no-store" });
    if (res.ok) { const d = await res.json(); setEntries(d.history); setAnchors(d.anchors ?? {}); }
  }
  async function analyze(channels = r.channels, fft = r.fft, message?: string): Promise<LabReport | null> {
    if (!begin("Измерение сигналов")) return null;
    try {
      const result = await post<LabReport>("/api/analyze", { channels, fft });
      accept(result);
      setPending(false);
      setModal(null);
      await refreshHistory();
      const marks = result.priorities?.total ? ` · ориентиры ясны ${result.priorities.clear}/${result.priorities.total}` : "";
      notify(message ?? `Измерено ${channels.length} стем. · конфликтов ${result.issues.filter((z) => z.command).length}${marks}. Снимок сохранён.`);
      return result;
    } catch (e) {
      notify((e as Error).message, true);
      return null;
    } finally {
      end();
    }
  }
  async function agent(only?: string, base: LabReport = r) {
    if (!begin("Пробный рендер")) return;
    setPreview(null);
    setModal("preview");
    try {
      const result = await post<Preview>("/api/agent", { channels: base.channels, fft: base.fft, iterations: 10, only });
      setPreview(result);
      await refreshHistory();
    } catch (e) {
      notify((e as Error).message, true);
      setModal(null);
    } finally {
      end();
    }
  }
  async function restore(key: string, action = "restore") {
    if (!begin("Сохранение сессии")) return;
    try {
      const bundle = await post<Bundle>("/api/session", { action, key });
      accept(bundle.report);
      setEntries(bundle.history);
      setAnchors(bundle.anchors ?? {});
      setModal(null);
      notify(action === "apply" ? "Проверенные коррекции применены." : action === "reset" ? "Эталонная сессия восстановлена." : "Снимок сессии восстановлен.");
    } catch (e) {
      notify((e as Error).message, true);
    } finally {
      end();
    }
  }
  async function commitExtensions(next: Extensions) {
    if (!begin("Пересчёт процессоров")) return;
    try {
      await post("/api/session", { action: "extensions", ...next });
      setExtensions(next);
      setDepthUi(next.depth);
      const result = await post<LabReport>("/api/analyze", { channels: r.channels, fft: r.fft });
      accept(result);
      await refreshHistory();
      notify(next.dynamic ? `Динамический фазовый EQ ${Math.round(next.depth * 100)}%${next.ms ? " · обработка Mid/Side" : ""}.` : next.ms ? "Анализ Mid/Side включён. Звук пока не изменён." : "Динамический блок выключен — звучание как раньше.");
    } catch (e) {
      notify((e as Error).message, true);
    } finally {
      end();
    }
  }
  async function saveAnchors(id: string, set: AnchorSet) {
    const res = await post<{ anchors: AnchorMap }>("/api/session", { action: "anchors", id, anchors: set });
    setAnchors(res.anchors);
    setPending(true);
    const ch = r.channels.find((c) => c.id === id);
    const good = set.prefer.map((p) => frequency(p.freq) + " Hz").join(", "), bad = set.avoid.map((p) => frequency(p.freq) + " Hz").join(", ");
    notify(anchorCount(set) ? `«${ch?.name}»: полезные ${good || "—"} · нежелательные ${bad || "—"}. Звук не изменён — запустите анализ, когда отметите все инструменты.` : `Ориентиры «${ch?.name}» удалены.`);
  }
  async function saveInstructorAnchors(id: string, set: AnchorSet) {
    instructorTouched.current = true;
    await saveAnchors(id, set);
  }
  function finishInstructor() {
    setAudition(null);
    if (instructorTouched.current || pending) setModal("anchorReview");
    else setModal(null);
    instructorTouched.current = false;
  }
  async function runAnchored() {
    const result = await analyze();
    if (result) await agent(undefined, result);
  }
  async function openPresets() {
    setModal("presets");
    try { const res = await fetch("/api/presets", { cache: "no-store" }); const data = await res.json(); if (!res.ok) throw new Error(data.error); setPresets(data.presets); }
    catch (e) { notify((e as Error).message, true); }
  }
  async function savePreset(name: string) {
    if (!begin("Сохранение отпечатка")) return;
    try { const result = await post<{ presets: Preset[] }>("/api/presets", { action: "save", name }); setPresets(result.presets); notify(`Отпечаток «${name}» сохранён.`); }
    catch (e) { notify((e as Error).message, true); } finally { end(); }
  }
  async function loadPreset(id: number) {
    if (!begin("Восстановление отпечатка")) return;
    try {
      const result = await post<{ report: LabReport; presets: Preset[]; anchors: AnchorMap; extensions: Extensions }>("/api/presets", { action: "load", id });
      accept(result.report); setPresets(result.presets); setAnchors(result.anchors); setExtensions(result.extensions); setDepthUi(result.extensions.depth); setPending(false);
      await refreshHistory(); setModal(null); notify("Отпечаток восстановлен и звук повторно измерен.");
    } catch (e) { notify((e as Error).message, true); } finally { end(); }
  }
  async function deletePreset(id: number) {
    if (!begin("Удаление отпечатка")) return;
    try { const result = await post<{ presets: Preset[] }>("/api/presets", { action: "delete", id }); setPresets(result.presets); notify("Пресет удалён."); }
    catch (e) { notify((e as Error).message, true); } finally { end(); }
  }
  async function importTrack(spec: ImportSpec) {
    if (r.channels.length >= 24) { setImportError("Лимит сессии — 24 стема."); return; }
    if (!begin("Импорт и анализ")) return;
    setImportError("");
    let result: LabReport | null = null;
    try {
      const data = new FormData();
      data.set("file", spec.file);
      data.set("name", spec.name);
      data.set("role", spec.role);
      data.set("offset", String(spec.offset));
      const response = await fetch("/api/import", { method: "POST", body: data });
      const source = await response.json();
      if (!response.ok) throw new Error(source.error || "Ошибка импорта");
      if (r.channels.some((c) => c.id === source.id)) throw new Error("Этот файл уже есть в сессии.");
      const used = new Set(r.channels.map((c) => c.color));
      const channel: Channel = { ...source, color: PALETTE.find((c) => !used.has(c)) ?? PALETTE[r.channels.length % PALETTE.length], bands: [], phase: 0, gain: 0, muted: false, solo: false };
      result = await post<LabReport>("/api/analyze", { channels: [...r.channels, channel], fft: r.fft });
      accept(result);
      setSelected(channel.id);
      setModal(null);
      await refreshHistory();
      notify(`«${channel.name}» добавлен и измерен. ${spec.autoFit ? "Подбираем коррекции…" : "Отметьте его ориентиры на спектре."}`);
    } catch (e) {
      setImportError((e as Error).message);
    } finally {
      end();
    }
    if (result && spec.autoFit) await agent(undefined, result);
  }
  function edit(id: string, hz?: number) { setSelected(id); setFreq(hz); setModal("editor"); }
  function inspect(z: Issue) { setIssue(z); setModal("issue"); }
  async function changeSettings(n: string, fft: number) {
    if (!begin("Сохранение параметров")) return;
    try {
      if (n !== name) { await post("/api/session", { action: "rename", name: n }); setName(n); }
      if (fft !== r.fft) { const result = await post<LabReport>("/api/analyze", { channels: r.channels, fft }); accept(result); await refreshHistory(); }
      setModal(null);
      notify("Параметры сессии сохранены.");
    } catch (e) {
      notify((e as Error).message, true);
    } finally {
      end();
    }
  }
  const nav = (v: View) => { setView(v); setModuleIndex(0); };
  const explore = () => { setModuleIndex(6); setView("analyzers"); };
  const filtered = entries.filter((e) => filter === "all" || (filter === "analysis" ? e.kind === "analysis" : e.kind === "preview"));

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="header-inner">
          <button className="home-logo" aria-label="PhaseLab: лаборатория" onClick={() => nav("lab")}><Logo /></button>
          <nav className="primary-nav" aria-label="Главная навигация">
            {([{ id: "lab", label: "Лаборатория", icon: PanelsTopLeft }, { id: "analyzers", label: "Анализаторы", icon: ScanLine }, { id: "history", label: "Журнал", icon: HistoryIcon }] as const).map((v) => (
              <button key={v.id} className={view === v.id ? "active" : ""} onClick={() => nav(v.id)} aria-current={view === v.id ? "page" : undefined}><v.icon size={15} />{v.label}</button>
            ))}
          </nav>
          <div className="header-end">
            <div className="engine-online"><i className={`dot ${online ? "mint" : "amber"}`} />{busy ? "DSP BUSY" : online ? "ENGINE ONLINE" : "LOCAL SNAPSHOT"}</div>
            <span className="cpu-chip"><Cpu size={12} />CPU</span>
            <span className="header-divider" />
            <button className="icon-btn settings-button" disabled={!!busy} title="Настройки сессии" aria-label="Настройки сессии" onClick={() => setModal("settings")}><Settings2 size={17} /></button>
          </div>
        </div>
      </header>
      <main className="lab-main">
        <section className="workspace-heading">
          <div className="title-stack">
            <div className="workspace-eyebrow"><span />AUDIO ENGINEERING WORKSPACE</div>
            <h1>{view === "lab" ? "Спектральная лаборатория" : view === "analyzers" ? "Измерительная стойка" : "Журнал сессии"}</h1>
            <div className="session-metadata"><FolderOpen size={12} /><button onClick={() => setModal("settings")}>{name}</button><i /><span>48 kHz</span><b>·</b><span>32-bit float</span><b>·</b><span>{r.duration.toFixed(1)} s</span><b>·</b><span>{r.channels.length} стем.</span></div>
          </div>
          <div className="heading-actions">
            <button className="btn secondary" onClick={() => void openPresets()}><BookmarkPlus size={14} />Отпечатки</button>
            <button className="btn secondary" onClick={() => setModal("export")}><Download size={14} />Экспорт</button>
            <button className={`btn primary analysis-trigger ${pending ? "pending" : ""}`} onClick={() => void analyze()} disabled={!!busy} title={pending ? "Ориентиры изменены: обновите анализ" : undefined}>
              {busy ? <LoaderCircle className="spin" size={15} /> : pending ? <Target size={15} /> : <ScanLine size={15} />}<span>{busy ? busy + "…" : pending ? "Анализ с ориентирами" : "Запустить анализ"}</span>
            </button>
          </div>
        </section>
        <MetricRack report={r} pending={pending} />
        <section className="extension-bar" aria-label="Дополнительные процессоры">
          <div className="extension-card">
            <button className={`extension-toggle ${extensions.dynamic ? "on" : ""}`} aria-pressed={extensions.dynamic} disabled={!!busy} onClick={() => void commitExtensions({ ...extensions, dynamic: !extensions.dynamic })}>Динамический фазовый EQ</button>
            <label>Глубина <b>{Math.round(depthUi * 100)}%</b>
              <input aria-label="Глубина динамического EQ" type="range" min="0" max="100" step="1" value={Math.round(depthUi * 100)} disabled={!extensions.dynamic || !!busy} onChange={(e) => setDepthUi(+e.target.value / 100)} onPointerUp={() => extensions.dynamic && Math.abs(depthUi - extensions.depth) > 0.001 && void commitExtensions({ ...extensions, depth: depthUi })} />
            </label>
          </div>
          <div className="extension-card">
            <button className={`extension-toggle ${extensions.ms ? "on" : ""}`} aria-pressed={extensions.ms} disabled={!!busy} onClick={() => void commitExtensions({ ...extensions, ms: !extensions.ms })}>Стерео Mid / Side</button>
            <span>{extensions.ms ? "Анализ и, если EQ включён, обработка раздельно" : "Обычное стерео"}</span>
          </div>
          <p>{extensions.dynamic ? `Ведущий подавляет только конфликтующую, фазово связанную часть ведомого. Пар: ${r.dynamic?.moves.length ?? 0}.` : "Блок выключен — микс звучит как сейчас, без динамического сайдчейна."}{r.dynamic?.moves.slice(0, 3).map((m) => <em key={m.leader + m.follower + m.hz}>{m.leader} → {m.follower} · {Math.round(m.hz)} Hz · {m.reductionDb} dB</em>)}</p>
        </section>
        {view === "lab" ? (
          <>
            <div className="section-divider"><span className="section-square" />Сигнальный мониторинг<i /><span className="snapshot-label"><span className={`dot ${live ? "mint" : "gray"}`} />{live ? "LIVE PLAYBACK" : "СНИМОК СЕССИИ"}</span></div>
            <div className="monitoring-grid">
              <StemsPanel report={r} selected={selected} onSelect={setSelected} onEdit={edit} onRemove={(id) => { setRemoveId(id); setModal("remove"); }} onInstructor={(id) => { setSelected(id); setInstructorId(id); setModal("instructor"); }} onToggle={(id, key) => void analyze(r.channels.map((c) => (c.id === id ? { ...c, [key]: !c[key] } : c)))} onImport={() => { setImportError(""); setModal("import"); }} disabled={!!busy} />
              {r.channels.length ? <Spectrum liveSpectrum={live?.spectrum} report={r} selected={selected} onSelect={setSelected} onFft={(f) => void analyze(r.channels, f)} onIssue={inspect} onFrequency={(f) => edit(selected, f)} busy={!!busy} anchors={anchors} onSaveAnchors={saveAnchors} /> : <section className="instrument empty-stage"><AudioLines size={32}/><h2>Загрузите ваши стемы</h2><p>Сессия пуста. Измерения начнутся после добавления первой дорожки.</p><button className="btn primary" onClick={() => setModal("import")}>+ Добавить WAV</button></section>}
              <PhasePanel report={r} live={live} />
            </div>
            {r.channels.length > 0 && <Diagnostics r={r} onIssue={inspect} onExplore={explore} onAgent={() => void agent()} busy={!!busy} />}
          </>
        ) : view === "analyzers" ? (
          <>
            <div className="section-divider"><span className="section-square" />Аналитический контур<i /><span>06 SOLO / 06 CROSS</span></div>
            {r.channels.length ? <AnalyzerDesk key={moduleIndex} r={r} initial={moduleIndex} onPreview={() => void agent()} /> : <div className="empty-stage"><p>Сначала загрузите дорожку через «+».</p></div>}
          </>
        ) : (
          <section className="instrument journal">
            <div className="panel-heading">
              <div className="heading-text"><HistoryIcon /><h2>Снимки и операции</h2><span className="count-badge">{entries.length + 1}</span></div>
              <select aria-label="Фильтр журнала" value={filter} onChange={(e) => setFilter(e.target.value)}><option value="all">Все события</option><option value="analysis">Измерения</option><option value="preview">Пробные рендеры</option></select>
            </div>
            <div className="journal-rows">
              {filtered.map((e) => (
                <div className="journal-row" key={e.id}>
                  <div className="journal-symbol">{e.kind === "preview" ? <Cpu size={17} /> : <Activity size={17} />}</div>
                  <div className="journal-copy">
                    <small>{new Date(e.createdAt).toISOString().slice(0, 19).replace("T", " ")} UTC · {e.kind.toUpperCase()}</small>
                    <b>{e.message}</b>
                    {e.details && e.details.length > 0 && (
                      <details><summary>Шаги агента ({e.details.length})</summary>{e.details.map((s, i) => <p key={i}>#{s.iteration} · {s.command.track} · {s.command.freq ? `${s.command.freq} Hz / ${s.command.gain} dB` : `φ ${s.command.phase}°`} · {s.before} → {s.after} · {s.accepted ? "принято" : "отклонено"}{s.note ? ` · ${s.note}` : ""}</p>)}</details>
                    )}
                  </div>
                  <span className="journal-score">{e.score}<small>/100</small></span>
                  <a className="icon-btn compact" href={`/api/audio?key=${e.take}&format=json&download=1`} download title="Скачать отчёт"><FileJson size={14} /></a>
                  <button className="btn secondary mini" disabled={!!busy || e.take === r.key} onClick={() => { setRestoreKey(e.take); setModal("restore"); }}>{e.take === r.key ? "Текущий" : "Восстановить"}</button>
                </div>
              ))}
              {filter === "all" && (
                <div className="journal-row">
                  <div className="journal-symbol"><FileAudio size={17} /></div>
                  <div className="journal-copy"><small>REFERENCE / 001</small><b>Эталонный снимок · 4 синтетических стема</b></div>
                  <span className="micro-tag">BASELINE</span>
                  <button className="btn secondary mini" disabled={r.key === "reference" || !!busy} onClick={() => { setRestoreKey("reference"); setModal("restore"); }}>{r.key === "reference" ? "Текущий" : "Восстановить"}</button>
                </div>
              )}
              {filter !== "all" && !filtered.length && <div className="empty-journal"><HistoryIcon size={25} /><b>В этой категории пока нет событий</b><p>Запустите измерение или пробный рендер в лаборатории.</p></div>}
            </div>
          </section>
        )}
        <div className="system-foot"><span><i className="dot mint" />{busy ? "DSP обрабатывает сигнал" : "DSP готов"}</span><i /><span>48 000 Hz</span><b>·</b><span>Float32</span><span className="sys-extra"><i />CPU рендеринг</span><button onClick={() => setModal("method")}><Info size={11} />Методика измерений</button></div>
      </main>
      <Transport report={r} audition={audition} baseline={baselineReady} onSelectTake={(take) => setAudition(take === "raw" && baselineReady ? { key: baselineReady.key, label: "ИСХОДНЫЙ", stamp: Date.now(), trimDb: Math.min(0, (r.meter.lufs ?? -70) - (baselineReady.meter.lufs ?? -70)) } : { key: r.key, label: "ОБРАБОТАННЫЙ", stamp: Date.now(), trimDb: Math.min(0, (baselineReady?.meter.lufs ?? -70) - (r.meter.lufs ?? -70)) })} preload={modal === "preview" && preview ? [r.key, preview.report.key, ...(baselineReady ? [baselineReady.key] : [])] : [r.key, ...(baselineReady ? [baselineReady.key] : [])]} onLive={setLive} onError={audioError} />
      {toast && <div className={`toast ${toast.error ? "error" : ""}`} role="status">{toast.error ? <TriangleAlert size={15} /> : <Check size={15} />}<span>{toast.message}</span></div>}
      {modal === "instructor" && <Dialog title={`Инструктор частот · ${r.channels.find((c) => c.id === instructorId)?.name}`} sub="PRE-LISTEN / PARAMETRIC EQ" onClose={finishInstructor} xl><AnchorInstructor report={r} initialId={instructorId} anchors={anchors} onSave={saveInstructorAnchors} onDone={finishInstructor} /></Dialog>}
      {modal === "anchorReview" && <Dialog title="Анализ с выбранными частотами" sub="LISTENER ANCHORS / RE-ANALYSIS" onClose={close} locked={!!busy}><div className="anchor-review"><div className="method-intro"><Target size={22} /><p>Точки сохранены как ориентиры. Звук пока не изменён. Проанализировать заново и перенастроить микс с учётом выбранных частот?</p></div><div className="review-track-list">{r.channels.filter((c) => anchorCount(anchors[c.id]) > 0).map((c) => <div key={c.id}><i className="dot" style={{ background: c.color }} /><b>{c.name}</b><span>{anchors[c.id]?.prefer.length ? <em className="good">▲ {anchors[c.id].prefer.map((a) => `${frequency(a.freq)} Hz`).join(" · ")}</em> : null}{anchors[c.id]?.avoid.length ? <em className="bad">▼ {anchors[c.id].avoid.map((a) => `${frequency(a.freq)} Hz`).join(" · ")}</em> : null}</span></div>)}{!r.channels.some((c) => anchorCount(anchors[c.id])) && <p className="muted-copy">Ориентиры не заданы — будет полный автоматический анализ.</p>}</div><p className="info-note">Полезные полосы защищаются от вырезов и освобождаются за счёт маскирующих инструментов. Нежелательные становятся донорами: вырезы и фазовые коррекции ложатся туда в первую очередь, а при совпадении с чужой полезной частотой уступает только отмеченный инструмент. После анализа вы снова услышите A/B.</p><div className="dialog-actions"><button className="btn secondary" onClick={close} disabled={!!busy}>Позже</button><button className="btn primary" onClick={() => void runAnchored()} disabled={!!busy}>{busy ? <LoaderCircle size={14} className="spin" /> : <ScanLine size={14} />}Да, анализ и перенастройка</button></div></div></Dialog>}
      {modal === "presets" && <Dialog title="Отпечатки микса" sub="SESSION / PRESETS" onClose={close} wide locked={!!busy}><Presets presets={presets} busy={!!busy} onSave={savePreset} onLoad={loadPreset} onDelete={deletePreset} /></Dialog>}
      {modal === "remove" && <Dialog title="Удалить дорожку из микса?" sub="TRACK / REMOVE" onClose={close} locked={!!busy}><p className="explanation">«{r.channels.find((c) => c.id === removeId)?.name}» исчезнет из текущего микса. Исходный WAV и старые снимки останутся доступны в журнале.</p><div className="dialog-actions"><button className="btn secondary" onClick={close}>Отмена</button><button className="btn amber-btn" disabled={!!busy} onClick={() => void analyze(r.channels.filter((c) => c.id !== removeId), r.fft, "Дорожка удалена из микса. Можно загрузить следующую.")}>Удалить дорожку</button></div></Dialog>}
      {modal === "settings" && <Dialog title="Параметры сессии" sub="SYSTEM / CONFIGURATION" onClose={close} locked={!!busy}><SettingsBody name={name} fft={r.fft} onSave={changeSettings} onReset={() => void restore("reference", "reset")} busy={!!busy} /></Dialog>}
      {modal === "export" && <Dialog title="Экспорт сессии" sub="RENDER / OUTPUT" onClose={close}><ExportBody r={r} /></Dialog>}
      {modal === "editor" && <Dialog title={`Инспектор · ${r.channels.find((c) => c.id === selected)?.name}`} sub="CHANNEL STRIP / ULTRA EQ" onClose={close} locked={!!busy}><ChannelEditor r={r} id={selected} initialFreq={freq} busy={!!busy} onSave={(ch) => void analyze(r.channels.map((c) => (c.id === ch.id ? ch : c)))} onRemove={(id) => void analyze(r.channels.filter((c) => c.id !== id), r.fft, "Канал удалён из сессии. Снимок сохранён.")} /></Dialog>}
      {modal === "issue" && issue && <Dialog title="Разбор конфликта" sub="DIAGNOSTICS" onClose={close}><IssueDetail z={issue} r={r} onPreview={() => void agent(issue.id)} busy={!!busy} /></Dialog>}
      {modal === "preview" && <Dialog title="Предпросмотр коррекций" sub="MIX ASSISTANT / A–B" onClose={close} wide locked={!!busy}><PreviewBody preview={preview} before={r} busy={!!busy} onApply={() => preview && void restore(preview.report.key, "apply")} onCancel={close} onListen={(key, label, trimDb) => setAudition({ key, label, trimDb, stamp: Date.now() })} listening={audition?.key} /></Dialog>}
      {modal === "import" && <Dialog title="Добавить дорожку в микс" sub="INPUT / AUDIO FILE" onClose={close} locked={!!busy}><ImportBody busy={!!busy} error={importError} onImport={(spec) => void importTrack(spec)} /></Dialog>}
      {modal === "restore" && <Dialog title="Восстановить снимок?" sub="HISTORY / RESTORE" onClose={close} locked={!!busy}><p className="explanation">Настройки каналов, EQ и мастер-рендер будут взяты из выбранного снимка. Ориентиры инструментов сохраняются отдельно и не откатываются.</p><div className="dialog-actions"><button className="btn secondary" onClick={close}>Отмена</button><button className="btn primary" onClick={() => void restore(restoreKey)} disabled={!!busy}><RotateCcw size={14} />Восстановить</button></div></Dialog>}
      {modal === "method" && (
        <Dialog title="Измерительная методика" sub="PHASELAB / TECHNICAL NOTES" onClose={close} wide>
          <div className="method-intro"><ShieldCheck size={23} /><p>Все показания рассчитаны по обработанным PCM-сэмплам. Прослушивание и экспорт используют тот же рендер.</p></div>
          {[
            ["Ориентиры слушателя", "Две частоты на инструмент, одна для саба. Подбираются на слух с компенсацией громкости и не изменяют звук. Агент защищает их: вырез, отнимающий больше 1 дБ в точке ориентира, сужается по Q или отклоняется. Затем агент освобождает полосу ориентира, ослабляя маскирующие стемы (до −4 дБ), и только после этого мягко подчёркивает её — не больше 60 % от подъёма при прослушивании и не выше +6 дБ. Цель — превышение полосы ориентира над суммой остальных стемов на 3 дБ (SMR)."],
            ["Конфликты по всему спектру", "Для каждой пары стемов в третьоктавах 40 Гц – 12,5 кГц ищутся полосы, где оба инструмента почти равны по уровню (разница < 4 дБ) и полоса существенна для обоих. Уступает тот, для кого полоса менее характерна с учётом роли. Шаг коррекции −2 дБ, предел −6 дБ."],
            ["Спектр и узкие пики", `Welch, окно Hann, FFT ${r.fft}, шаг ${r.binHz} Гц. Узкие резонансы проверяются по полной записи с шагом ${(48000 / (r.duration * 48000)).toFixed(2)} Гц.`],
            ["Громкость, фаза, решения", "LUFS — BS.1770 (pyloudnorm); True Peak — 4× передискретизация. Cxy = |Pxy|² / (Pxx · Pyy). Детерминированный агент принимает изменение только при измеренном улучшении и True Peak ≤ −1 dBTP. Пробный рендер не заменяет рабочую версию."],
          ].map(([h, p]) => <div className="method-item" key={h}><h3>{h}</h3><p>{p}</p></div>)}
        </Dialog>
      )}
    </div>
  );
}
