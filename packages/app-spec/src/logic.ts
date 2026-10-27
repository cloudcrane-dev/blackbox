import { Environment } from "@marcbachmann/cel-js";
import type { Problem } from "./a2ui.js";
import { canonical } from "./canonical.js";
import type { Spec } from "./schema.js";

// A spec's rules are CEL (cel.dev, via @marcbachmann/cel-js): no loops, no I/O,
// always terminates. On top of CEL's standard library and macros (map, filter,
// exists, all, cel.bind), the runtime registers, as cel-go's extension libraries
// do:
//   - days as "YYYY-MM-DD": addDays, daysBetween, weekStart (Monday), dateRange
//     (from, inclusive, to, exclusive; capped);
//   - list.sort(): as cel-go's ext.Lists, in code-unit order (never the locale);
//   - fold(list, init, "fn"): a named spec function applied as (acc, item) over
//     the list, CEL's comprehension with a named step, for rules that carry state
//     across a history (a streak). Bounded by the list's length.
// Spec functions call each other but never in a cycle (checked), and a call
// depth guard backs that up. Any error in an expression gives null: a rule never
// throws into the app.

type Logic = Spec["logic"];
type CelValue = unknown;

export const MAX_RANGE = 3660;
const MAX_DEPTH = 64;
const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** JSON in: whole numbers become CEL ints (BigInt). */
export function toCel(v: unknown): CelValue {
  if (typeof v === "number" && Number.isInteger(v)) return BigInt(v);
  if (Array.isArray(v)) return v.map(toCel);
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, toCel(x)]));
  return v;
}

/** CEL out: ints become numbers again, so results are plain JSON. */
export function fromCel(v: CelValue): unknown {
  if (typeof v === "bigint") return Number(v);
  if (Array.isArray(v)) return v.map(fromCel);
  if (v instanceof Map) return Object.fromEntries([...v].map(([k, x]) => [String(k), fromCel(x)]));
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, fromCel(x)]));
  return v;
}

/** Whole days since 1970-01-01 for a real "YYYY-MM-DD", in UTC so no clock or zone can move it. */
function dayNumber(s: string): number {
  const m = DAY.exec(s);
  if (!m) throw new Error(`not a day: ${s}`);
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const t = Date.UTC(y, mo - 1, d);
  const back = new Date(t);
  if (back.getUTCFullYear() !== y || back.getUTCMonth() !== mo - 1 || back.getUTCDate() !== d) throw new Error(`not a day: ${s}`);
  return t / 86_400_000;
}
const dayString = (n: number) => new Date(n * 86_400_000).toISOString().slice(0, 10);

export const dates = {
  addDays: (s: string, n: bigint) => dayString(dayNumber(s) + Number(n)),
  daysBetween: (a: string, b: string) => BigInt(dayNumber(b) - dayNumber(a)),
  /** The Monday that starts s's week. */
  weekStart: (s: string) => {
    const n = dayNumber(s);
    return dayString(n - ((new Date(n * 86_400_000).getUTCDay() + 6) % 7));
  },
  dateRange: (a: string, b: string) => {
    const [from, to] = [dayNumber(a), dayNumber(b)];
    if (to - from > MAX_RANGE) throw new Error(`a range of at most ${MAX_RANGE} days`);
    const out: string[] = [];
    for (let n = from; n < to; n++) out.push(dayString(n));
    return out;
  },
};

