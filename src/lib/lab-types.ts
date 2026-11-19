export type Role = "drums" | "bass" | "sub" | "melodic" | "vocal";
export const ROLES: { id: Role; label: string; hint: string }[] = [
  { id: "melodic", label: "Инструмент", hint: "гитара, клавиши, синт" },
  { id: "vocal", label: "Вокал", hint: "голос, бэк-вокал" },
  { id: "drums", label: "Ударные", hint: "бочка, перкуссия" },
  { id: "bass", label: "Бас", hint: "бас-гитара, басовая партия" },
  { id: "sub", label: "Саб", hint: "одна опорная частота" },
];
export type Band = { freq: number; gain: number; q: number };
/** A listener's tonal anchor: an analysis target, never rendered as processing. */
export type Anchor = Band;
/** prefer: up to 2 (sub 1) bands to protect and clear; avoid: up to 2 bands this stem may give away. */
export type AnchorSet = { prefer: Anchor[]; avoid: Anchor[] };
export type AnchorMap = Record<string, AnchorSet>;
export const emptyAnchors = (): AnchorSet => ({ prefer: [], avoid: [] });
export const anchorCount = (a?: AnchorSet) => (a?.prefer.length ?? 0) + (a?.avoid.length ?? 0);
export type Channel = {
  id: string;
  name: string;
  color: string;
  role?: Role;
  offset?: number;
  gain: number;
  phase: number;
  bands: Band[];
  phaseBands?: { low: number; high: number; deg: number }[];
  muted: boolean;
  solo: boolean;
};
export type Meter = { lufs: number | null; truePeak: number; rms: number; crest: number; lra: number | null; shortMax?: number | null };
export type TrackInfo = Meter & {
  peakSpectrum: number[];
  spectrum: number[];
  thirdOctave: { hz: number; db: number }[];
  peaks: { hz: number; db: number }[];
  resolution: number;
  centroid: number;
  wave: number[];
  envelope: { attackMs: number; decayMs: number; sustain: number; transientRatio: number };
  phase: { correlation: number; lowCorrelation: number; highCorrelation: number; groupDelayLRMs: number | null; stability: number; trace: number[] };
  harmonics: { f0: number | null; harmonicEnergyRatio: number | null; even: number | null; odd: number | null; subharmonicRatio: number };
  crestBands: { lo: number; hi: number; crest: number }[];
  stereo: { midDb: number; sideDb: number; width: number };
  domains?: Record<"left" | "right" | "mid" | "side", { active: boolean; rmsDb: number | null; peakDb: number | null; spectrum: number[] }> & { lrCorrelation: number };
};
export type Command = { track: string; phase?: number; freq?: number; gain?: number; q?: number };
export type IssueType = "phase" | "resonance" | "priority" | "avoid" | "masking" | "clash";
export type Issue = {
  id: string;
  type: IssueType;
  title: string;
  severity: "high" | "medium" | "low";
  tracks: string[];
  hz: number;
  endHz: number;
  value: number;
  unit: string;
  reason: string;
  command: Command | null;
  phase?: number;
  coherence?: number;
  penalty: number;
  metrics?: [string, string][];
  zoom?: { freqs: number[]; lines: Record<string, number[]>; resolution: number };
};
export type PriorityRow = { track: string; index: number; freq: number; gain: number; q: number; ownDb: number; restDb: number | null; smr: number; masker: string | null; clear: boolean };
export type AvoidRow = { track: string; index: number; kind: "avoid"; freq: number; gain: number; q: number; ownDb: number; shareDb: number; cutDb: number; settled: boolean };
export type PlanRow = { keep: string; give: string; hz: number; note: string };
export type Priorities = { rows: PriorityRow[]; avoidRows?: AvoidRow[]; plan?: PlanRow[]; target: number; score: number | null; clear: number; total: number; avoidTotal?: number; avoidSettled?: number };
export type Pair = {
  validBins: number;
  a: string;
  b: string;
  coherence: number;
  hz: number;
  phase: number;
  loss: number;
  lagSamples: number;
  lagMs: number;
  sumDb: number;
  diffDb: number;
  bands: { lo: number; hi: number; loss: number; sumDb?: number; diffDb?: number; alignedLoss?: number }[];
  coherentBins: number[];
};
export type LabReport = {
  key: string;
  sampleRate: number;
  duration: number;
  fft: number;
  binHz: number;
  score: number;
  channels: Channel[];
  anchors?: AnchorMap;
  priorities?: Priorities;
  meter: Meter;
  correlation: number;
  issues: Issue[];
  trackInfo: Record<string, TrackInfo>;
  scope: number[][];
  wave: number[];
  heatmap: number[][];
  traces: { energy: number[]; peak: number[]; correlation: number[] };
  masterLR: number[];
  pairs: Pair[];
  lowEnd: { peakDb: number; rmsDb: number; headroom: number };
  masking: { a: string; b: string; overlap: number; aDominates: number; windowMs: number }[];
  stereo: { midDb: number; sideDb: number; width: number };
  stereoCross: { side: string; mid: string; overlap: number }[];
  dynamic?: { enabled: boolean; depth: number; ms: boolean; moves: DynamicMove[] };
  msReport?: MsReport;
};
export type AgentStep = {
  iteration: number;
  issue: string;
  type?: IssueType;
  reason: string;
  command: Command;
  headroomTrim: number;
  before: number;
  after: number;
  peakBefore: number;
  peakAfter: number;
  accepted: boolean;
  note?: string;
};
export type Preview = { before: number; beforePriorities?: Priorities; report: LabReport; steps: AgentStep[]; runId?: string };
export type Extensions = { dynamic: boolean; depth: number; ms: boolean };
export const DEFAULT_EXTENSIONS: Extensions = { dynamic: false, depth: 0.55, ms: false };
export type DynamicMove = { leader: string; follower: string; hz: number; reductionDb: number; active: number; domain?: string };
export type MsConflict = { a: string; b: string; hz: number; gap: number; coherence?: number; phaseDeg?: number };
export type MsReport = { widths: { id: string; midDb: number; sideDb: number }[]; left: MsConflict[]; right: MsConflict[]; mid: MsConflict[]; side: MsConflict[] };

