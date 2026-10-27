import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { surfaceProblems } from "./a2ui.js";
import { canonical } from "./canonical.js";
import { CATALOG, sampleSpec } from "./fixtures.js";
import { validateSpec } from "./validate.js";

// A spec is an A2UI surface in an envelope. Its surface is held to A2UI's own
// schemas and rules (A2UI's examples are the conformance set); the envelope is
// strict, so nothing can hide in a field the spec doesn't define.

const EXAMPLES = new URL("../vendor/a2ui/v0_9_1/catalogs/basic/examples/", import.meta.url);
const problemsOf = (change: (s: ReturnType<typeof sampleSpec>) => void) => {
  const s = sampleSpec();
  change(s);
  return validateSpec(s)
    .problems.map((p) => `${p.at}: ${p.problem}`)
    .join("\n");
};

describe("the A2UI surface", () => {
  it("accepts every example A2UI ships for its basic catalog", () => {
    const files = readdirSync(EXAMPLES).filter((f) => f.endsWith(".json"));
    expect(files.length).toBeGreaterThan(20);
    for (const f of files) {
      const { messages } = JSON.parse(readFileSync(new URL(f, EXAMPLES), "utf8")) as { messages: unknown[] };
      // Examples may stream extra surfaces or data updates; the schema check alone applies to every message.
      const shapeOnly = surfaceProblems(messages).filter((p) => p.at.startsWith("surface.messages[") && !/surfaceId|only one|never deletes/.test(p.problem));
      expect(shapeOnly, f).toEqual([]);
    }
  });

  it("refuses a component the catalog doesn't have, a missing root, a missing child and a duplicate id", () => {
    const comps = (s: ReturnType<typeof sampleSpec>) =>
      (s.surface.messages[1] as { updateComponents: { components: Record<string, unknown>[] } }).updateComponents.components;
    expect(problemsOf((s) => (comps(s)[1]!["component"] = "Hologram"))).toMatch(/surface\.messages\[1\]/);
    expect(problemsOf((s) => (comps(s)[0]!["id"] = "top"))).toMatch(/no component has the id "root"/);
    expect(problemsOf((s) => ((comps(s)[0]!["children"] as string[])[1] = "nowhere"))).toMatch(/child "nowhere" doesn't exist/);
    expect(problemsOf((s) => (comps(s)[2]!["id"] = "title"))).toMatch(/duplicate id/);
  });

  it("is one surface: created first, never deleted, one id throughout", () => {
    expect(problemsOf((s) => s.surface.messages.reverse())).toMatch(/must be createSurface/);
    expect(problemsOf((s) => s.surface.messages.push({ version: "v0.9.1", deleteSurface: { surfaceId: "plans" } }))).toMatch(/never deletes/);
    expect(problemsOf((s) => ((s.surface.messages[1] as { updateComponents: { surfaceId: string } }).updateComponents.surfaceId = "other"))).toMatch(
      /surfaceId must be plans/,
    );
    expect(problemsOf((s) => (s.surface.catalog = "https://cloudcrane.ai/catalogs/app/v1.json"))).toMatch(/must be the catalog createSurface names/);
  });
});

describe("the envelope", () => {
  it("accepts a well-formed spec", () => {
    expect(validateSpec(sampleSpec()).problems).toEqual([]);
    expect(validateSpec(sampleSpec()).spec?.module.id).toBe("plans");
  });

  it("refuses a field it doesn't define, anywhere", () => {
    expect(problemsOf((s) => ((s as Record<string, unknown>)["code"] = "function f() {}"))).toMatch(/Unrecognized key/);
    expect(problemsOf((s) => ((s.module as Record<string, unknown>)["source"] = "lib/main.dart"))).toMatch(/Unrecognized key/);
    expect(problemsOf((s) => ((s.logic.functions["isStreakBroken"] as Record<string, unknown>)["js"] = "x"))).toMatch(/Unrecognized key/);
  });

  it("holds a hash of the source, never the source", () => {
    expect(problemsOf((s) => (s.manifest.source.fingerprint = "lib/theme.dart"))).toMatch(/sha256/);
  });

  it("takes DTCG tokens: a token has $value, a group holds tokens, and a token isn't a group", () => {
    expect(problemsOf((s) => ((s.tokens as Record<string, unknown>)["color"] = { $type: "colour" }))).toMatch(/tokens\.color\.\$type/);
    expect(problemsOf((s) => ((s.tokens as Record<string, unknown>)["x"] = { $value: 1, nested: { $value: 2 } }))).toMatch(/can't also be a group/);
  });

  it("checks ids, journey numbering, vectors, migrations and mod points", () => {
    expect(problemsOf((s) => (s.journeys[0]!.steps[0]!.id = "J-2.1"))).toMatch(/numbered J-1\.n/);
    expect(problemsOf((s) => (s.promises[0]!.id = "J-1" as `P-${number}`))).toMatch(/promises/);
    expect(problemsOf((s) => (s.logic.vectors[0]!.fn = "nextStreak"))).toMatch(/no such function/);
    expect(problemsOf((s) => s.data.migrations.push({ from: 1, to: 3, cel: "saved" }))).toMatch(/one version at a time/);
    expect(problemsOf((s) => s.mods.open.push("/network/*"))).toMatch(/both open and locked/);
    expect(problemsOf((s) => (s.mods.open = ["tokens"]))).toMatch(/JSON Pointer/);
  });

  it("lists no more than five sites, each a bare host", () => {
    expect(problemsOf((s) => (s.network = [{ site: "https://example.com/api", why: "x" }]))).toMatch(/network\[0\]\.site/);
    expect(problemsOf((s) => (s.network = Array.from({ length: 6 }, (_, i) => ({ site: `s${i}.example.com`, why: "x" }))))).toMatch(/network/);
  });
});

describe("canonical JSON (RFC 8785)", () => {
  it("is the same bytes whatever the key order", () => {
    expect(canonical({ b: 1, a: [2, { d: 1, c: 0.1 }] })).toBe(canonical({ a: [2, { c: 0.1, d: 1 }], b: 1 }));
    expect(canonical({ n: 1e21, f: 0.000001 })).toBe('{"f":0.000001,"n":1e+21}');
  });

  it("puts the same spec in the same bytes", () => {
    const a = sampleSpec();
    // The same spec with every object's keys in reverse order.
    const reversed = (v: unknown): unknown =>
      Array.isArray(v)
        ? v.map(reversed)
        : v && typeof v === "object"
          ? Object.fromEntries(
              Object.entries(v)
                .reverse()
                .map(([k, x]) => [k, reversed(x)]),
            )
          : v;
    const b = reversed(a);
    expect(JSON.stringify(b)).not.toBe(JSON.stringify(a));
    expect(canonical(validateSpec(b).spec)).toBe(canonical(validateSpec(a).spec));
  });
});

it("validates against the CATALOG it names", () => {
  expect(CATALOG).toMatch(/basic\/catalog\.json$/);
});