/** Function names a CEL expression calls, by name or as a fold step ("name"). */
function callsIn(cel: string, names: Set<string>): string[] {
  const out = new Set<string>();
  for (const m of cel.matchAll(/([A-Za-z_][A-Za-z0-9_]*)\s*\(/g)) if (names.has(m[1]!)) out.add(m[1]!);
  for (const m of cel.matchAll(/(["'])([A-Za-z_][A-Za-z0-9_]*)\1/g)) if (names.has(m[2]!)) out.add(m[2]!);
  return [...out];
}

/** A cycle among the spec's functions, as names, or null. */
export function cycleIn(functions: Logic["functions"]): string[] | null {
  const names = new Set(Object.keys(functions));
  const edges = new Map([...names].map((n) => [n, callsIn(functions[n]!.cel, names)]));
  const state = new Map<string, "open" | "done">();
  const walk = (n: string, path: string[]): string[] | null => {
    if (state.get(n) === "open") return [...path.slice(path.indexOf(n)), n];
    if (state.get(n) === "done") return null;
    state.set(n, "open");
    for (const m of edges.get(n) ?? []) {
      const found = walk(m, [...path, n]);
      if (found) return found;
    }
    state.set(n, "done");
    return null;
  };
  for (const n of names) {
    const found = walk(n, []);
    if (found) return found;
  }
  return null;
}

/** The rules of one spec, ready to evaluate. */
export class Rules {
  private readonly env: Environment;
  private readonly consts: Record<string, CelValue>;
  private depth = 0;

  constructor(private readonly logic: Logic) {
    this.consts = toCel(logic.consts) as Record<string, CelValue>;
    const env = new Environment({ unlistedVariablesAreDyn: true, homogeneousAggregateLiterals: false });
    env.registerFunction("addDays(string, int): string", dates.addDays);
    env.registerFunction("daysBetween(string, string): int", dates.daysBetween);
    env.registerFunction("weekStart(string): string", dates.weekStart);
    env.registerFunction("dateRange(string, string): list<string>", dates.dateRange);
    env.registerFunction("list.sort(): list", (list: CelValue[]) => [...list].sort((a, b) => (a! < b! ? -1 : a! > b! ? 1 : 0)));
    env.registerFunction("fold(list, dyn, string): dyn", (list: CelValue[], init: CelValue, step: string) => {
      if (!(step in logic.functions)) throw new Error(`fold: no function ${step}`);
      return list.reduce((acc, item) => this.call(step, [acc, item]), init);
    });
    for (const [name, fn] of Object.entries(logic.functions)) {
      env.registerFunction(`${name}(${fn.params.map(() => "dyn").join(", ")}): dyn`, (...args: CelValue[]) => this.call(name, args));
    }
    this.env = env;
  }

  private call(name: string, args: CelValue[]): CelValue {
    const fn = this.logic.functions[name]!;
    if (++this.depth > MAX_DEPTH) {
      this.depth = 0;
      throw new Error("calls nest too deep");
    }
    try {
      return this.env.evaluate(fn.cel, { ...this.consts, ...Object.fromEntries(fn.params.map((p, i) => [p, args[i] ?? null])) });
    } finally {
      this.depth--;
    }
  }

  /** An expression's value, as JSON; null when it can't be worked out. */
  evaluate(cel: string, vars: Record<string, unknown> = {}): unknown {
    try {
      this.depth = 0;
      return fromCel(this.env.evaluate(cel, { ...this.consts, ...(toCel(vars) as Record<string, CelValue>) }));
    } catch {
      return null;
    }
  }

  /** A spec function applied to JSON arguments; null when it can't be worked out. */
  apply(name: string, args: unknown[]): unknown {
    try {
      this.depth = 0;
      return fromCel(this.call(name, args.map(toCel)));
    } catch {
      return null;
    }
  }

  /** Why an expression won't parse, or null when it does. */
  parseError(cel: string): string | null {
    try {
      this.env.parse(cel);
      return null;
    } catch (e) {
      return (e as Error).message.split("\n")[0] ?? "doesn't parse";
    }
  }
}

/** Equal as JSON values, whatever the key order (RFC 8785 canonical form). */
const same = (a: unknown, b: unknown) => canonical(a ?? null) === canonical(b ?? null);

/** A key as one JSON Pointer token (RFC 6901). */
const token = (k: string) => k.replace(/~/g, "~0").replace(/\//g, "~1");

/** Problems with a spec's rules, each at its JSON Pointer: expressions that don't parse, a call cycle, vectors the rules don't reproduce. */
export function logicProblems(spec: Pick<Spec, "logic" | "data">): Problem[] {
  const problems: Problem[] = [];
  const cycle = cycleIn(spec.logic.functions);
  if (cycle) return [{ at: "/logic/functions", problem: `functions call each other in a cycle: ${cycle.join(" → ")}` }];
  const rules = new Rules(spec.logic);
  const each: [string, string][] = [
    ...Object.entries(spec.logic.functions).map(([n, f]): [string, string] => [`/logic/functions/${token(n)}/cel`, f.cel]),
    ...Object.entries(spec.logic.computed).map(([p, cel]): [string, string] => [`/logic/computed/${token(p)}`, cel]),
    ...spec.data.migrations.map((m, i): [string, string] => [`/data/migrations/${i}/cel`, m.cel]),
  ];
  for (const [at, cel] of each) {
    const why = rules.parseError(cel);
    if (why) problems.push({ at, problem: `doesn't parse: ${why}` });
  }
  if (problems.length) return problems;
  spec.logic.vectors.forEach((v, i) => {
    const got = rules.apply(v.fn, v.in);
    if (!same(got, v.out))
      problems.push({
        at: `/logic/vectors/${i}`,
        problem: `${v.fn}(${JSON.stringify(v.in).slice(1, -1)}) gives ${JSON.stringify(got)}, not ${JSON.stringify(v.out)}`,
      });
  });
  return problems;
}
