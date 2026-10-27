import { readFileSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { validateSpec } from "@cloudcrane/app-spec";
import { compile, CompileError } from "@cloudcrane/app-runtime";
import { appCsp } from "./csp.js";
import { extract as extractSpec, type Hints, type Provenance } from "./extract.js";
import { touchedBy } from "./diff.js";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

// The commands, as functions that return what they'd print, so the CLI is a
// thin shell over them and tests call them directly.

export type Outcome = { ok: boolean; lines: string[] };

const readSpec = (file: string): unknown => {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch (e) {
    throw new Error(`Couldn't read ${file} as JSON: ${(e as Error).message}`);
  }
};

/** blackbox validate <spec.json>: every problem, or that it's ready. */
export function validate(file: string): Outcome {
  const { spec, problems } = validateSpec(readSpec(file));
  if (spec)
    return {
      ok: true,
      lines: [`${file}: ready. ${spec.journeys.length} journeys, ${spec.promises.length} promises, ${Object.keys(spec.logic.functions).length} rules.`],
    };
  return { ok: false, lines: [`${file}: ${problems.length} problem${problems.length === 1 ? "" : "s"}`, ...problems.map((p) => `  ${p.at}: ${p.problem}`)] };
}

/** blackbox build <spec.json> [--out app.html]: the app page and its hash. */
export function build(file: string, out?: string): Outcome {
  try {
    const { html, sha256, runtime } = compile(readSpec(file));
    if (out) writeFileSync(out, html);
    return { ok: true, lines: [`${out ?? "(not written)"}: ${Buffer.byteLength(html)} bytes, sha256 ${sha256}, ${runtime}`] };
  } catch (e) {
    if (e instanceof CompileError) return { ok: false, lines: [`${file} can't be built:`, ...e.problems.map((p) => `  ${p.at}: ${p.problem}`)] };
    throw e;
  }
}

/** blackbox preview <spec.json> [--port 5420]: the app as a phone gets it, on this machine, under CloudCrane's policy. */
export function preview(file: string, port = 5420): Promise<{ server: Server; url: string }> {
  const spec = readSpec(file) as { network?: { site: string }[] };
  const { html } = compile(spec);
  const csp = appCsp((spec.network ?? []).map((n) => n.site));
  const server = createServer((req, res) => {
    if (req.url !== "/" && req.url !== "/index.html") {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, {
      "content-type": "text/html; charset=utf-8",
      "content-security-policy": csp,
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    });
    res.end(html);
  });
  return new Promise((resolve) =>
    server.listen(port, "127.0.0.1", () => resolve({ server, url: `http://127.0.0.1:${(server.address() as { port: number }).port}/` })),
  );
}

/** blackbox extract <repo> [--hints FILE] [--out DIR]: the spec, its provenance and a report, from an app's code and hints. */
export function extract(repo: string, hintsFile = join(repo, "blackbox.hints.json"), outDir?: string): Outcome {
  const hints = readSpec(hintsFile) as Hints;
  const r = extractSpec(repo, hints);
  const dir = outDir ?? join(repo, "blackbox", hints.module.id);
  mkdirSync(dir, { recursive: true });
  // canonical-ish: stable key order and two-space indents, so a re-run with nothing changed writes the same bytes.
  const stable = (v: unknown) =>
    `${JSON.stringify(v, (_k, x) => (x && typeof x === "object" && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) : x), 2)}\n`;
  writeFileSync(join(dir, "spec.json"), stable(r.spec ?? r.draft));
  writeFileSync(join(dir, "provenance.json"), stable(r.provenance));
  writeFileSync(join(dir, "report.md"), r.report);
  return {
    ok: !!r.spec,
    lines: [r.report.split("\n")[2]!, `Wrote ${dir}/spec.json, provenance.json and report.md`, ...r.problems.map((p) => `  ${p.at}: ${p.problem}`)],
  };
}

/** blackbox diff <repo> [--module ID] [--range A..B]: which parts of the spec a change to the code touched. */
export function diff(repo: string, module?: string, range?: string): Outcome {
  const id = module ?? (readSpec(join(repo, "blackbox.hints.json")) as Hints).module.id;
  const provenance = readSpec(join(repo, "blackbox", id, "provenance.json")) as Provenance;
  const touched = touchedBy(repo, provenance, range);
  if (!touched.length) return { ok: true, lines: [`Nothing in the ${id} spec is touched${range ? ` by ${range}` : " by the uncommitted changes"}.`] };
  return {
    ok: true,
    lines: [
      `${touched.length} part${touched.length === 1 ? "" : "s"} of the ${id} spec touched; run blackbox extract to regenerate:`,
      ...touched.map((t) => `  ${t.pointer} (${t.why}: ${t.file}:${t.lines.join("-")})`),
    ],
  };
}