export type HistoryEntry = { id: number; kind: string; message: string; take: string; score: number; createdAt: string; details: AgentStep[] | null };

const DEFAULT_ROLES: Record<string, Role> = { kick: "drums", bass_guitar: "bass", sub_synth: "sub", lead_synth: "melodic" };
export const roleOf = (c: Pick<Channel, "id" | "role">): Role => c.role ?? DEFAULT_ROLES[c.id] ?? "melodic";
export const anchorLimit = (role: Role, kind: "prefer" | "avoid" = "prefer") => (kind === "prefer" && role === "sub" ? 1 : 2);

/** RBJ peaking-EQ magnitude in dB, identical to the Python engine and Web Audio. */
export function peakingDb(f: number, f0: number, gain: number, q: number, sr = 48000) {
  const A = 10 ** (gain / 40), w0 = (2 * Math.PI * f0) / sr, al = Math.sin(w0) / (2 * q), c = Math.cos(w0);
  const b0 = 1 + al * A, b1 = -2 * c, b2 = 1 - al * A, a0 = 1 + al / A, a1 = -2 * c, a2 = 1 - al / A;
  const w = (2 * Math.PI * f) / sr, cr = Math.cos(w), ci = -Math.sin(w), c2r = Math.cos(2 * w), c2i = -Math.sin(2 * w);
  const nr = b0 + b1 * cr + b2 * c2r, ni = b1 * ci + b2 * c2i, dr = a0 + a1 * cr + a2 * c2r, di = a1 * ci + a2 * c2i;
  return 10 * Math.log10((nr * nr + ni * ni) / Math.max(dr * dr + di * di, 1e-30));
}
export const curveDb = (f: number, points: Band[]) => points.reduce((s, p) => s + peakingDb(f, p.freq, p.gain, p.q), 0);

export function frequency(n: number) {
  return n >= 1000 ? `${+(n / 1000).toFixed(2)}k` : `${+n.toFixed(1)}`;
}
export function signed(n: number, dec = 1) {
  return `${n > 0 ? "+" : ""}${n.toFixed(dec)}`.replace("-", "−");
}
export function value(n: number | null | undefined, dec = 1) {
  return n == null ? "—" : n.toFixed(dec).replace("-", "−");
}
export function timecode(seconds: number) {
  return `00:${Math.floor(seconds).toString().padStart(2, "0")}.${Math.floor((seconds * 1000) % 1000).toString().padStart(3, "0")}`;
}
