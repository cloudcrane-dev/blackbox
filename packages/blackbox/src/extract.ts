import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { canonical, catalogUse, validateSpec, type Problem, type Spec } from "@cloudcrane/app-spec";
import { RUNTIME_VERSION } from "@cloudcrane/app-runtime";
import { citeHash } from "veridic/citations";
import { existsSync } from "node:fs";
import { readFlutterTheme, ROLES } from "./readers/flutter-theme.js";
import { gapsIn } from "./readers/gaps.js";
import { byRole, colorsIn, type FoundColor } from "./readers/colors.js";
import { declaredIn, mergeDeclared } from "./readers/declares.js";
import { discover, type Found } from "./readers/platform.js";
import { stringsIn } from "./readers/strings.js";
import { translateModule } from "./readers/ts-pure.js";
import { harvestVectors } from "./readers/ts-vectors.js";
import { shingleLeaks } from "./shingles.js";

// blackbox extract: a CloudCrane spec from an app's own code, plus the partner's
// hints for what can't be read yet. Read, never run. What's read is cited in
// provenance.json (stays in the partner's repo): each spec element, by JSON
// Pointer, with the file, lines and a hash of those lines (Veridic's citeHash),
// and how it was found. The spec itself holds no code and no paths: the
// validator and the leak gates refuse any.

export const GENERATOR = "blackbox@0.8.0";

/** blackbox.hints.json: where things are, and what the readers can't find yet (as spec parts). */
export type Hints = {
  module: Spec["module"];
  /**
   * roles: a theme colour's name → the token path(s) it sets, like ["color", "primary"] or [["color", "on-background"], ["color", "on-surface"]].
   * mode: one scheme only. Left out, a theme with both gives the light colours, and the dark ones as tokens.dark.
   */
  theme?: { file: string; mode?: "dark" | "light"; roles?: Record<string, string[] | string[][]> };
  /**
   * files: modules of pure functions, translated to CEL; tests: their tests, read for examples; recorded: JSON Lines
   * files of calls recorded while the original app ran ({"fn", "in", "out"} each), kept as examples `from: "app"`.
   */
  rules?: { files: string[]; tests?: string[]; recorded?: string[] };
  /**
   * What the original does that this one doesn't. Left out, it's suggested from the packages the app depends on
   * (`manifests`, by default pubspec.yaml and package.json at the repo's root); given, it's the list as written.
   */
  gaps?: Spec["gaps"];
  manifests?: string[];
  /**
   * Where the platform files are; each left out is found by name in the repo (AndroidManifest.xml, Info.plist and
   * *.entitlements; colors.xml, colour sets and CSS variables; strings.xml, .xcstrings, .strings and .arb). An empty
   * list reads none.
   */
  declares?: string[];
  colors?: string[];
  strings?: string[];
  tokens?: Record<string, unknown>;
  surface: Spec["surface"];
  data: Spec["data"];
  logic?: Partial<Spec["logic"]>;
  /** What it can reach: each site with why and what it's sent; the device features it uses. */
  network?: Spec["network"];
  uses?: Spec["uses"];
  /** What it does: each screen with its empty, loading, offline and error states; the orientation. */
  screens?: Spec["screens"];
  screen?: Spec["screen"];
  journeys: Spec["journeys"];
  promises?: Spec["promises"];
  tests?: Spec["tests"];
  mods?: Spec["mods"];
};

