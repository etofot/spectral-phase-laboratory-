import { failure, python, validate } from "@/lib/lab-server";
import type { LabReport } from "@/lib/lab-types";

export const dynamic = "force-dynamic";
export const maxDuration = 180;

/** Pure input render: no EQ, channel gain, phase, dynamic processor or database commit. */
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const args = validate(body.channels, body.fft);
    const report = await python<LabReport>({ ...args, action: "baseline" });
    return Response.json({ key: report.key, meter: report.meter, duration: report.duration, channels: report.channels.length });
  } catch (e) {
    return failure(e);
  }
}
