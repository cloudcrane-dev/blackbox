import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { compile } from "@cloudcrane/app-runtime";
import { citeHash } from "veridic/citations";
import { touchedBy } from "./diff.js";
import { extract, type Hints } from "./extract.js";
import { shingleLeaks } from "./shingles.js";

// extract, end to end, on a small partner repo written for this test (a Flutter
// theme, a rules module and its tests, as a git repo): what's read from the code
// is cited, the citations hold, the spec builds, nothing is copied, and a change
// to a cited line marks exactly the element it came from.

const THEME = `class AppTheme {
  static bool _isDark = true;
  static Color get primaryColor => const Color(0xFF3366FF);
  static Color get primaryForeground => Colors.black;
  static Color get background => _isDark ? const Color(0xFF101010) : const Color(0xFFFFFFFF);
  static Color get cardColor => _isDark ? const Color(0xFF202020) : const Color(0xFFF4F4F4);
  static BoxDecoration card({double radius = 12}) => BoxDecoration();
}
`;
const RULES = `export const DAILY_GOAL = 8;

export function glassesLeft(drunk: number): number {
  return Math.max(0, DAILY_GOAL - drunk);
}

export function goalMet(drunk: number): boolean {
  return glassesLeft(drunk) == 0;
}
`;
const RULES_TEST = `import assert from "node:assert/strict";
test("left", () => {
  assert.equal(glassesLeft(3), 5);
  assert.equal(glassesLeft(9), 0);
  assert.equal(goalMet(8), true);
});
`;
const CATALOG = "https://cloudcrane.ai/catalogs/app/v1.json";
const HINTS: Hints = {
  module: { id: "water", name: "Water", purpose: "Count glasses of water drunk today." },
  theme: { file: "lib/theme.dart" },
  rules: { files: ["server/rules.ts"], tests: ["server/rules.test.ts"] },
  surface: {
    catalog: CATALOG,
    messages: [
      { version: "v0.9.1", createSurface: { surfaceId: "water", catalogId: CATALOG } },
      {
        version: "v0.9.1",
        updateComponents: {
          surfaceId: "water",
          components: [
            { id: "root", component: "Column", children: ["left"] },
            { id: "left", component: "Text", text: { path: "/computed/left" } },
          ],
        },
      },
    ],
  },
  data: { version: 1, key: "water", persist: "/saved", views: [], schema: {}, initial: { drunk: 0 }, migrations: [] },
  logic: { computed: { "/computed/left": "string(glassesLeft(saved.drunk)) + ' glasses to go'" } },
  journeys: [{ id: "J-1", title: "Log water", steps: [{ id: "J-1.1", text: "See how many glasses are left today" }] }],
};

function partnerRepo(extra: Record<string, string> = {}): string {
  const repo = mkdtempSync(join(tmpdir(), "partner-"));
  mkdirSync(join(repo, "lib"));
  mkdirSync(join(repo, "server"));
  writeFileSync(join(repo, "lib/theme.dart"), THEME);
  writeFileSync(join(repo, "server/rules.ts"), RULES);
  writeFileSync(join(repo, "server/rules.test.ts"), RULES_TEST);
  for (const [file, text] of Object.entries(extra)) writeFileSync(join(repo, file), text);
  const git = (...a: string[]) => execFileSync("git", a, { cwd: repo, stdio: "pipe" });
  git("init", "-q");
  git("-c", "user.email=t@example.com", "-c", "user.name=t", "add", ".");
  git("-c", "user.email=t@example.com", "-c", "user.name=t", "commit", "-qm", "partner app");
  return repo;
}

