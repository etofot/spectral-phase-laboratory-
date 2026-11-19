import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { ROOT, failure } from "@/lib/lab-server";
import type { Role } from "@/lib/lab-types";
const ROLES: Role[] = ["drums", "bass", "sub", "melodic", "vocal"];
export async function POST(req: Request) {
  try {
    if (Number(req.headers.get("content-length")) > 64 * 1024 * 1024) throw new Error("Максимальный размер файла — 64 МБ");
    const form = await req.formData();
    const f = form.get("file");
    if (!(f instanceof File) || f.size > 64 * 1024 * 1024 || f.size < 44) throw new Error("Выберите WAV-файл до 64 МБ");
    const buf = Buffer.from(await f.arrayBuffer());
    if (buf.toString("ascii", 0, 4) !== "RIFF" || buf.toString("ascii", 8, 12) !== "WAVE") throw new Error("Поддерживается несжатый PCM / float WAV");
    const name = String(form.get("name") || f.name.replace(/\.wav$/i, "")).trim().slice(0, 48);
    if (!name) throw new Error("Введите название дорожки");
    const role = ROLES.includes(form.get("role") as Role) ? (form.get("role") as Role) : "melodic";
    const offset = Number(form.get("offset") || 0);
    if (!Number.isFinite(offset) || offset < 0 || offset > 3600) throw new Error("Начало фрагмента: 0–3600 с");
    const id = "u_" + createHash("sha256").update(buf).digest("hex").slice(0, 20);
    const folder = path.join(ROOT, ".lab-data", "imports");
    await mkdir(folder, { recursive: true });
    await writeFile(/*turbopackIgnore: true*/ path.join(folder, id + ".wav"), buf);
    return Response.json({ id, name, role, offset: Math.round(offset * 1000) / 1000 });
  } catch (e) {
    return failure(e);
  }
}
