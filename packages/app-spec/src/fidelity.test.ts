import { describe, expect, it } from "vitest";
import { catalogUse, rulesWarnings } from "./fidelity.js";
import { sampleSpec } from "./fixtures.js";
import { SpecSchema } from "./schema.js";
import { validateSpec } from "./validate.js";

// How closely a spec can be shown to copy its original: rules with examples, what the screens are drawn with, and
// what the original does that the copy doesn't.

describe("rulesWarnings", () => {
  it("says which rules have no example to reproduce", () => {
    const s = sampleSpec();
    expect(rulesWarnings(s)).toEqual([]);
    s.logic.functions["daysLeft"] = { params: ["n"], cel: "n - 1" };
    expect(rulesWarnings(s)).toEqual([
      { at: "/logic/functions/daysLeft", problem: expect.stringMatching(/^daysLeft has no examples: nothing checks it does what the original does/) },
    ]);
    // Several, in one warning.
    s.logic.functions["weeksLeft"] = { params: ["n"], cel: "n / 7" };
    expect(rulesWarnings(s)).toEqual([
      { at: "/logic/functions", problem: expect.stringMatching(/^daysLeft, weeksLeft have no examples: nothing checks they do/) },
    ]);
    delete s.logic.functions["weeksLeft"];
    // A warning, not a refusal.
    const v = validateSpec(s);
    expect(v.spec).not.toBeNull();
    expect(v.warnings.map((w) => w.at)).toContain("/logic/functions/daysLeft");
  });

  it("takes examples recorded from the running app, and refuses one the rule doesn't reproduce", () => {
    const s = sampleSpec();
    s.logic.vectors.push({ fn: "isStreakBroken", in: [3, 2, true], out: false, from: "app" });
    expect(validateSpec(s).spec).not.toBeNull();
    s.logic.vectors.push({ fn: "isStreakBroken", in: [9, 2, true], out: false, from: "app" });
    expect(validateSpec(s).problems).toEqual([{ at: "/logic/vectors/2", problem: "isStreakBroken(9,2,true) gives true, not false" }]);
  });
});

describe("a rule named like a CEL function", () => {
  it("is refused, saying which, rather than crashing the check", () => {
    const s = sampleSpec();
    s.logic.functions["double"] = { params: ["n"], cel: "n * 2" };
    expect(validateSpec(s).problems).toEqual([{ at: "/logic/functions/double", problem: '"double" is already a CEL function: name it something else' }]);
  });
});

describe("catalogUse", () => {
  it("counts the catalog components the screens place", () => {
    expect(catalogUse(sampleSpec())).toEqual({ catalog: { Column: 1, Text: 1, List: 1, CheckBox: 1 }, coded: [] });
  });

  it("lists coded components with what each replaces and how often it's placed", () => {
    const s = sampleSpec();
    s.components = {
      segments: { kind: "coded", kit: "game", replaces: "CupertinoSlidingSegmentedControl", inputs: {}, events: {}, code: "draw()" },
      board: { kind: "coded", kit: "game", inputs: {}, events: {}, code: "draw()" },
    };
    const comps = (s.surface.messages[1] as { updateComponents: { components: unknown[] } }).updateComponents.components;
    comps.push(
      { id: "seg", component: "Coded", use: "segments" },
      { id: "seg2", component: "Coded", use: "segments" },
      { id: "b", component: "Coded", use: "board" },
    );
    expect(catalogUse(s).coded).toEqual([
      { name: "segments", kit: "game", replaces: "CupertinoSlidingSegmentedControl", placed: 2 },
      { name: "board", kit: "game", replaces: null, placed: 1 },
    ]);
    expect(catalogUse(s).catalog["Coded"]).toBeUndefined();
  });
});

describe("gaps", () => {
  it("records what the original does that this one doesn't, by kind, and refuses an unknown kind", () => {
    const s = { ...sampleSpec(), gaps: [{ kind: "widget", what: "The home-screen widget with today's streak" }] };
    expect(SpecSchema.safeParse(s).success).toBe(true);
    expect(SpecSchema.safeParse({ ...s, gaps: [{ kind: "teleport", what: "x" }] }).success).toBe(false);
  });
});