describe("extract", () => {
  it("reads tokens, rules and vectors from the code, and the rest from hints, into a spec that builds", () => {
    const r = extract(partnerRepo(), HINTS);
    expect(r.problems).toEqual([]);
    const spec = r.spec!;
    expect((spec.tokens as Record<string, Record<string, { $value: unknown }>>)["color"]!["primary"]!.$value).toBe("#3366ff");
    // Both schemes from a theme that has them: the light colours, and the dark ones as tokens.dark.
    expect((spec.tokens as Record<string, Record<string, { $value: unknown }>>)["color"]!["background"]!.$value).toBe("#ffffff");
    expect((spec.tokens as { dark: Record<string, Record<string, { $value: unknown }>> }).dark["color"]!["background"]!.$value).toBe("#101010");
    expect(spec.logic.consts).toEqual({ DAILY_GOAL: 8 });
    expect(Object.keys(spec.logic.functions).sort()).toEqual(["glassesLeft", "goalMet"]);
    expect(spec.logic.vectors).toHaveLength(3);
    expect(spec.manifest.source.fingerprint).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(compile(spec).html).toContain("<!doctype html>");
    expect(r.report).toMatch(/2 rules, 3 vectors/);
  });

  it("cites every element read from code, and each citation's hash is of the lines it names", () => {
    const repo = partnerRepo();
    const r = extract(repo, HINTS);
    const fromCode = Object.entries(r.provenance.elements).flatMap(([, cs]) => cs.filter((c) => c.how !== "hint"));
    expect(fromCode.length).toBeGreaterThan(8);
    for (const c of fromCode) {
      const lines = readFileSync(join(repo, c.file), "utf8")
        .split("\n")
        .slice(c.lines[0] - 1, c.lines[1]);
      expect(citeHash(lines), `${c.file}:${c.lines.join("-")}`).toBe(c.hash);
    }
    expect(r.provenance.elements["/logic/functions/glassesLeft"]).toEqual([
      expect.objectContaining({ file: "server/rules.ts", lines: [3, 5], how: "ts-pure" }),
    ]);
  });

  it("gives the same spec and provenance every time", () => {
    const repo = partnerRepo();
    const [a, b] = [extract(repo, HINTS), extract(repo, HINTS)];
    expect(JSON.stringify(b.spec)).toBe(JSON.stringify(a.spec));
    expect(JSON.stringify(b.provenance)).toBe(JSON.stringify(a.provenance));
  });

  it("refuses hints that copy the source word for word", () => {
    const copied = { ...HINTS, module: { ...HINTS.module, purpose: "return Math.max(0, DAILY_GOAL - drunk); for the day" } };
    const r = extract(partnerRepo(), copied);
    expect(r.spec).toBeNull();
    expect(r.problems.map((p) => p.problem).join("\n")).toMatch(/repeats the source word for word|looks like/);
    expect(shingleLeaks({ purpose: "one two three four five six seven eight nine" }, ["zero one two three four five six seven eight"])).toHaveLength(1);
    expect(shingleLeaks({ logic: { functions: { f: { cel: "a b c d e f g h" } } } }, ["a b c d e f g h"])).toEqual([]);
  });
});

const PUBSPEC = `name: water
dependencies:
  flutter:
    sdk: flutter
  home_widget: ^0.7.0 # the streak widget
  firebase_messaging: ^15.0.0
  flutter_local_notifications: ^17.0.0
dev_dependencies:
  workmanager: ^0.5.0
`;
// Calls recorded while the original app ran: one per line, as a few lines in the app write them.
const RECORDED = [
  '{"fn":"glassesLeft","in":[0],"out":8}',
  '{"fn":"glassesLeft","in":[0],"out":8}',
  '{"fn":"goalMet","in":[3],"out":false}',
  '{"fn":"refill","in":[1],"out":2}',
  "not a call",
].join("\n");

