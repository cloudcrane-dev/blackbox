import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { canonical, validateSpec, type Problem, type Spec } from "@cloudcrane/app-spec";
import { RUNTIME_VERSION } from "@cloudcrane/app-runtime";
import { citeHash } from "veridic/citations";
import { readFlutterTheme, ROLES } from "./readers/flutter-theme.js";
import { translateModule } from "./readers/ts-pure.js";
import { harvestVectors } from "./readers/ts-vectors.js";
import { shingleLeaks } from "./shingles.js";

// blackbox extract: a CloudCrane spec from an app's own code, plus the partner's
// hints for what can't be read yet. Read, never run. What's read is cited in
// provenance.json (stays in the partner's repo): each spec element, by JSON
// Pointer, with the file, lines and a hash of those lines (Veridic's citeHash),
// and how it was found. The spec itself holds no code and no paths: the
// validator and the leak gates refuse any.

export const GENERATOR = "blackbox@0.1.0";

/** blackbox.hints.json: where things are, and what the readers can't find yet (as spec parts). */
export type Hints = {
  module: Spec["module"];
  /** roles: a theme colour's name → the token path(s) it sets, like ["color", "primary"] or [["color", "on-background"], ["color", "on-surface"]]. */
  theme?: { file: string; mode?: "dark" | "light"; roles?: Record<string, string[] | string[][]> };
  rules?: { files: string[]; tests?: string[] };
  tokens?: Record<string, unknown>;
  surface: Spec["surface"];
  data: Spec["data"];
  logic?: Partial<Spec["logic"]>;
  network?: Spec["network"];
  journeys: Spec["journeys"];
  promises?: Spec["promises"];
  tests?: Spec["tests"];
  mods?: Spec["mods"];
};

export type Citation = { file: string; lines: [number, number]; hash: string; how: "flutter-theme" | "ts-pure" | "ts-vectors" | "hint"; symbol?: string };
export type Provenance = { generator: string; spec: string; source: string; elements: Record<string, Citation[]> };
export type Extracted = { spec: Spec | null; draft: unknown; provenance: Provenance; report: string; problems: Problem[] };

