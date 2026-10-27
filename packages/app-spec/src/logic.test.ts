import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { cycleIn, dates, logicProblems, Rules } from "./logic.js";
import type { Spec } from "./schema.js";

// Rules are CEL plus a small registered library (days, fold). They must be pure
// and total: an error gives null, recursion is refused, and the example app's
// streak, written as CEL, gives the answers worked out by hand for its eight cases.

type Logic = Spec["logic"];
const fixture = (name: string) => JSON.parse(readFileSync(new URL(`../../../fixtures/habits/${name}`, import.meta.url), "utf8"));
const habits = (): Logic => ({ computed: {}, vectors: [], ...fixture("logic.json") });
const withData = (logic: Logic) => ({ logic, data: { version: 1, key: "x", persist: "/saved", views: [], schema: {}, initial: {}, migrations: [] } });

describe("days", () => {
  it("count, step and start weeks on Monday across months, years and DST changes", () => {
    expect(dates.addDays("2026-12-31", 1n)).toBe("2027-01-01");
    expect(dates.addDays("2026-03-29", 1n)).toBe("2026-03-30"); // a European DST change
    expect(dates.addDays("2026-11-01", -1n)).toBe("2026-10-31"); // a US DST change
    expect(dates.daysBetween("2024-02-28", "2024-03-01")).toBe(2n); // a leap day
    expect(dates.weekStart("2026-10-26")).toBe("2026-10-26"); // a Monday
    expect(dates.weekStart("2026-11-01")).toBe("2026-10-26"); // its Sunday
    expect(dates.weekStart("2027-01-01")).toBe("2026-12-28");
    expect(dates.dateRange("2026-10-30", "2026-11-02")).toEqual(["2026-10-30", "2026-10-31", "2026-11-01"]);
    expect(dates.dateRange("2026-10-30", "2026-10-30")).toEqual([]);
  });

  it("refuse what isn't a real day, and ranges too long to be a history", () => {
    expect(() => dates.addDays("2026-02-30", 1n)).toThrow(/not a day/);
    expect(() => dates.weekStart("26/10/2026")).toThrow(/not a day/);
    expect(() => dates.dateRange("2000-01-01", "2026-01-01")).toThrow(/at most/);
  });
});

describe("rules", () => {
  it("never throw into the app: an error gives null", () => {
    const rules = new Rules({ consts: {}, functions: {}, computed: {}, vectors: [] });
    expect(rules.evaluate("1 / 0")).toBeNull();
    expect(rules.evaluate("m.missing", { m: {} })).toBeNull();
    expect(rules.evaluate("addDays('not a day', 1)")).toBeNull();
    expect(rules.evaluate("2 + 2")).toBe(4);
    expect(rules.evaluate("xs.filter(x, x > 1).size()", { xs: [1, 2, 3] })).toBe(2);
    expect(rules.evaluate("['b', 'B', 'a', '10', '9'].sort()")).toEqual(["10", "9", "B", "a", "b"]);
    expect(
      rules.evaluate("days.filter(d, days[d].exists(e, e.done)).sort()", {
        days: { "2026-10-27": [{ done: true }], "2026-10-25": [], "2026-10-26": [{ done: true }] },
      }),
    ).toEqual(["2026-10-26", "2026-10-27"]);
  });

  it("refuse functions that call each other in a cycle, directly or through fold", () => {
    expect(cycleIn({ a: { params: [], cel: "b()" }, b: { params: [], cel: "a()" } })).toEqual(["a", "b", "a"]);
    expect(cycleIn({ step: { params: ["acc", "x"], cel: "fold([x], acc, 'step')" } })).toEqual(["step", "step"]);
    expect(cycleIn(habits().functions)).toBeNull();
    expect(logicProblems(withData({ ...habits(), functions: { a: { params: [], cel: "a()" } } }))[0]).toMatchObject({
      at: "/logic/functions",
      problem: expect.stringMatching(/cycle: a → a/),
    });
  });

  it("report an expression that doesn't parse, and a vector the rules don't reproduce, at its JSON Pointer", () => {
    expect(logicProblems(withData({ ...habits(), computed: { "/x": "1 +" } }))[0]).toMatchObject({
      at: "/logic/computed/~1x",
      problem: expect.stringMatching(/doesn't parse/),
    });
    const wrong = { ...habits(), vectors: [{ fn: "nextStreak", in: [3, 1], out: 3, from: "hint" as const }] };
    expect(logicProblems(withData(wrong))[0]).toEqual({ at: "/logic/vectors/0", problem: "nextStreak(3,1) gives 4, not 3" });
  });
});

describe("the example app's streak as CEL", () => {
  const rules = new Rules(habits());

  it("steps a streak: the next day adds one, the same day keeps it, a gap starts again", () => {
    const next = (cur: number, gap: number) => rules.apply("nextStreak", [cur, gap]);
    expect([next(3, 1), next(3, 0), next(3, 2), next(0, 0), next(0, 1)]).toEqual([4, 3, 1, 1, 1]);
  });

  it("gives the eight cases worked out by hand", () => {
    const { cases } = fixture("cases.json") as { cases: { id: string; today: string; checkins: string[]; best?: number; expect: unknown }[] };
    expect(cases).toHaveLength(8);
    for (const c of cases) expect(rules.apply("streakFromHistory", [c.checkins, c.today, c.best ?? 0]), c.id).toEqual(c.expect);
  });

  it("matches a vector whatever the order of its keys", () => {
    const v = { fn: "streakFromHistory", in: [["2026-10-27"], "2026-10-27", 0], out: { risk: false, best: 1, streak: 1 }, from: "hint" as const };
    expect(logicProblems(withData({ ...habits(), vectors: [v] }))).toEqual([]);
  });

  it("counts a day once, however many habits it has", () => {
    const days = { "2026-10-26": [{ done: true }, { done: true }, { done: true }], "2026-10-27": [{ done: true }] };
    expect(rules.apply("checkins", [days])).toEqual(["2026-10-26", "2026-10-27"]);
    expect(rules.apply("streakFromHistory", [rules.apply("checkins", [days]), "2026-10-27", 0])).toEqual({ streak: 2, best: 2, risk: false });
  });
});

describe("totality", () => {
  it("never throws, whatever the expression or input: a value or null", async () => {
    const fc = await import("fast-check");
    const rules = new Rules(habits());
    const piece = fc.constantFrom(
      "1",
      "0",
      "-1",
      "x",
      "xs",
      "null",
      '"a"',
      "[1, 2]",
      "{'k': 1}",
      "addDays(x, 1)",
      "weekStart(x)",
      "fold(xs, 0, 'nope')",
      "nextStreak(x, 1)",
    );
    const op = fc.constantFrom(" + ", " - ", " * ", " / ", " % ", " == ", " < ", " && ", " ? 1 : ");
    const expr = fc.tuple(piece, op, piece).map(([a, o, b]) => `${a}${o}${b}`);
    const input = fc.record({
      x: fc.oneof(fc.integer(), fc.string(), fc.constant("2026-10-26"), fc.constant(null)),
      xs: fc.array(fc.integer(), { maxLength: 5 }),
    });
    fc.assert(
      fc.property(expr, input, (e, vars) => {
        expect(() => rules.evaluate(e, vars)).not.toThrow();
      }),
      { numRuns: 500 },
    );
  });
});
