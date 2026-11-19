"use client";

/** Immutable-take Web Audio player. No media-element src swapping, no aborted range requests. */
export type PlayerPosition = { seconds: number; duration: number; playing: boolean; loading: boolean };

export class TakePlayer {
  private ctx: AudioContext | null = null;
  private buffers = new Map<string, Promise<AudioBuffer>>();
  private source: AudioBufferSourceNode | null = null;
  private gain: GainNode | null = null;
  private monitor: GainNode | null = null;
  private fft: AnalyserNode | null = null;
  private split: ChannelSplitterNode | null = null;
  private stereo: AnalyserNode[] = [];
  private request = 0;
  private startedAt = 0;
  private offset = 0;
  private currentDuration = 5;
  private loop = false;
  private trim = 0;
  private currentKey = "";
  private volume = -8;
  private muted = false;
  private disposed = false;
  onPosition: (p: PlayerPosition) => void = () => {};
  onError: (message: string) => void = () => {};

  private context() {
    if (!this.ctx || this.ctx.state === "closed") {
      const ctx = new AudioContext({ sampleRate: 48000 });
      this.ctx = ctx;
      this.monitor = ctx.createGain();
      this.monitor.connect(ctx.destination);
      this.fft = ctx.createAnalyser();
      this.fft.fftSize = 8192;
      this.fft.smoothingTimeConstant = 0.65;
      this.fft.minDecibels = -120;
      this.fft.maxDecibels = 0;
      this.fft.connect(this.monitor);
      this.split = ctx.createChannelSplitter(2);
      this.split.connect(this.fft);
      this.stereo = [0, 1].map((i) => {
        const a = ctx.createAnalyser();
        a.fftSize = 1024;
        this.split!.connect(a, i);
        return a;
      });
      this.applyVolume();
    }
    return this.ctx;
  }

  private url(key: string) {
    return `/api/audio?key=${key}`;
  }

  preload(keys: string[]) {
    keys.forEach((key) => void this.buffer(key).catch(() => {}));
  }

  private buffer(key: string) {
    let pending = this.buffers.get(key);
    if (!pending) {
      pending = fetch(this.url(key))
        .then(async (res) => {
          if (!res.ok) throw new Error("Аудиоснимок недоступен");
          return res.arrayBuffer();
        })
        .then((data) => this.context().decodeAudioData(data.slice(0)));
      pending.catch(() => this.buffers.delete(key));
      this.buffers.set(key, pending);
    }
    return pending;
  }

  private applyVolume() {
    if (!this.ctx || !this.monitor) return;
    const value = this.muted ? 0 : 10 ** ((this.volume + this.trim) / 20);
    this.monitor.gain.setTargetAtTime(value, this.ctx.currentTime, 0.008);
  }

  setVolume(db: number, muted: boolean) {
    this.volume = db;
    this.muted = muted;
    this.applyVolume();
  }

  setTrim(db: number) {
    this.trim = db;
    this.applyVolume();
  }

  setLoop(loop: boolean) {
    this.loop = loop;
    if (this.source) this.source.loop = loop;
  }

  get seconds() {
    if (!this.ctx || !this.source) return this.offset;
    const t = this.ctx.currentTime - this.startedAt;
    return this.loop ? ((t % this.currentDuration) + this.currentDuration) % this.currentDuration : Math.min(this.currentDuration, Math.max(0, t));
  }