export type Citation = {
  file: string;
  lines: [number, number];
  hash: string;
  how: "flutter-theme" | "platform-colors" | "ts-pure" | "ts-vectors" | "app-recording" | "manifest" | "declares" | "hint";
  symbol?: string;
};
/** How much of a spec was read from the app, rather than written in hints: the parts a reviewer checks by hand are the rest. */
export type Coverage = {
  /** Design tokens and rules read from the code, of all of them, as a whole percentage. */
  fromCode: number;
  tokens: { code: number; hints: number };
  rules: { code: number; hints: number };
  /** Rules with at least one example to reproduce, of all rules; and the examples by where they came from. */
  checked: { rules: number; of: number; examples: { tests: number; app: number; hints: number } };
  /** What the screens are drawn with: catalog components placed, coded components defined, and what each replaces. */
  screens: { catalog: number; coded: number; replaces: string[] };
  gaps: number;
};
export type Provenance = { generator: string; spec: string; source: string; elements: Record<string, Citation[]>; coverage?: Coverage };
/** `strings`: the words people see, by key, for whoever writes the screens (written as strings.json, not in the spec). */
/** `suggested`: what the app declares or depends on that the spec doesn't say, for the hints (each a line of the report). */
export type Extracted = {
  spec: Spec | null;
  draft: unknown;
  provenance: Provenance;
  report: string;
  problems: Problem[];
  strings: Record<string, string>;
  suggested: { uses: string[]; gaps: string[] };
};

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
  // Files read as data (recorded calls, package manifests): part of the source's fingerprint, but not code, so not
  // held to the copied-code check, which recorded examples would trip by design.
  const data = new Set<string>();
  const add = (pointer: string, c: Citation) => (elements[pointer] ??= []).push(c);
  const notes: string[] = [];
  const cited = new Set<string>();

  // Tokens: the theme's colours by role, its font and radius; the hints may add or override.
  const tokens: Record<string, Record<string, unknown>> = {};
  if (hints.theme) {
    const { file, mode, roles = {} } = hints.theme;
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
        // Both schemes, unless one was asked for: the dark colour as tokens.dark, where it differs.
        if (!mode && c.dark !== c.light) {
          const dark = (tokens["dark"] ??= {}) as Record<string, Record<string, unknown>>;
          (dark[group] ??= { $type: "color" })[name] = { $value: c.dark };
          add(`/tokens/dark/${escapePointer(group)}/${escapePointer(name)}`, cite(file, [c.line, c.line], "flutter-theme", c.name));
        }
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

  // Colours from the platform's own files (Android, iOS, CSS), for each role the Flutter theme and the hints didn't set.
  const found: Found | null = hints.declares && hints.colors && hints.strings ? null : discover(repo);
  const colorFiles = hints.colors ?? found!.colors;
  const colours: FoundColor[] = [];
  for (const file of colorFiles) {
    data.add(file);
    colours.push(...colorsIn(file, read(file)));
  }
  const { light, dark: darkColours } = byRole(colours);
  const setColour = (into: Record<string, Record<string, unknown>>, pointer: string, c: FoundColor) => {
    const group = (into["color"] ??= { $type: "color" }) as Record<string, unknown>;
    if (c.role in group) return;
    group[c.role] = { $value: c.value };
    add(pointer, cite(c.file, [c.line, c.line], "platform-colors", c.name));
  };
  for (const c of light.values()) setColour(tokens, `/tokens/color/${escapePointer(c.role)}`, c);
  for (const c of darkColours.values()) {
    if (light.get(c.role)?.value === c.value) continue;
    setColour((tokens["dark"] ??= {}) as Record<string, Record<string, unknown>>, `/tokens/dark/color/${escapePointer(c.role)}`, c);
  }

  // The words people see, for whoever writes the screens.
  const strings: Record<string, string> = {};
  for (const file of hints.strings ?? found!.strings) {
    data.add(file);
    for (const st of stringsIn(file, read(file))) if (!(st.key in strings)) strings[st.key] = st.text;
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
  // Examples recorded from the original app as it ran: the strongest proof a rule does what the app did.
  const MAX_APP_EXAMPLES = 20;
  for (const file of hints.rules?.recorded ?? []) {
    data.add(file);
    const perFn: Record<string, number> = {};
    const seen = new Set<string>();
    let unknown = 0;
    let unread = 0;
    read(file)
      .split("\n")
      .forEach((line, i) => {
        if (!line.trim()) return;
        let call: { fn?: unknown; in?: unknown; out?: unknown };
        try {
          call = JSON.parse(line) as typeof call;
        } catch {
          unread++;
          return;
        }
        // At most 8 arguments, as a spec's examples allow.
        if (typeof call.fn !== "string" || !Array.isArray(call.in) || call.in.length > 8 || !("out" in call)) return void unread++;
        if (!(call.fn in functions) && !(call.fn in (hints.logic?.functions ?? {}))) return void unknown++;
        const key = JSON.stringify([call.fn, call.in, call.out]);
        if (seen.has(key) || (perFn[call.fn] ?? 0) >= MAX_APP_EXAMPLES) return;
        seen.add(key);
        perFn[call.fn] = (perFn[call.fn] ?? 0) + 1;
        add(`/logic/vectors/${vectors.length}`, cite(file, [i + 1, i + 1], "app-recording", call.fn));
        vectors.push({ fn: call.fn, in: call.in, out: call.out, from: "app" });
      });
    const name = file.split("/").pop();
    if (unknown) notes.push(`- ${unknown} recorded call${unknown === 1 ? "" : "s"} in ${name} to functions the spec doesn't have`);
    if (unread) notes.push(`- ${unread} line${unread === 1 ? "" : "s"} in ${name} not read as a call ({"fn", "in", "out"})`);
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

  // Gaps: as the hints say, or suggested from the packages the app depends on.
  let gaps: NonNullable<Spec["gaps"]> = hints.gaps ?? [];
  const manifests = hints.manifests ?? ["pubspec.yaml", "package.json"].filter((f) => existsSync(join(repo, f)));
  const suggested: string[] = [];
  for (const file of manifests) {
    data.add(file);
    for (const g of gapsIn(file, read(file))) {
      if (hints.gaps) {
        if (!hints.gaps.some((h) => h.kind === g.kind)) suggested.push(`- ${g.what} (${g.package}, ${file})`);
        continue;
      }
      if (gaps.length >= 20) break;
      if (sameGap(gaps, g)) continue;
      add(`/gaps/${gaps.length}`, cite(file, [g.line, g.line], "manifest", g.package));
      gaps.push({ kind: g.kind, what: g.what });
    }
  }
  // What the app declares to the phone: its features (uses, with the developer's own why on iOS) and what a web app
  // can't do (gaps).
  const declareFiles = hints.declares ?? found!.declares;
  for (const file of declareFiles) data.add(file);
  const declared = mergeDeclared(declareFiles.map((f) => declaredIn(f, read(f), hints.module.name)));
  for (const g of declared.gaps) {
    if (hints.gaps) {
      if (!hints.gaps.some((h) => h.kind === g.kind)) suggested.push(`- ${g.what} (${g.source}, ${g.file})`);
      continue;
    }
    if (gaps.length >= 20 || sameGap(gaps, g)) continue;
    add(`/gaps/${gaps.length}`, cite(g.file, [g.line, g.line], "declares", g.source));
    gaps.push({ kind: g.kind, what: g.what });
  }
  if (hints.gaps) add("/gaps", { file: "blackbox.hints.json", lines: [0, 0], hash: "", how: "hint" });
  gaps = gaps.slice(0, 20);

  // Uses: as the hints say; or what the app declares with a why in its own words. The camera and microphone work only
  // in a page-kit component, which extract never writes, so they're suggested in the report instead, as is anything
  // declared without a why (Android permissions have none).
  const uses: NonNullable<Spec["uses"]> = hints.uses ? [...hints.uses] : [];
  const suggestedUses: string[] = [];
  for (const u of declared.uses) {
    if (uses.some((x) => x.what === u.what)) continue;
    const canAdd = !hints.uses && u.why && u.what !== "camera" && u.what !== "microphone";
    if (canAdd) {
      add(`/uses/${uses.length}`, cite(u.file, [u.line, u.line], "declares", u.source));
      uses.push({ what: u.what, why: u.why!.slice(0, 300) });
    } else suggestedUses.push(`- ${u.what}${u.why ? `: "${u.why}"` : ""} (${u.source}, ${u.file})`);
  }

  // The source's fingerprint: every cited file's content, by name, hashed. A hash, never the code.
  const files = [...cited].sort();
  const all = [...new Set([...cited, ...data])].sort();
  const fingerprint = sha(all.map((f) => `${f}\0${sha(readFileSync(join(repo, f)))}`).join("\n"));

  const draft = {
    v: 1,
    manifest: { runtime: RUNTIME_VERSION, generator: GENERATOR, source: { fingerprint: `sha256:${fingerprint}` } },
    module: hints.module,
    tokens,
    surface: hints.surface,
    data: hints.data,
    logic: { consts: { ...consts, ...(hints.logic?.consts ?? {}) }, functions, computed: hints.logic?.computed ?? {}, vectors },
    network: hints.network ?? [],
    ...(uses.length ? { uses } : {}),
    ...(hints.screens ? { screens: hints.screens } : {}),
    ...(hints.screen ? { screen: hints.screen } : {}),
    ...(gaps.length ? { gaps } : {}),
    journeys: hints.journeys,
    promises: hints.promises ?? [],
    tests: hints.tests ?? [],
    mods: hints.mods ?? { open: [], locked: [] },
  };
  for (const part of ["surface", "data", "journeys", "promises", "tests", "mods", "network", "uses", "screens", "screen", "module"])
    if (part in hints) add(`/${part}`, { file: "blackbox.hints.json", lines: [0, 0], hash: "", how: "hint" });

  const { spec, problems, warnings } = validateSpec(draft);
  // The second gate: nothing in the spec (outside its CEL rules) repeats the source's own words.
  const shingles = shingleLeaks(draft, files.map(read));
  const refused = [...problems, ...shingles];

  const coverage = coverageOf(draft as unknown as Spec, elements);

  const counts: Record<string, number> = {};
  for (const cs of Object.values(elements)) for (const c of cs) counts[c.how] = (counts[c.how] ?? 0) + 1;
  const report = [
    `# ${hints.module.name}: what Blackbox read`,
    "",
    `Spec ${refused.length ? `**not ready**: ${refused.length} problem${refused.length === 1 ? "" : "s"}` : "ready"}. Generated by ${GENERATOR} for runtime ${RUNTIME_VERSION}, from ${all.length} source files (fingerprint ${fingerprint.slice(0, 12)}).`,
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
    "## How much came from the code",
    "",
    ...coverageLines(coverage),
    "",
    "## What it doesn't do that the original does",
    "",
    ...(gaps.length ? gaps.map((g) => `- ${g.what} (${g.kind})`) : ["- nothing found; say so in the hints' gaps if the original does more"]),
    ...(suggested.length ? ["", "Its packages and manifests suggest these too, which the hints' gaps don't list:", ...suggested] : []),
    "",
    "## Phone features",
    "",
    ...(uses.length ? uses.map((u) => `- ${u.what}: ${u.why}`) : ["- none"]),
    ...(suggestedUses.length
      ? ["", "Declared by the app but not in the spec: add each to the hints' uses with why if the copy needs it:", ...suggestedUses]
      : []),
    ...(Object.keys(strings).length ? ["", `${Object.keys(strings).length} strings people see are in strings.json, for writing the screens.`] : []),
    "",
    "## Left out",
    "",
    ...(notes.length ? notes : ["- nothing"]),
    "",
    ...(refused.length ? ["## Problems", "", ...refused.map((p) => `- ${p.at}: ${p.problem}`), ""] : []),
    ...(warnings.length ? ["## To make it better", "", ...warnings.map((w) => `- ${w.at}: ${w.problem}`), ""] : []),
  ].join("\n");

  const provenance: Provenance = { generator: GENERATOR, spec: spec ? sha(canonical(spec)) : "", source: `sha256:${fingerprint}`, elements, coverage };
  const strip = (l: string) => l.replace(/^- /, "");
  return {
    spec: refused.length ? null : spec,
    draft,
    provenance,
    report,
    problems: refused,
    strings,
    suggested: { uses: suggestedUses.map(strip), gaps: suggested.map(strip) },
  };
}

/** Read from the code or written in hints, by element: an element read from the code has a citation that isn't a hint. */
function coverageOf(spec: Spec, elements: Record<string, Citation[]>): Coverage {
  const fromCode = (pointer: string) => (elements[pointer] ?? []).some((c) => c.how !== "hint");
  const under = (prefix: string, depth: number) => Object.keys(elements).filter((p) => p.startsWith(prefix) && p.split("/").length === depth);
  // Tokens: each colour /tokens/<group>/<name> (and dark ones, one deeper), or a whole token like /tokens/font-family.
  const tokenPointers = Object.keys(elements).filter((p) => p.startsWith("/tokens/"));
  const tokens = { code: tokenPointers.filter(fromCode).length, hints: tokenPointers.filter((p) => !fromCode(p)).length };
  const fns = under("/logic/functions/", 4);
  const rules = { code: fns.filter(fromCode).length, hints: fns.filter((p) => !fromCode(p)).length };
  const vectors = spec.logic?.vectors ?? [];
  const names = Object.keys(spec.logic?.functions ?? {});
  const withExamples = names.filter((n) => vectors.some((v) => v.fn === n)).length;
  const examples = {
    tests: vectors.filter((v) => v.from === "recorded").length,
    app: vectors.filter((v) => v.from === "app").length,
    hints: vectors.filter((v) => v.from === "hint").length,
  };
  let screens: Coverage["screens"] = { catalog: 0, coded: 0, replaces: [] };
  try {
    const use = catalogUse({ surface: spec.surface, components: spec.components ?? {} });
    screens = {
      catalog: Object.values(use.catalog).reduce((a, b) => a + b, 0),
      coded: use.coded.length,
      replaces: use.coded.flatMap((c) => (c.replaces ? [c.replaces] : [])),
    };
  } catch {
    // A surface too malformed to read is reported as a problem; coverage just leaves it at nothing.
  }
  const read = tokens.code + rules.code;
  const total = read + tokens.hints + rules.hints;
  return {
    fromCode: total ? Math.round((read / total) * 100) : 0,
    tokens,
    rules,
    checked: { rules: withExamples, of: names.length, examples },
    screens,
    gaps: spec.gaps?.length ?? 0,
  };
}

function coverageLines(c: Coverage): string[] {
  const of = (part: { code: number; hints: number }) => `${part.code} of ${part.code + part.hints}`;
  return [
    `**${c.fromCode}%** of the design tokens and rules were read from the code; the rest came from hints, to check by hand.`,
    "",
    `- Design tokens: ${of(c.tokens)} read from the code`,
    `- Rules: ${of(c.rules)} read from the code; ${c.checked.rules} of ${c.checked.of} checked by examples (${c.checked.examples.app} recorded from the app, ${c.checked.examples.tests} from its tests, ${c.checked.examples.hints} from hints)`,
    `- Screens: from hints, with ${c.screens.catalog} catalog components and ${c.screens.coded} coded component${c.screens.coded === 1 ? "" : "s"}${c.screens.replaces.length ? ` (standing in for ${c.screens.replaces.join(", ")})` : ""}`,
  ];
}

/**
 * Whether a gap is already said: one per kind (push and scheduled notifications are both "notifications"), except
 * device features, each its own (Health and step counting are different things to tell people), once by what.
 */
function sameGap(gaps: { kind: string; what: string }[], g: { kind: string; what: string }): boolean {
  return gaps.some((x) => x.what === g.what || (x.kind === g.kind && g.kind !== "device" && g.kind !== "other"));
}
