import { validate, python, record, failure, anchorsFor, readExtensions } from "@/lib/lab-server";
import type { LabReport } from "@/lib/lab-types";
export const dynamic = "force-dynamic";
export const maxDuration = 180;
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const args = validate(body.channels, body.fft);
    const anchors = await anchorsFor(args.channels);
    const extensions = await readExtensions();
    const result = await python<LabReport>({ ...args, anchors, extensions, action: "measure" });
    const pr = result.priorities;
    const marks = pr?.total || pr?.avoidTotal ? ` · ориентиры ${pr.clear}/${pr.total} · очищено ${pr.avoidSettled ?? 0}/${pr.avoidTotal ?? 0}` : "";
    await record(result, "analysis", `Измерение ${result.channels.length} стемов · FFT ${result.fft}${marks}`, true);
    return Response.json(result);
  } catch (e) {
    return failure(e);
  }
}