const escapePointer = (s: string) => s.replace(/~/g, "~0").replace(/\//g, "~1");
const sha = (s: string | Buffer) => createHash("sha256").update(s).digest("hex");

export function extract(repo: string, hints: Hints): Extracted {
  const read = (file: string) => readFileSync(join(repo, file), "utf8");
  const cite = (file: string, [a, b]: [number, number], how: Citation["how"], symbol?: string): Citation => {
    const lines = read(file)
      .split("\n")
      .slice(a - 1, b);
    return { file, lines: [a, b], hash: citeHash(lines), how, ...(symbol ? { symbol } : {}) };
  };
  const elements: Record<string, Citation[]> = {};
  const add = (pointer: string, c: Citation) => (elements[pointer] ??= []).push(c);
  const notes: string[] = [];
  const cited = new Set<string>();

  // Tokens: the theme's colours by role, its font and radius; the hints may add or override.
  const tokens: Record<string, Record<string, unknown>> = {};
  if (hints.theme) {
    const { file, mode = "dark", roles = {} } = hints.theme;
    cited.add(file);
    const theme = readFlutterTheme(read(file));
    const map = { ...ROLES, ...roles };
    for (const c of theme.colors) {
      const role = map[c.name];
      if (!role) continue;
      const paths = (Array.isArray(role[0]) ? role : [role]) as [string, string][];
      for (const [group, name] of paths) {
        (tokens[group] ??= { $type: "color" })[name] = { $value: mode === "dark" ? c.dark : c.light };
        add(`/tokens/${escapePointer(group)}/${escapePointer(name)}`, cite(file, [c.line, c.line], "flutter-theme", c.name));
      }
    }
    if (theme.font) {
      tokens["font-family"] = { $type: "fontFamily", $value: [theme.font.family, "system-ui", "sans-serif"] };
      add("/tokens/font-family", cite(file, [theme.font.line, theme.font.line], "flutter-theme"));
    }
    if (theme.radius) {
      tokens["border-radius"] = { $type: "dimension", $value: { value: theme.radius.value, unit: "px" } };
      add("/tokens/border-radius", cite(file, [theme.radius.line, theme.radius.line], "flutter-theme"));
    }
  }
  for (const [group, value] of Object.entries(hints.tokens ?? {})) {
    if (value && typeof value === "object" && !("$value" in value)) {
      tokens[group] = { ...(tokens[group] ?? {}), ...(value as Record<string, unknown>) };
      for (const k of Object.keys(value))
        if (!k.startsWith("$"))
          add(`/tokens/${escapePointer(group)}/${escapePointer(k)}`, { file: "blackbox.hints.json", lines: [0, 0], hash: "", how: "hint" });
    } else {
      tokens[group] = value as Record<string, unknown>;
      add(`/tokens/${escapePointer(group)}`, { file: "blackbox.hints.json", lines: [0, 0], hash: "", how: "hint" });
    }
  }

  // Rules: the pure functions translated to CEL, vectors from the module's own tests.
  const consts: Record<string, number | string | boolean> = {};
  const functions: Spec["logic"]["functions"] = {};
  const vectors: Spec["logic"]["vectors"] = [];
  for (const file of hints.rules?.files ?? []) {
    cited.add(file);
    const t = translateModule(read(file), file);
    for (const c of t.consts) {
      consts[c.name] = c.value;
      add(`/logic/consts/${c.name}`, cite(file, c.lines, "ts-pure", c.name));
    }
    for (const f of t.functions) {
      functions[f.name] = { params: f.params, cel: f.cel };
      add(`/logic/functions/${f.name}`, cite(file, f.lines, "ts-pure", f.name));
    }
    for (const s of t.skipped) notes.push(`- ${s.name} (${file.split("/").pop()}): not translated, ${s.why}`);
  }
  for (const file of hints.rules?.tests ?? []) {
    cited.add(file);
    const { vectors: found, leftOut } = harvestVectors(read(file), new Set(Object.keys(functions)), file);
    for (const v of found) {
      add(`/logic/vectors/${vectors.length}`, cite(file, [v.line, v.line], "ts-vectors", v.fn));
      vectors.push({ fn: v.fn, in: v.in, out: v.out, from: "recorded" });
    }
    if (leftOut)
      notes.push(`- ${leftOut} test call${leftOut === 1 ? "" : "s"} in ${file.split("/").pop()} not read as vectors (in a loop, or not plain values)`);
  }
  for (const [name, f] of Object.entries(hints.logic?.functions ?? {})) {
    if (name in functions) notes.push(`- ${name}: the hints' version replaces the translated one`);
    functions[name] = f;
    elements[`/logic/functions/${name}`] = [{ file: "blackbox.hints.json", lines: [0, 0], hash: "", how: "hint" }];
  }
  for (const v of hints.logic?.vectors ?? []) {
    add(`/logic/vectors/${vectors.length}`, { file: "blackbox.hints.json", lines: [0, 0], hash: "", how: "hint" });
    vectors.push(v);
  }
  for (const pointer of Object.keys(hints.logic?.computed ?? {}))
    add(`/logic/computed/${escapePointer(pointer)}`, { file: "blackbox.hints.json", lines: [0, 0], hash: "", how: "hint" });

  // The source's fingerprint: every cited file's content, by name, hashed. A hash, never the code.
  const files = [...cited].sort();
  const fingerprint = sha(files.map((f) => `${f}\0${sha(readFileSync(join(repo, f)))}`).join("\n"));

  const draft = {
    v: 1,
    manifest: { runtime: RUNTIME_VERSION, generator: GENERATOR, source: { fingerprint: `sha256:${fingerprint}` } },
    module: hints.module,
    tokens,
    surface: hints.surface,
    data: hints.data,
    logic: { consts: { ...consts, ...(hints.logic?.consts ?? {}) }, functions, computed: hints.logic?.computed ?? {}, vectors },
    network: hints.network ?? [],
    journeys: hints.journeys,
    promises: hints.promises ?? [],
    tests: hints.tests ?? [],
    mods: hints.mods ?? { open: [], locked: [] },
  };
  for (const part of ["surface", "data", "journeys", "promises", "tests", "mods", "network", "module"])
    if (part in hints) add(`/${part}`, { file: "blackbox.hints.json", lines: [0, 0], hash: "", how: "hint" });

  const { spec, problems } = validateSpec(draft);
  // The second gate: nothing in the spec (outside its CEL rules) repeats the source's own words.
  const shingles = shingleLeaks(draft, files.map(read));
  const all = [...problems, ...shingles];

  const counts: Record<string, number> = {};
  for (const cs of Object.values(elements)) for (const c of cs) counts[c.how] = (counts[c.how] ?? 0) + 1;
  const report = [
    `# ${hints.module.name}: what Blackbox read`,
    "",
    `Spec ${all.length ? `**not ready**: ${all.length} problem${all.length === 1 ? "" : "s"}` : "ready"}. Generated by ${GENERATOR} for runtime ${RUNTIME_VERSION}, from ${files.length} source files (fingerprint ${fingerprint.slice(0, 12)}).`,
    "",
    "## Where each part came from",
    "",
    ...Object.entries(counts)
      .sort()
      .map(([how, n]) => `- ${how}: ${n}`),
    "",
    `Read from the code: ${Object.keys(tokens).length ? "design tokens, " : ""}${Object.keys(functions).length - Object.keys(hints.logic?.functions ?? {}).length} rules, ${vectors.filter((v) => v.from === "recorded").length} vectors from the module's own tests.`,
    "From hints: the screens, the saved-data shape, composed rules and computed values, journeys and promises.",
    "",
    "## Left out",
    "",
    ...(notes.length ? notes : ["- nothing"]),
    "",
    ...(all.length ? ["## Problems", "", ...all.map((p) => `- ${p.at}: ${p.problem}`), ""] : []),
  ].join("\n");

  const provenance: Provenance = { generator: GENERATOR, spec: spec ? sha(canonical(spec)) : "", source: `sha256:${fingerprint}`, elements };
  return { spec: all.length ? null : spec, draft, provenance, report, problems: all };
}
