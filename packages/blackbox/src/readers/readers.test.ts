import { describe, expect, it } from "vitest";
import { Rules } from "@cloudcrane/app-spec/logic";
import { readFlutterTheme } from "./flutter-theme.js";
import { translateModule } from "./ts-pure.js";
import { harvestVectors } from "./ts-vectors.js";

// The readers, on small samples written for these tests (no partner code): the
// translated CEL must give the same answers as the TypeScript it came from.

const MODULE = `
export const LIMIT = 2;
export const NAME = "streak";
export const DERIVED = LIMIT + 1;

function missed(days: number): number {
  return Math.max(0, days - 1);
}

export function isBroken(days: number | null, left: number, active: boolean): boolean {
  if (!active || days == null) return false;
  return missed(days) > Math.max(0, left);
}

export function next(opts: { current: number; days: number | null; left: number }): number {
  const { current, days, left } = opts;
  if (days == null) return 1;
  if (days <= 0) return Math.max(current, 1);
  const broken = isBroken(days, left, current > 0);
  return broken ? 1 : Math.max(current, 0) + 1;
}

export function loops(xs: number[]): number {
  let total = 0;
  for (const x of xs) total += x;
  return total;
}

export function halves(n: number): number {
  return n / 2;
}

export async function later(): Promise<number> {
  return 1;
}
`;

// The same rules, in plain JS, to check the translation against.
const missed = (d: number) => Math.max(0, d - 1);
const isBroken = (d: number | null, t: number, a: boolean) => !(!a || d == null) && missed(d!) > Math.max(0, t);
const next = (o: { current: number; days: number | null; left: number }) =>
  o.days == null ? 1 : o.days <= 0 ? Math.max(o.current, 1) : isBroken(o.days, o.left, o.current > 0) ? 1 : Math.max(o.current, 0) + 1;

describe("TypeScript rules as CEL", () => {
  const t = translateModule(MODULE);

  it("takes literal constants and the pure functions, and says why it left the rest", () => {
    expect(t.consts.map((c) => [c.name, c.value])).toEqual([
      ["LIMIT", 2],
      ["NAME", "streak"],
    ]);
    expect(t.functions.map((f) => f.name)).toEqual(["missed", "isBroken", "next"]);
    expect(Object.fromEntries(t.skipped.map((s) => [s.name, s.why]))).toEqual({
      DERIVED: "a constant that isn't a plain value",
      loops: "a FirstStatement statement",
      halves: "division: CEL divides whole numbers differently",
      later: "it's async or a generator",
    });
    expect(t.functions.find((f) => f.name === "isBroken")!.lines).toEqual([10, 13]);
  });

  it("gives the same answers as the TypeScript, everywhere it's tried", () => {
    const rules = new Rules({
      consts: {},
      functions: Object.fromEntries(t.functions.map((f) => [f.name, { params: f.params, cel: f.cel }])),
      computed: {},
      vectors: [],
    });
    for (const d of [null, -1, 0, 1, 2, 3, 4, 5, 10])
      for (const left of [0, 1, 2])
        for (const active of [true, false]) {
          expect(rules.apply("isBroken", [d, left, active]), `isBroken(${d}, ${left}, ${active})`).toBe(isBroken(d, left, active));
          for (const current of [0, 1, 5]) {
            const o = { current, days: d, left };
            expect(rules.apply("next", [o]), JSON.stringify(o)).toBe(next(o));
          }
        }
  });
});

describe("vectors from tests", () => {
  const TEST = `
import assert from "node:assert/strict";
test("cases", () => {
  assert.equal(isBroken(4, 2, true), true);
  assert.strictEqual(isBroken(null, 2, true), false);
  expect(next({ current: 5, days: 0, left: 2 })).toBe(5);
  assert.equal(isBroken(LIMIT, 2, true), false);
  for (let t = 0; t <= 2; t++) assert.equal(isBroken(0, t, true), false);
  assert.equal(other(1), 1);
});`;

  it("reads literal calls to known functions, and counts the ones it can't", () => {
    const { vectors, leftOut } = harvestVectors(TEST, new Set(["isBroken", "next"]));
    expect(vectors.map((v) => [v.fn, v.in, v.out])).toEqual([
      ["isBroken", [4, 2, true], true],
      ["isBroken", [null, 2, true], false],
      ["next", [{ current: 5, days: 0, left: 2 }], 5],
    ]);
    expect(leftOut).toBe(2);
  });
});

describe("a Flutter theme", () => {
  const THEME = `
class Theme {
  static Color get primaryColor => const Color(0xFF0F766E);
  static Color get primaryForeground => Colors.white;
  static Color get background => _isDark ? const Color(0xFF000000) : const Color(0xFFF9FAFB);
  static Color get scrim => const Color(0x80000000);
  static BoxDecoration card({double radius = 14}) => BoxDecoration();
  static TextStyle h1 = GoogleFonts.atkinsonHyperlegible(fontSize: 30);
}`;

  it("reads colours (dark and light), the font and the corner radius, with their lines", () => {
    const t = readFlutterTheme(THEME);
    expect(t.colors).toEqual([
      { name: "primaryColor", dark: "#0f766e", light: "#0f766e", line: 3 },
      { name: "primaryForeground", dark: "#ffffff", light: "#ffffff", line: 4 },
      { name: "background", dark: "#000000", light: "#f9fafb", line: 5 },
      { name: "scrim", dark: "#00000080", light: "#00000080", line: 6 },
    ]);
    expect(t.font).toEqual({ family: "Atkinson Hyperlegible", line: 8 });
    expect(t.radius).toEqual({ value: 14, line: 7 });
  });
});
