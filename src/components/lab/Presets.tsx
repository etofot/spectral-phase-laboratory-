"use client";
import { useState } from "react";
import { BookmarkPlus, RotateCcw, Trash2, Save, Fingerprint, AudioLines, ShieldCheck } from "lucide-react";

export type Preset = { id: number; name: string; fingerprint: string; content: { channels: { id: string; name: string }[]; anchors?: Record<string, unknown>; extensions?: { dynamic: boolean; depth: number; ms: boolean }; fft: number }; createdAt: string };

export default function Presets({ presets, busy, onSave, onLoad, onDelete }: { presets: Preset[]; busy: boolean; onSave: (name: string) => Promise<void>; onLoad: (id: number) => Promise<void>; onDelete: (id: number) => Promise<void> }) {
  const [name, setName] = useState("");
  const [confirm, setConfirm] = useState<number | null>(null);
  return <div className="preset-manager">
    <div className="preset-intro"><Fingerprint size={22} /><div><b>Отпечаток микса</b><p>Дорожки, EQ, фаза, ориентиры и режимы обработки. Звук не дублируется: исходные WAV должны остаться на компьютере вместе с папкой данных.</p></div></div>
    <label className="field">Название пресета<input value={name} maxLength={80} onChange={(e) => setName(e.target.value)} placeholder="Например, Вокал впереди / тёплый бас" /></label>
    <button className="btn primary full" disabled={busy || !name.trim()} onClick={async () => { await onSave(name.trim()); setName(""); }}><Save size={14} />Сохранить отпечаток текущего микса</button>
    <div className="preset-list-title"><BookmarkPlus size={14} />Сохранённые пресеты <span>{presets.length}</span></div>
    {!presets.length && <p className="muted-copy">Пресетов пока нет. Сохраните рабочую версию — к ней можно будет вернуться после экспериментов.</p>}
    <div className="preset-list">{presets.map((p) => <div className="preset-item" key={p.id}><div className="preset-item-title"><b>{p.name}</b><small>#{p.fingerprint}</small></div><div className="preset-item-meta"><AudioLines size={12} />{p.content.channels.length} стем. · FFT {p.content.fft} · {p.content.extensions?.dynamic ? `Dynamic ${Math.round(p.content.extensions.depth * 100)}%` : "Dynamic off"} · {p.content.extensions?.ms ? "M/S" : "L/R"}</div><p>{p.content.channels.map((c) => c.name).join(" · ") || "Пустой микс"}</p><div className="preset-item-actions"><button className="btn secondary mini" disabled={busy} onClick={() => onLoad(p.id)}><RotateCcw size={12} />Восстановить и измерить</button>{confirm === p.id ? <><span>Удалить пресет?</span><button className="btn amber-btn mini" disabled={busy} onClick={() => { void onDelete(p.id); setConfirm(null); }}>Да</button><button className="btn secondary mini" onClick={() => setConfirm(null)}>Нет</button></> : <button className="preset-trash" title="Удалить пресет" aria-label={`Удалить пресет ${p.name}`} disabled={busy} onClick={() => setConfirm(p.id)}><Trash2 size={13} /></button>}</div></div>)}</div>
    <div className="info-note"><ShieldCheck size={14} /><span>Восстановление проверяет наличие каждого WAV и делает новый измеренный снимок. Если исходник пропал, сессия не изменится.</span></div>
  </div>;
}
