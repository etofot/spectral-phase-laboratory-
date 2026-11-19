import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import path from "node:path";
import { db } from "@/db";
import { labPresets, labAnchors, labExtensions, labState, labHistory } from "@/db/schema";
import { desc, eq } from "drizzle-orm";
import { anchorsFor, cleanAnchors, ensureWorkspace, failure, python, readExtensions, sessionData, validate, ROOT } from "@/lib/lab-server";
import { roleOf } from "@/lib/lab-types";
import type { AnchorMap, Extensions, LabReport } from "@/lib/lab-types";

export const dynamic = "force-dynamic";
export const maxDuration = 180;

const getAll = () => db.select().from(labPresets).orderBy(desc(labPresets.id)).limit(60);
export async function GET() {
  try { return Response.json({ presets: await getAll() }); } catch (e) { return failure(e, 503); }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    if (body.action === "save") {
      const name = String(body.name ?? "").trim().slice(0, 80);
      if (!name) throw new Error("Введите имя пресета");
      const session = await sessionData();
      const content = { schema: 1, channels: session.report.channels, anchors: await anchorsFor(session.report.channels), extensions: await readExtensions(), fft: session.report.fft, take: session.report.key };
      const fingerprint = createHash("sha256").update(JSON.stringify(content)).digest("hex").slice(0, 16);
      const [preset] = await db.insert(labPresets).values({ name, fingerprint, content }).returning();
      return Response.json({ preset, presets: await getAll() });
    }
    const id = Number(body.id);
    if (!Number.isSafeInteger(id) || id < 1) throw new Error("Некорректный ID пресета");
    const [preset] = await db.select().from(labPresets).where(eq(labPresets.id, id));
    if (!preset) throw new Error("Пресет не найден");
    if (body.action === "delete") {
      await db.delete(labPresets).where(eq(labPresets.id, id));
      return Response.json({ presets: await getAll() });
    }
    if (body.action !== "load") throw new Error("Неизвестная команда");
    const raw = preset.content as { channels: unknown; fft: unknown; anchors?: AnchorMap; extensions?: Extensions };
    if (!raw || !Array.isArray(raw.channels)) throw new Error("Пресет повреждён");
    const { channels, fft } = validate(raw.channels, raw.fft);
    for (const channel of channels) {
      const source = channel.id.startsWith("u_") ? path.join(ROOT, ".lab-data", "imports", `${channel.id}.wav`) : path.join(ROOT, "fixtures", `${channel.id}.wav`);
      if (!existsSync(/*turbopackIgnore: true*/ source)) throw new Error(`Исходник «${channel.name}» отсутствует. Восстановите файл вместе с .lab-data/imports.`);
    }
    const anchors: AnchorMap = {};
    for (const channel of channels) {
      const cleaned = cleanAnchors(raw.anchors?.[channel.id] ?? { prefer: [], avoid: [] }, roleOf(channel));
      if (cleaned.prefer.length || cleaned.avoid.length) anchors[channel.id] = cleaned;
    }
    const ext = raw.extensions ?? { dynamic: false, ms: false, depth: 0.55 };
    if (typeof ext.depth !== "number" || !Number.isFinite(ext.depth) || ext.depth < 0 || ext.depth > 1) throw new Error("Некорректная глубина процессора в пресете");
    const extensions: Extensions = { dynamic: !!ext.dynamic, ms: !!ext.ms, depth: ext.depth };
    const report = await python<LabReport>({ action: "measure", channels, fft, anchors, extensions });
    // Only commit once sources have been verified and the renderer has succeeded.
    await ensureWorkspace();
    await db.transaction(async (tx) => {
      await tx.delete(labAnchors);
      for (const [channelId, points] of Object.entries(anchors)) await tx.insert(labAnchors).values({ channelId, anchors: points });
      await tx.insert(labExtensions).values({ id: 1, ...extensions }).onConflictDoUpdate({ target: labExtensions.id, set: extensions });
      await tx.insert(labHistory).values({ kind: "preset", message: `Восстановлен пресет «${preset.name}» · ${preset.fingerprint}`, take: report.key, score: report.score });
      await tx.update(labState).set({ take: report.key, updatedAt: new Date() }).where(eq(labState.id, 1));
    });
    return Response.json({ report, preset, presets: await getAll(), extensions, anchors: await anchorsFor(channels) });
  } catch (e) { return failure(e); }
}
