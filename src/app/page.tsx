import Workspace from "@/components/lab/Workspace";
import { sessionData, readTake } from "@/lib/lab-server";
import type { AnchorMap, Extensions, HistoryEntry, LabReport } from "@/lib/lab-types";
import { DEFAULT_EXTENSIONS } from "@/lib/lab-types";

export const dynamic = "force-dynamic";

export default async function Home() {
  let online = true;
  let initial: { name: string; report: LabReport; history: HistoryEntry[]; anchors: AnchorMap; extensions: Extensions };
  try {
    const session = await sessionData();
    initial = { name: session.name, report: session.report, history: JSON.parse(JSON.stringify(session.history)) as HistoryEntry[], anchors: session.anchors, extensions: session.extensions };
  } catch (error) {
    console.error("Session store unavailable; displaying the measured reference snapshot.", error instanceof Error ? error.name : "StorageError");
    online = false;
    initial = { name: "Synthetic Session 01", report: await readTake("reference"), history: [], anchors: {}, extensions: DEFAULT_EXTENSIONS };
  }
  return <Workspace online={online} initial={initial} />;
}
