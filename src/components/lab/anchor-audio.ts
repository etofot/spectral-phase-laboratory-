"use client";
import type { Band } from "@/lib/lab-types";

export type AuditionSpec = {
  take: string;
  focus: string;
  context: string[];
  points: Band[];
  bypass: boolean;
  compensationDb: number;
  loopStart?: number;
  loopLength?: number;
};
type Live = {
  ctx: AudioContext;
  sources: AudioBufferSourceNode[];
  filters: BiquadFilterNode[];
  focus: GainNode;
  master: GainNode;
  analyser: AnalyserNode;
  startedAt: number;
  duration: number;
};

/** Remove loop-boundary clicks with a 20 ms equal-power crossfade. */
function loopBuffer(ctx: AudioContext, source: AudioBuffer, start: number, wanted: number) {
  const offset = Math.max(0, Math.min(start, Math.max(0, source.duration - 0.05)));
  const length = Math.min(wanted, source.duration - offset);
  const fade = Math.min(0.02, length / 10);
  const frames = Math.max(1, Math.floor((length - fade) * source.sampleRate));
  const xf = Math.max(1, Math.floor(fade * source.sampleRate));
  const first = Math.floor(offset * source.sampleRate);
  const out = ctx.createBuffer(source.numberOfChannels, frames, source.sampleRate);
  for (let ch = 0; ch < source.numberOfChannels; ch++) {
    const input = source.getChannelData(ch), output = out.getChannelData(ch);
    for (let i = 0; i < frames; i++) {
      if (i < xf) {
        const x = i / xf, a = Math.cos((x * Math.PI) / 2), b = Math.sin((x * Math.PI) / 2);
        output[i] = input[first + i] * a + input[first + frames + i] * b;
      } else output[i] = input[first + i];
    }
  }
  return out;
}

/** Live parametric EQ on decoded stems. Filter nodes survive every point drag. */
export class AnchorAudition {
  private ctx: AudioContext | null = null;
  private take = "";
  private buffers = new Map<string, Promise<AudioBuffer>>();
  private live: Live | null = null;
  private position = 0;
  private request = 0;
  private disposed = false;
  private stopListener = () => this.stop();
  onChange: (playing: boolean) => void = () => {};

  constructor() {
    if (typeof window !== "undefined") window.addEventListener("phaselab:stop-instructor", this.stopListener);
  }

  get playing() { return this.live !== null; }

  private context() {
    if (!this.ctx || this.ctx.state === "closed") this.ctx = new AudioContext({ sampleRate: 48000, latencyHint: "interactive" });
    return this.ctx;
  }

  private buffer(take: string, id: string) {
    if (take !== this.take) { this.buffers.clear(); this.take = take; }
    let pending = this.buffers.get(id);
    if (!pending) {
      pending = fetch(`/api/audio?key=${take}&track=${id}`)
        .then(async (res) => { if (!res.ok) throw new Error("Стем недоступен"); return res.arrayBuffer(); })
        .then((data) => this.context().decodeAudioData(data.slice(0)));
      pending.catch(() => this.buffers.delete(id));
      this.buffers.set(id, pending);
    }
    return pending;
  }

  preload(take: string, ids: string[]) { ids.forEach((id) => void this.buffer(take, id).catch(() => {})); }

  async play(spec: AuditionSpec) {
    const id = ++this.request;
    window.dispatchEvent(new Event("phaselab:stop-master"));
    document.querySelectorAll("audio").forEach((a) => !a.paused && a.pause());
    const ctx = this.context();
    try {
      await ctx.resume();
      const ids = [spec.focus, ...spec.context.filter((x) => x !== spec.focus)];
      const buffers = await Promise.all(ids.map((x) => this.buffer(spec.take, x)));
      if (id !== this.request || this.disposed) return;
      const wasPlaying = !!this.live;
      const previous = this.position;
      this.halt(false, 0.018);
      const master = ctx.createGain();
      master.gain.value = 0.7;
      master.connect(ctx.destination);
      const focus = ctx.createGain();
      const filters = [0, 1].map(() => { const f = ctx.createBiquadFilter(); f.type = "peaking"; return f; });
      filters[0].connect(filters[1]);
      filters[1].connect(focus);
      focus.connect(master);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 8192;
      analyser.smoothingTimeConstant = 0.65;
      analyser.minDecibels = -120;
      analyser.maxDecibels = 0;
      focus.connect(analyser);
      const wanted = Math.max(0.1, spec.loopLength ?? buffers[0].duration);
      const loop = loopBuffer(ctx, buffers[0], spec.loopStart ?? 0, wanted);
      const duration = loop.duration;
      const offset = wasPlaying ? previous % duration : Math.min(this.position, duration - 0.001);
      const start = ctx.currentTime + 0.025;
      const sources = buffers.map((buf, i) => {
        const s = ctx.createBufferSource();
        s.buffer = i === 0 ? loop : loopBuffer(ctx, buf, spec.loopStart ?? 0, wanted);
        s.loop = true;
        s.connect(i === 0 ? filters[0] : master);
        s.start(start, Math.max(0, offset));
        return s;
      });
      this.live = { ctx, sources, filters, focus, master, analyser, startedAt: start - offset, duration };
      this.update(spec.points, spec.bypass, spec.compensationDb, true);
      this.onChange(true);
    } catch (e) {
      if (id !== this.request) return;
      this.onChange(false);
      throw e;
    }
  }

  update(points: Band[], bypass: boolean, compensationDb: number, instant = false) {
    const l = this.live;
    if (!l) return;
    const t = l.ctx.currentTime, k = instant ? 0.001 : 0.012;
    l.filters.forEach((f, i) => {
      const p = points[i];
      f.frequency.setTargetAtTime(p?.freq ?? 1000, t, k);
      f.Q.setTargetAtTime(p?.q ?? 1, t, k);
      f.gain.setTargetAtTime(!bypass && p ? p.gain : 0, t, k);
    });
    l.focus.gain.setTargetAtTime(bypass ? 1 : 10 ** (compensationDb / 20), t, k);
  }

  spectrum(): number[] | null {
    const l = this.live;
    if (!l) return null;
    const bins = new Float32Array(l.analyser.frequencyBinCount);
    l.analyser.getFloatFrequencyData(bins);
    return Array.from({ length: 256 }, (_, i) => Math.max(-120, bins[Math.min(bins.length - 1, Math.round((20 * 1000 ** (i / 255) * l.analyser.fftSize) / l.ctx.sampleRate))]));
  }

  get seconds() {
    const l = this.live;
    if (!l) return this.position;
    const t = l.ctx.currentTime - l.startedAt;
    return ((t % l.duration) + l.duration) % l.duration;
  }

  private halt(notify: boolean, fade = 0.012) {
    const l = this.live;
    if (!l) return;
    this.position = (l.ctx.currentTime - l.startedAt) % l.duration;
    this.live = null;
    const t = l.ctx.currentTime;
    l.master.gain.cancelScheduledValues(t);
    l.master.gain.setTargetAtTime(0, t, Math.max(0.002, fade / 3));
    l.sources.forEach((s) => { try { s.stop(t + fade + 0.02); } catch {} });
    window.setTimeout(() => { try { l.master.disconnect(); } catch {} }, 120);
    if (notify) this.onChange(false);
  }

  stop() { this.request++; this.halt(true); }

  dispose() {
    this.disposed = true;
    this.request++;
    this.halt(false, 0);
    this.buffers.clear();
    if (typeof window !== "undefined") window.removeEventListener("phaselab:stop-instructor", this.stopListener);
    void this.ctx?.close();
    this.ctx = null;
  }
}
