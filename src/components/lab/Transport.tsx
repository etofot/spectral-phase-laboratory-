"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Play, Pause, Square, Repeat2, Volume2, VolumeX, Headphones, ChevronDown, LoaderCircle } from "lucide-react";
import { Waveform } from "./Instruments";
import { timecode } from "@/lib/lab-types";
import type { LabReport } from "@/lib/lab-types";
import { TakePlayer } from "./take-player";

export type LiveSignal = { scope: number[][]; levels: number[]; spectrum: number[]; correlation: number };
export type Audition = { key: string; label: string; stamp: number; trimDb?: number };

export default function Transport({ report, audition, baseline, onSelectTake, preload = [], onLive, onError }: { report: LabReport; audition: Audition | null; baseline?: {key:string; meter:{lufs:number|null}} | null; onSelectTake?: (take: "raw" | "processed") => void; preload?: string[]; onLive: (s: LiveSignal | null) => void; onError: (s: string) => void }) {
  const player = useRef<TakePlayer | null>(null);
  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(false);
  const [pos, setPos] = useState(0);
  const [loop, setLoop] = useState(false);
  const [vol, setVol] = useState(-8);
  const [muted, setMuted] = useState(false);
  const [volOpen, setVolOpen] = useState(false);
  const take = audition?.key || report.key;
  const loopRef = useRef(loop);
  const wasAuditioning = useRef(false);
  const duration = report.duration;

  useEffect(() => {
    const p = new TakePlayer();
    player.current = p;
    p.onPosition = (s) => { setPlaying(s.playing); setLoading(s.loading); setPos(s.seconds); };
    p.onError = onError;
    const stop = () => p.pause();
    const otherMedia = (e: Event) => { if (e.target instanceof HTMLAudioElement) p.pause(); };
    window.addEventListener("phaselab:stop-master", stop);
    document.addEventListener("play", otherMedia, true);
    return () => { window.removeEventListener("phaselab:stop-master", stop); document.removeEventListener("play", otherMedia, true); p.dispose(); player.current = null; };
  }, [onError]);

  useEffect(() => { player.current?.setVolume(vol, muted); }, [vol, muted]);
  useEffect(() => { loopRef.current = loop; player.current?.setLoop(loop); }, [loop]);
  const preloadSignature = useRef("");
  useEffect(() => {
    const signature = preload.join("|");
    if (signature === preloadSignature.current) return;
    preloadSignature.current = signature;
    if (preload.length) player.current?.preload(preload);
  }, [preload]);

  useEffect(() => {
    const p = player.current;
    if (!p) return;
    if (!audition?.stamp) { p.stop(); onLive(null); wasAuditioning.current = false; return; }
    window.dispatchEvent(new Event("phaselab:stop-instructor"));
    void p.play(take, { keepPosition: wasAuditioning.current, trimDb: audition.trimDb ?? 0, loop: true });
    wasAuditioning.current = true;
  }, [take, audition?.stamp, audition?.trimDb, onLive]);

  useEffect(() => {
    if (!playing) { onLive(null); return; }
    let raf = 0, last = 0;
    const tick = (now: number) => {
      if (now - last > 95 && player.current) {
        setPos(player.current.seconds);
        onLive(player.current.spectrum());
        last = now;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, onLive]);

  const startMaster = useCallback((offset = 0) => {
    window.dispatchEvent(new Event("phaselab:stop-instructor"));
    void player.current?.play(report.key, { offset, trimDb: 0, loop: loopRef.current });
  }, [report.key]);
  const toggle = useCallback(() => {
    if (playing || loading) player.current?.pause();
    else if (audition) void player.current?.play(take, { offset: pos >= duration ? 0 : pos, trimDb: audition.trimDb ?? 0, loop: true });
    else startMaster(pos >= duration ? 0 : pos);
  }, [playing, loading, audition, take, pos, duration, startMaster]);
  const stop = () => player.current?.stop();

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (e.code === "Space" && !["INPUT", "SELECT", "TEXTAREA", "BUTTON", "A"].includes(tag) && !document.querySelector("dialog[open]")) { e.preventDefault(); toggle(); }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [toggle]);

  return (
    <footer className="transport" data-playing={playing} data-loading={loading} data-position={pos.toFixed(3)} data-source={take}>
      <div className="transport-controls">
        <button className={`play-button ${playing ? "playing" : ""}`} onClick={toggle} aria-label={playing || loading ? "Пауза" : "Воспроизвести микс"} title="Воспроизвести / пауза · Space">
          {loading ? <LoaderCircle size={16} className="spin" /> : playing ? <Pause size={16} fill="currentColor" /> : <Play size={16} fill="currentColor" />}
        </button>
        <button className="stop-button" onClick={stop} title="Стоп" aria-label="Стоп"><Square size={12} fill="currentColor" /></button>
        <button className={`loop-button ${loop ? "on" : ""}`} onClick={() => setLoop(!loop)} aria-label="Зациклить воспроизведение" aria-pressed={loop} title="Цикл"><Repeat2 size={17} /></button>
      </div>
      <div className="time-readout"><strong>{timecode(pos)}</strong><span>/ {timecode(duration)}</span></div>
      <div className="transport-wave" title="Перемотка">
        <Waveform data={report.wave} color="#4a5855" bars={230} />
        <div className="wave-progress" style={{ width: `${(pos / duration) * 100}%` }} />
        <input type="range" min="0" max={duration} step="0.001" value={Math.min(pos, duration)} aria-label="Позиция воспроизведения" onChange={(e) => {
          const seconds = +e.target.value;
          setPos(seconds);
          if (playing || audition) void player.current?.play(take, { offset: seconds, trimDb: audition?.trimDb ?? 0, loop: audition ? true : loop });
          else startMaster(seconds);
        }} />
      </div>
      {onSelectTake && <div className="take-switch" aria-label="Сравнение исходного и обработанного микса"><button aria-pressed={!!baseline && take === baseline.key} disabled={!baseline} title="Без EQ, фазы и динамического блока; громкость при сравнении согласована" onClick={() => onSelectTake("raw")}>А · Исходный</button><button aria-pressed={take === report.key} title="Текущая обработанная версия" onClick={() => onSelectTake("processed")}>Б · После</button></div>}
      <div className="transport-source"><i className={`dot ${playing ? "mint" : loading ? "amber" : "gray"}`} />{loading ? "ДЕКОДИРОВАНИЕ…" : audition?.label || "MASTER OUT"}</div>
      <div className="monitor-control">
        <button aria-label="Громкость мониторинга" className="monitor-trigger" onClick={() => setVolOpen(!volOpen)}><Headphones size={15} /><span>Мониторинг</span><ChevronDown size={11} /></button>
        {volOpen && <div className="volume-pop"><div className="tiny-reading"><b>Мониторинг</b><span>{muted ? "−∞" : vol} dB</span></div><div className="volume-row"><button className="icon-btn" aria-label="Отключить мониторинг" onClick={() => setMuted(!muted)}>{muted ? <VolumeX size={15} /> : <Volume2 size={15} />}</button><input aria-label="Уровень мониторинга" type="range" min="-48" max="0" step="1" value={vol} onChange={(e) => setVol(+e.target.value)} /></div></div>}
      </div>
    </footer>
  );
}
