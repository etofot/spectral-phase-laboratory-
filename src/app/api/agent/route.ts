import { validate, python, record, failure, anchorsFor, readExtensions } from "@/lib/lab-server";
import type { Preview } from "@/lib/lab-types";
export const dynamic = "force-dynamic";
export const maxDuration = 180;
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const args = validate(body.channels, body.fft);
    const anchors = await anchorsFor(args.channels);
    const extensions = await readExtensions();
    const result = await python<Preview>({
      extensions,
      ...args,
      anchors,
      action: "preview",
      iterations: Math.max(1, Math.min(10, Math.trunc(Number(body.iterations) || 10))),
      only: typeof body.only === "string" ? body.only.slice(0, 100) : null,
    });
    const accepted = result.steps.filter((s) => s.accepted).length;
    const marks = result.report.priorities?.total ? ` · ориентиры ${result.beforePriorities?.clear ?? 0}/${result.report.priorities.total} → ${result.report.priorities.clear}/${result.report.priorities.total}` : "";
    await record(result.report, "preview", `Пробный рендер: ${accepted} коррекций · ${result.before} → ${result.report.score}${marks}`, false, result.steps);
    return Response.json(result);
  } catch (e) {
    return failure(e);
  }
}
