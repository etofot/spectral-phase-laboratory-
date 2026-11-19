import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { db } from "@/db";
import { labState, labHistory, labAnchors, labExtensions } from "@/db/schema";
import { desc, eq, sql } from "drizzle-orm";
import type { Anchor, AnchorMap, AnchorSet, Channel, Extensions, LabReport, AgentStep, Role } from "./lab-types";
import { DEFAULT_EXTENSIONS } from "./lab-types";
import { anchorLimit, roleOf } from "./lab-types";

export const ROOT = process.cwd();
const PY = process.env.PYTHON_BIN || "python3";
const DEPS = path.join(ROOT, ".pydeps");
const ROLE_IDS: Role[] = ["drums", "bass", "sub", "melodic", "vocal"];

export const validId = (v: unknown): v is string => typeof v === "string" && /^(kick|bass_guitar|sub_synth|lead_synth|u_[a-f0-9]{20})$/.test(v);
export function takePath(key: unknown) {
  if (typeof key !== "string" || !/^(reference|[a-f0-9]{20})$/.test(key)) throw new Error("Неизвестный снимок");
  return key === "reference" ? path.join(ROOT, "data", "reference") : path.join(/*turbopackIgnore: true*/ ROOT, ".lab-data", "renders", key);
}
export async function readTake(key: unknown): Promise<LabReport> {
  return JSON.parse(await readFile(/*turbopackIgnore: true*/ path.join(takePath(key), "report.json"), "utf8"));
}
function bounded(n: unknown, lo: number, hi: number) {
  if (typeof n !== "number" || !Number.isFinite(n) || n < lo || n > hi) throw new Error("Параметр вне допустимого диапазона");
  return n;
}
export function validate(channels: unknown, fft: unknown): { channels: Channel[]; fft: number } {
  if (!Array.isArray(channels) || channels.length > 24) throw new Error("Сессия поддерживает 0–24 стема");
  if (![4096, 8192, 16384, 32768].includes(Number(fft))) throw new Error("Недопустимый размер FFT");
  if (new Set(channels.map((s) => s?.id)).size !== channels.length) throw new Error("Каналы не должны повторяться");
  const result = channels.map((s) => {
    if (!validId(s.id) || !Array.isArray(s.bands) || s.bands.length > 64 || typeof s.name !== "string" || !s.name.trim() || !/^#[0-9a-f]{6}$/i.test(s.color)) throw new Error("Некорректная конфигурация канала");
    return {
      id: s.id, name: s.name.trim().slice(0, 48), color: s.color, muted: !!s.muted, solo: !!s.solo,
      role: ROLE_IDS.includes(s.role) ? (s.role as Role) : roleOf({ id: s.id }),
      offset: s.offset == null ? 0 : bounded(s.offset, 0, 3600),
      phase: bounded(s.phase, -180, 180), gain: bounded(s.gain, -36, 12),
      bands: s.bands.map((b: Record<string, unknown>) => ({ freq: bounded(b.freq, 15, 22000), gain: bounded(b.gain, -30, 12), q: bounded(b.q, 0.1, 50) })),
      phaseBands: Array.isArray(s.phaseBands) ? s.phaseBands.slice(0, 8).map((b: Record<string, unknown>) => ({ low: bounded(b.low, 15, 22000), high: bounded(b.high, 15, 22000), deg: bounded(b.deg, -180, 180) })) : [],
    };
  });
  return { channels: result, fft: Number(fft) };
}
function cleanList(list: unknown, role: Role, kind: "prefer" | "avoid"): Anchor[] {
  if (list == null) return [];
  if (!Array.isArray(list)) throw new Error("Некорректный список ориентиров");
  const max = anchorLimit(role, kind);
  if (list.length > max) throw new Error(kind === "prefer" ? (role === "sub" ? "Для саба доступна одна опорная частота" : "Не более двух полезных частот на инструмент") : "Не более двух нежелательных частот на инструмент");
  return list.map((a) => ({
    freq: Math.round(bounded(a?.freq, 20, 20000) * 10) / 10,
    gain: kind === "prefer" ? Math.round(bounded(a?.gain, 0, 12) * 10) / 10 : Math.round(bounded(a?.gain, -18, 0) * 10) / 10,
    q: Math.round(bounded(a?.q, 0.3, 12) * 100) / 100,
  }));
}
/** Accepts the legacy array form (prefer only) and the {prefer, avoid} form. */
export function cleanAnchors(input: unknown, role: Role): AnchorSet {
  if (Array.isArray(input)) return { prefer: cleanList(input, role, "prefer"), avoid: [] };
  const o = (input ?? {}) as Record<string, unknown>;
  return { prefer: cleanList(o.prefer, role, "prefer"), avoid: cleanList(o.avoid, role, "avoid") };
}
function normalise(stored: unknown, role: Role): AnchorSet {
  try {
    return cleanAnchors(stored, role);
  } catch {
    return { prefer: [], avoid: [] };
  }
}
export async function anchorsFor(channels: Channel[]): Promise<AnchorMap> {
  const rows = await db.select().from(labAnchors);
  const out: AnchorMap = {};
  for (const row of rows) {
    const ch = channels.find((c) => c.id === row.channelId);
    if (!ch) continue;
    const set = normalise(row.anchors, roleOf(ch));
    if (set.prefer.length || set.avoid.length) out[row.channelId] = set;
  }
  return out;
}
export async function saveAnchors(id: string, anchors: AnchorSet) {
  if (!anchors.prefer.length && !anchors.avoid.length) await db.delete(labAnchors).where(eq(labAnchors.channelId, id));
  else await db.insert(labAnchors).values({ channelId: id, anchors }).onConflictDoUpdate({ target: labAnchors.channelId, set: { anchors, updatedAt: sql`now()` } });
}

let deps: Promise<void> | null = null;
/** DSP packages live inside the project (.pydeps), so a fresh runtime can bootstrap itself. */
function ensureDeps() {
  if (existsSync(/*turbopackIgnore: true*/ path.join(DEPS, "numpy")) && existsSync(/*turbopackIgnore: true*/ path.join(DEPS, "pyloudnorm"))) return Promise.resolve();
  deps ??= new Promise<void>((resolve, reject) => {
    const child = spawn(/*turbopackIgnore: true*/ PY, ["-m", "pip", "install", "--quiet", "--disable-pip-version-check", "--target", DEPS, "-r", path.join(ROOT, "requirements-runtime.txt")], { cwd: ROOT, env: { ...process.env, PIP_BREAK_SYSTEM_PACKAGES: "1" }, stdio: ["ignore", "ignore", "pipe"] });
    let err = "";
    const timer = setTimeout(() => child.kill("SIGKILL"), 420000);
    child.stderr.on("data", (d) => (err = (err + d.toString()).slice(-1500)));
    child.on("error", (e) => { clearTimeout(timer); reject(e); });
    child.on("close", (code) => { clearTimeout(timer); if (code === 0) resolve(); else { console.error("DSP bootstrap:", err); reject(new Error("Не удалось установить DSP-зависимости Python. Проверьте сеть или выполните pip install --target .pydeps -r requirements-runtime.txt")); } });
  }).catch((e) => { deps = null; throw e; });
  return deps;
}

let jobs = 0;
const waiting: Array<() => void> = [];
async function reserveWorker() {
  if (jobs < 2 && !waiting.length) { jobs++; return; }
  await new Promise<void>((resolve) => waiting.push(resolve));
  // A released worker has reserved this slot for us.
}
export async function python<T>(input: object): Promise<T> {
  await reserveWorker();
  try {
    await ensureDeps();
    return await new Promise<T>((resolve, reject) => {
      const env = { ...process.env, PYTHONPATH: [DEPS, process.env.PYTHONPATH].filter(Boolean).join(path.delimiter), OPENBLAS_NUM_THREADS: "1", OMP_NUM_THREADS: "1", PYTHONDONTWRITEBYTECODE: "1" };
      const child = spawn(/*turbopackIgnore: true*/ PY, ["agent/agent_loop.py", "--stdin"], { cwd: ROOT, env, stdio: ["pipe", "pipe", "pipe"] });
      let out = "", err = "";
      const timer = setTimeout(() => child.kill("SIGKILL"), 175000);
      child.stdout.on("data", (d) => { out += d.toString(); if (out.length > 12000000) child.kill(); });
      child.stderr.on("data", (d) => { err = (err + d.toString()).slice(-3500); });
      child.on("error", (e) => { clearTimeout(timer); reject(e); });
      child.on("close", (code) => {
        clearTimeout(timer);
        if (code !== 0) {
          console.error("DSP renderer:", err);
          const known = /ValueError: (.+)/.exec(err)?.[1];
          reject(new Error(known && /[А-Яа-я]/.test(known) ? known : "Не удалось обработать аудио. Проверьте формат WAV и доступность CPU-движка."));
        } else {
          try { resolve(JSON.parse(out)); } catch { reject(new Error("Некорректный ответ измерителя")); }
        }
      });
      child.stdin.on("error", () => {});
      child.stdin.end(JSON.stringify(input));
    });
  } finally {
    const next = waiting.shift();
    if (next) next();
    else jobs--;
  }
}
export async function ensureWorkspace() {
  await db.insert(labState).values({ id: 1 }).onConflictDoNothing();
  return (await db.select().from(labState).where(eq(labState.id, 1)))[0];
}
export async function readExtensions(): Promise<Extensions> {
  await db.insert(labExtensions).values({ id: 1 }).onConflictDoNothing();
  const row = (await db.select().from(labExtensions).where(eq(labExtensions.id, 1)))[0];
  return row ? { dynamic: row.dynamic, depth: row.depth, ms: row.ms } : DEFAULT_EXTENSIONS;
}
export async function saveExtensions(ext: Extensions) {
  await readExtensions();
  await db.update(labExtensions).set(ext).where(eq(labExtensions.id, 1));
}
export async function sessionData() {
  const session = await ensureWorkspace();
  const history = await db.select().from(labHistory).orderBy(desc(labHistory.id)).limit(80);
  const report = await readTake(session.take);
  return { name: session.name, report, history, anchors: await anchorsFor(report.channels), extensions: await readExtensions() };
}
export async function record(report: LabReport, kind: string, message: string, commit: boolean, details: AgentStep[] | null = null) {
  await ensureWorkspace();
  await db.transaction(async (tx) => {
    await tx.insert(labHistory).values({ kind, message, take: report.key, score: report.score, details });
    if (commit) await tx.update(labState).set({ take: report.key, updatedAt: new Date() }).where(eq(labState.id, 1));
  });
}
export function failure(e: unknown, status = 400) {
  return Response.json({ error: e instanceof Error ? e.message : "Не удалось выполнить операцию" }, { status });
}