describe("extract: how close the copy is", () => {
  it("suggests gaps from the packages the app depends on, citing each, and lists them in the report", () => {
    const r = extract(partnerRepo({ "pubspec.yaml": PUBSPEC }), HINTS);
    expect(r.problems).toEqual([]);
    // Once each by what: two notification packages are one gap; a dev dependency isn't one.
    expect(r.spec!.gaps).toEqual([
      { kind: "widget", what: "A home-screen widget" },
      { kind: "notifications", what: "Push notifications" },
      { kind: "notifications", what: "Scheduled notifications" },
    ]);
    expect(r.provenance.elements["/gaps/0"]).toEqual([
      expect.objectContaining({ file: "pubspec.yaml", lines: [5, 5], how: "manifest", symbol: "home_widget" }),
    ]);
    expect(r.report).toMatch(/## What it doesn't do that the original does\n\n- A home-screen widget \(widget\)/);
  });

  it("takes the hints' gaps as written, and names what the packages suggest beyond them", () => {
    const gaps = [{ kind: "widget" as const, what: "The streak widget" }];
    const r = extract(partnerRepo({ "pubspec.yaml": PUBSPEC }), { ...HINTS, gaps });
    expect(r.spec!.gaps).toEqual(gaps);
    expect(r.report).toMatch(/suggest these too[^]*Push notifications \(firebase_messaging, pubspec.yaml\)/);
    expect(r.report).not.toMatch(/A home-screen widget \(home_widget/);
  });

  it("keeps calls recorded from the app as examples, once each, and says what it couldn't use", () => {
    const repo = partnerRepo({ "recorded.jsonl": RECORDED });
    const r = extract(repo, { ...HINTS, rules: { ...HINTS.rules!, recorded: ["recorded.jsonl"] } });
    expect(r.problems).toEqual([]);
    const app = r.spec!.logic.vectors.filter((v) => v.from === "app");
    expect(app).toEqual([
      { fn: "glassesLeft", in: [0], out: 8, from: "app" },
      { fn: "goalMet", in: [3], out: false, from: "app" },
    ]);
    expect(r.report).toMatch(/1 recorded call in recorded.jsonl to functions the spec doesn't have/);
    expect(r.report).toMatch(/1 line in recorded.jsonl not read as a call/);
    // Each is cited at its line, so a change to the recording marks it.
    const cited = Object.values(r.provenance.elements)
      .flat()
      .filter((c) => c.how === "app-recording");
    expect(cited.map((c) => c.lines[0])).toEqual([1, 3]);
  });

  it("refuses a recorded call the translated rule doesn't reproduce: the copy doesn't do what the app did", () => {
    const repo = partnerRepo({ "recorded.jsonl": '{"fn":"glassesLeft","in":[2],"out":7}' });
    const r = extract(repo, { ...HINTS, rules: { ...HINTS.rules!, recorded: ["recorded.jsonl"] } });
    expect(r.spec).toBeNull();
    expect(r.problems.map((p) => p.problem)).toContain("glassesLeft(2) gives 6, not 7");
  });

  it("says how much was read from the code, and how many rules examples check", () => {
    const r = extract(partnerRepo({ "recorded.jsonl": RECORDED }), { ...HINTS, rules: { ...HINTS.rules!, recorded: ["recorded.jsonl"] } });
    const c = r.provenance.coverage!;
    expect(c.rules).toEqual({ code: 2, hints: 0 });
    expect(c.tokens.hints).toBe(0);
    expect(c.fromCode).toBe(100);
    expect(c.checked).toEqual({ rules: 2, of: 2, examples: { tests: 3, app: 2, hints: 0 } });
    expect(c.screens).toEqual({ catalog: 2, coded: 0, replaces: [] });
    expect(r.report).toMatch(/\*\*100%\*\* of the design tokens and rules were read from the code/);
    // A rule written in the hints counts against it.
    const hinted = extract(partnerRepo(), { ...HINTS, logic: { ...HINTS.logic, functions: { twice: { params: ["n"], cel: "n * 2" } } } });
    expect(hinted.provenance.coverage!.rules).toEqual({ code: 2, hints: 1 });
    expect(hinted.provenance.coverage!.fromCode).toBeLessThan(100);
  });
});

describe("diff", () => {
  it("marks exactly the elements whose cited lines changed", () => {
    const repo = partnerRepo();
    const { provenance } = extract(repo, HINTS);
    expect(touchedBy(repo, provenance)).toEqual([]);
    const theme = readFileSync(join(repo, "lib/theme.dart"), "utf8").replace("0xFF3366FF", "0xFF22AA55");
    writeFileSync(join(repo, "lib/theme.dart"), theme);
    expect(touchedBy(repo, provenance).map((t) => t.pointer)).toEqual(["/tokens/color/primary"]);
    writeFileSync(join(repo, "server/rules.ts"), RULES.replace("Math.max(0, DAILY_GOAL - drunk)", "Math.max(0, DAILY_GOAL - drunk - 1)"));
    expect(touchedBy(repo, provenance).map((t) => t.pointer)).toEqual(["/logic/functions/glassesLeft", "/tokens/color/primary"]);
  });
});
