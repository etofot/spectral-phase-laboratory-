import { readFile, access } from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readTake, takePath, validId, failure, ROOT } from "@/lib/lab-server";
export const dynamic = "force-dynamic";
const exec = promisify(execFile);
export async function GET(req: Request) {
  try {
    const u = new URL(req.url);
    const key = u.searchParams.get("key") || "reference";
    const folder = takePath(key);
    const format = u.searchParams.get("format") || "wav";
    let file = "mix.wav",
      type = "audio/wav";
    if (format === "json") {
      file = "report.json";
      type = "application/json";
    } else if (format === "zip") {
      const report = await readTake(key);
      file = "phaselab-stems.zip";
      type = "application/zip";
      try {
        await access(
          /*turbopackIgnore: true*/ path.join(
            /*turbopackIgnore: true*/ folder,
            file,
          ),
        );
      } catch {
        await exec(
          "python3",
          [
            "-c",
            "import zipfile,sys,os; os.chdir(sys.argv[1]); z=zipfile.ZipFile('phaselab-stems.zip','w',zipfile.ZIP_DEFLATED); [z.write(f) for f in sys.argv[2:]]; z.close()",
            folder,
            "report.json",
            "mix.wav",
            ...report.channels.map((s) => s.id + ".wav"),
          ],
          { timeout: 30000 },
        );
      }
    } else if (format === "probe") {
      const a = u.searchParams.get("a"),
        b = u.searchParams.get("b");
      if (!validId(a) || !validId(b) || a === b)
        throw new Error("Выберите два разных стема");
      const mode = u.searchParams.get("mode") === "diff" ? "diff" : "sum";
      file = `probe_${a}_${b}_${mode}.wav`;
      try {
        await access(
          /*turbopackIgnore: true*/ path.join(
            /*turbopackIgnore: true*/ folder,
            file,
          ),
        );
      } catch {
        await exec(
          process.env.PYTHON_BIN || "python3",
          [
            "-c",
            "import sys,soundfile as sf; from engine.ultra_eq_engine import probe; a,sr=sf.read(sys.argv[1],always_2d=True); b,_=sf.read(sys.argv[2],always_2d=True); s,d,_=probe(a,b,sr); sf.write(sys.argv[3],s if sys.argv[4]=='sum' else d,sr,subtype='FLOAT')",
            path.join(/*turbopackIgnore: true*/ folder, a + ".wav"),
            path.join(/*turbopackIgnore: true*/ folder, b + ".wav"),
            path.join(/*turbopackIgnore: true*/ folder, file),
            mode,
          ],
          {
            cwd: ROOT,
            timeout: 20000,
            env: { ...process.env, OPENBLAS_NUM_THREADS: "1", PYTHONPATH: [path.join(ROOT, ".pydeps"), process.env.PYTHONPATH].filter(Boolean).join(path.delimiter) },
          },
        );
      }
    } else {
      const track = u.searchParams.get("track");
      if (track && track !== "mix") {
        if (!validId(track)) throw new Error("Неизвестная дорожка");
        file = track + ".wav";
      }
    }
    const buf = await readFile(
      /*turbopackIgnore: true*/ path.join(
        /*turbopackIgnore: true*/ folder,
        file,
      ),
    );
    const headers: Record<string, string> = {
      "Content-Type": type,
      "Cache-Control": "private, max-age=3600",
      "Accept-Ranges": "bytes",
    };
    if (u.searchParams.has("download"))
      headers["Content-Disposition"] =
        `attachment; filename="phaselab-${file}"`;
    const range = req.headers.get("range");
    if (range) {
      const m = /^bytes=(\d+)-(\d*)$/.exec(range);
      if (m) {
        const start = Number(m[1]),
          end = m[2] ? Math.min(Number(m[2]), buf.length - 1) : buf.length - 1;
        if (start > end || start >= buf.length)
          return new Response(null, {
            status: 416,
            headers: { "Content-Range": `bytes */${buf.length}` },
          });
        return new Response(new Uint8Array(buf.subarray(start, end + 1)), {
          status: 206,
          headers: {
            ...headers,
            "Content-Range": `bytes ${start}-${end}/${buf.length}`,
            "Content-Length": String(end - start + 1),
          },
        });
      }
    }
    return new Response(new Uint8Array(buf), {
      headers: { ...headers, "Content-Length": String(buf.length) },
    });
  } catch (e) {
    return failure(e, 404);
  }
}
