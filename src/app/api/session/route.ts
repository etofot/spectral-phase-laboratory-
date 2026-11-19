import { sessionData, readTake, record, failure, ensureWorkspace, cleanAnchors, saveAnchors, anchorsFor, validId, saveExtensions } from "@/lib/lab-server";
import { db } from "@/db";
import { labState } from "@/db/schema";
import { eq } from "drizzle-orm";
import { roleOf } from "@/lib/lab-types";
export const dynamic = "force-dynamic";
export async function GET() {
  try {
    return Response.json(await sessionData());
  } catch (e) {
    return failure(e, 503);
  }
}
export async function POST(req: Request) {
  try {
    const body = await req.json();
    if (body.action === "rename") {
      const name = String(body.name || "").trim().slice(0, 50);
      if (!name) throw new Error("Введите название сессии");
      await ensureWorkspace();
      await db.update(labState).set({ name }).where(eq(labState.id, 1));
      return Response.json({ name });
    }
    if (body.action === "extensions") {
      const depth = Number(body.depth);
      if (!Number.isFinite(depth) || depth < 0 || depth > 1) throw new Error("Глубина: 0–100%");
      const extensions = { dynamic: !!body.dynamic, depth: Math.round(depth * 100) / 100, ms: !!body.ms };
      await saveExtensions(extensions);
      return Response.json({ extensions });
    }
    if (body.action === "anchors") {
      // Anchors are listener targets for analysis. They never modify the rendered audio.
      if (!validId(body.id)) throw new Error("Неизвестный канал");
      const state = await ensureWorkspace();
      const report = await readTake(state.take);
      const channel = report.channels.find((c) => c.id === body.id);
      if (!channel) throw new Error("Канал отсутствует в активной сессии");
      await saveAnchors(body.id, cleanAnchors(body.anchors, roleOf(channel)));
      return Response.json({ anchors: await anchorsFor(report.channels) });
    }
    if (!["apply", "restore", "reset"].includes(body.action)) throw new Error("Неизвестная команда");
    const report = await readTake(body.action === "reset" ? "reference" : body.key);
    await record(report, body.action, body.action === "reset" ? "Восстановлены исходные стемы" : body.action === "restore" ? "Восстановлен снимок сессии" : "Применены проверенные коррекции", true);
    return Response.json(await sessionData());
  } catch (e) {
    return failure(e);
  }
}