  async play(key: string, options: { offset?: number; keepPosition?: boolean; trimDb?: number; loop?: boolean } = {}) {
    const id = ++this.request;
    this.currentKey = key;
    const ctx = this.context();
    this.onPosition({ seconds: this.seconds, duration: this.currentDuration, playing: false, loading: true });
    try {
      await ctx.resume();
      const buffer = await this.buffer(key);
      if (id !== this.request || this.disposed) return;
      const wasPlaying = !!this.source;
      const previous = this.seconds;
      this.halt(0.018);
      const duration = buffer.duration;
      const offset = options.keepPosition && wasPlaying ? previous % duration : (options.offset ?? 0) % duration;
      const loop = options.loop ?? this.loop;
      const source = ctx.createBufferSource();
      const gain = ctx.createGain();
      source.buffer = buffer;
      source.loop = loop;
      gain.gain.setValueAtTime(0, ctx.currentTime);
      gain.gain.linearRampToValueAtTime(1, ctx.currentTime + 0.018);
      source.connect(gain);
      gain.connect(this.split!);
      const start = ctx.currentTime + 0.025;
      source.start(start, offset);
      this.source = source;
      this.gain = gain;
      this.startedAt = start - offset;
      this.offset = offset;
      this.currentDuration = duration;
      this.loop = loop;
      this.trim = options.trimDb ?? this.trim;
      this.applyVolume();
      source.onended = () => {
        if (this.source === source && !loop) {
          this.offset = duration;
          this.source = null;
          this.onPosition({ seconds: duration, duration, playing: false, loading: false });
        }
      };
      this.onPosition({ seconds: offset, duration, playing: true, loading: false });
    } catch (e) {
      if (id !== this.request || this.disposed) return;
      this.onPosition({ seconds: this.offset, duration: this.currentDuration, playing: false, loading: false });
      this.onError(e instanceof Error ? e.message : "Не удалось воспроизвести аудио");
    }
  }

  pause() {
    this.offset = this.seconds;
    this.request++;
    this.halt(0.015);
    this.onPosition({ seconds: this.offset, duration: this.currentDuration, playing: false, loading: false });
  }

  stop() {
    this.request++;
    this.offset = 0;
    this.halt(0.015);
    this.onPosition({ seconds: 0, duration: this.currentDuration, playing: false, loading: false });
  }

  seek(seconds: number) {
    this.offset = Math.max(0, Math.min(this.currentDuration, seconds));
    if (this.source && this.currentKey) void this.play(this.currentKey, { offset: this.offset, trimDb: this.trim, loop: this.loop });
    else this.onPosition({ seconds: this.offset, duration: this.currentDuration, playing: false, loading: false });
  }

  private halt(fade = 0.01) {
    if (!this.ctx) return;
    const source = this.source, gain = this.gain;
    this.source = null;
    this.gain = null;
    if (!source) return;
    const t = this.ctx.currentTime;
    if (gain) {
      gain.gain.cancelScheduledValues(t);
      gain.gain.setTargetAtTime(0, t, Math.max(0.002, fade / 3));
    }
    try {
      source.stop(t + fade + 0.015);
    } catch {}
    source.onended = null;
  }

  spectrum(): { scope: number[][]; levels: number[]; spectrum: number[]; correlation: number } | null {
    if (!this.ctx || !this.fft || !this.source) return null;
    const values = this.stereo.map((an) => {
      const a = new Float32Array(an.fftSize);
      an.getFloatTimeDomainData(a);
      return a;
    });
    const levels = values.map((a) => 20 * Math.log10(Math.max(0.00001, ...a.map(Math.abs))));
    const peak = Math.max(0.01, ...values[0].map(Math.abs), ...values[1].map(Math.abs));
    const scope = Array.from({ length: 256 }, (_, i) => [values[0][i * 3] / peak, values[1][i * 3] / peak]);
    const bins = new Float32Array(this.fft.frequencyBinCount);
    this.fft.getFloatFrequencyData(bins);
    const spectrum = Array.from({ length: 256 }, (_, i) => Math.max(-120, bins[Math.min(bins.length - 1, Math.round((20 * 1000 ** (i / 255) * this.fft!.fftSize) / this.ctx!.sampleRate))]));
    let lr = 0, ll = 0, rr = 0;
    for (let i = 0; i < values[0].length; i++) {
      lr += values[0][i] * values[1][i];
      ll += values[0][i] ** 2;
      rr += values[1][i] ** 2;
    }
    return { scope, levels, spectrum, correlation: lr / Math.sqrt(Math.max(ll * rr, 1e-20)) };
  }

  dispose() {
    this.disposed = true;
    this.request++;
    this.halt(0);
    this.buffers.clear();
    void this.ctx?.close();
  }
}
