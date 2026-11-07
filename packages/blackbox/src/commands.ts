import { readFileSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { catalogUse, featuresOf, validateSpec, type Spec } from "@cloudcrane/app-spec";
import { compile, CompileError } from "@cloudcrane/app-runtime";
import { appCsp, appPermissions } from "./csp.js";
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

/** blackbox validate <spec.json>: every problem, or that it's ready; and what would make it better, either way. */
export function validate(file: string): Outcome {
  const { spec, problems, warnings } = validateSpec(readSpec(file));
  const better = warnings.length
    ? [`  ${warnings.length} thing${warnings.length === 1 ? "" : "s"} to make it better:`, ...warnings.map((w) => `    ${w.at}: ${w.problem}`)]
    : [];
  if (spec)
    return {
      ok: true,
      lines: [
        `${file}: ready. ${spec.journeys.length} journeys, ${spec.promises.length} promises, ${Object.keys(spec.logic.functions).length} rules.`,
        ...gapLines(spec),
        ...better,
      ],
    };
  return {
    ok: false,
    lines: [`${file}: ${problems.length} problem${problems.length === 1 ? "" : "s"}`, ...problems.map((p) => `  ${p.at}: ${p.problem}`), ...better],
  };
}

const gapLines = (spec: Spec) => (spec.gaps?.length ? [`  Doesn't do what the original does: ${spec.gaps.map((g) => g.what.toLowerCase()).join("; ")}.`] : []);

/**
 * blackbox coverage <spec.json...>: what the specs' screens are drawn with, added up: each catalog component and how
 * often it's placed, and each coded component by the native widget it replaces, most needed first, so the catalog
 * grows where ports fall back to code. Specs that don't validate are counted as they're written, and named.
 */
export function coverage(files: string[]): Outcome {
  const catalog: Record<string, number> = {};
  const fallbacks: Record<string, { specs: Set<string>; placed: number }> = {};
  const unreadable: string[] = [];
  let coded = 0;
  for (const file of files) {
    const raw = readSpec(file) as Spec;
    let use;
    try {
      use = catalogUse({ surface: raw.surface, components: raw.components ?? {} });
    } catch {
      unreadable.push(file);
      continue;
    }
    for (const [c, n] of Object.entries(use.catalog)) catalog[c] = (catalog[c] ?? 0) + n;
    for (const c of use.coded) {
      coded++;
      const key = c.replaces ?? (c.kit === "page" ? "(a whole page)" : "(a game, or replaces not said)");
      const f = (fallbacks[key] ??= { specs: new Set(), placed: 0 });
      f.specs.add(file);
      f.placed += c.placed;
    }
  }
  const byCount = <T>(entries: [string, T][], n: (t: T) => number) => entries.sort(([a, x], [b, y]) => n(y) - n(x) || (a < b ? -1 : 1));
  const placed = Object.values(catalog).reduce((a, b) => a + b, 0);
  const share = placed + coded ? Math.round((placed / (placed + coded)) * 100) : 0;
  return {
    ok: !unreadable.length,
    lines: [
      `${files.length - unreadable.length} spec${files.length === 1 ? "" : "s"}: ${placed} catalog components placed, ${coded} coded component${coded === 1 ? "" : "s"} (${share}% drawn by the catalog).`,
      "",
      "Coded components, by what they replace (most needed in the catalog first):",
      ...(coded
        ? byCount(Object.entries(fallbacks), (f) => f.specs.size).map(
            ([what, f]) => `  ${what}: ${f.specs.size} spec${f.specs.size === 1 ? "" : "s"}, placed ${f.placed} time${f.placed === 1 ? "" : "s"}`,
          )
        : ["  none"]),
      "",
      "Catalog components used:",
      ...byCount(Object.entries(catalog), (n) => n).map(([c, n]) => `  ${c}: ${n}`),
      ...unreadable.map((f) => `${f}: its surface couldn't be read`),
    ],
  };
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
  const spec = readSpec(file) as { network?: { site: string }[]; uses?: { what: string }[] };
  const { html } = compile(spec);
  const csp = appCsp((spec.network ?? []).map((n) => n.site));
  // And the phone features it declares, nothing else, as CloudCrane serves it.
  const permissions = appPermissions(featuresOf(spec.uses ?? []));
  const server = createServer((req, res) => {
    if (req.url !== "/" && req.url !== "/index.html") {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, {
      "content-type": "text/html; charset=utf-8",
      "content-security-policy": csp,
      "permissions-policy": permissions,
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
