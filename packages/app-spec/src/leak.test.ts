import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { sampleSpec } from "./fixtures.js";
import { leakProblems } from "./leak.js";

// The leak scan: one bad spec per kind of leak, each refused, and real specs
// (and the A2UI examples) let through, so it neither misses nor cries wolf.

const leaking = (where: (s: ReturnType<typeof sampleSpec>, x: string) => void, x: string) => {
  const s = sampleSpec();
  where(s, x);
  return leakProblems(s)
    .map((p) => p.problem)
    .join("; ");
};
const inPurpose = (s: ReturnType<typeof sampleSpec>, x: string) => (s.module.purpose = x);

describe("the leak scan", () => {
  it("lets a clean spec, the example app's CEL rules and A2UI's own examples through", () => {
    expect(leakProblems(sampleSpec())).toEqual([]);
    const logic = JSON.parse(readFileSync(new URL("../../../fixtures/habits/logic.json", import.meta.url), "utf8"));
    expect(leakProblems({ logic })).toEqual([]);
    // Every example A2UI ships, held as a spec's surface: real UI text must not read as a leak.
    const dir = new URL("../vendor/a2ui/v0_9_1/catalogs/basic/examples/", import.meta.url);
    for (const f of readdirSync(dir).filter((x) => x.endsWith(".json"))) {
      const { messages } = JSON.parse(readFileSync(new URL(f, dir), "utf8")) as { messages: unknown[] };
      // A2UI's sample data has made-up people in it (emails, a phone number): refusing those is right.
      expect(
        leakProblems({ surface: { messages } }).filter((p) => !p.problem.endsWith("(personal)")),
        f,
      ).toEqual([]);
    }
  });

  it.each([
    ["a source path", "Built from lib/screens/home_screen.dart", /source file path/],
    ["a file:line", "see streak-rules.ts:42", /file:line/],
    ["an absolute path", "/Users/someone/projects/app", /absolute path/],
    ["a package folder", "node_modules/foo", /package folder/],
    ["an arrow function", "(x) => x + 1", /arrow function/],
    ["a function", "function isStreakBroken(d, t) { return d > t }", /function definition/],
    ["an import", "import { storage } from '../storage'", /import/],
    ["a class", "class WorkoutScreen extends StatefulWidget", /class definition/],
    ["a widget builder", "Widget build(BuildContext context)", /widget builder/],
    ["a declaration", "const WEEKLY_TOKENS = 2", /variable declaration/],
    ["code punctuation", "if (a) { b(); } else { c(); }", /statement punctuation/],
    ["an AWS key", "AKIAIOSFODNN7EXAMPLE", /AWS access key/],
    ["an API key", "sk-proj-abcdefghijklmnopqrstuvwxyz123456", /API key/],
    ["a Google key", "AIzaSyD-abcdefghijklmnopqrstuvwxyz12345", /API key/],
    ["a JWT", "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abc", /JSON Web Token/],
    ["a private key", "-----BEGIN RSA PRIVATE KEY-----", /private key/],
    ["a random token", "Xk9fQ2mLp7Rz4vWb8Tn3Hy6Jc1Gd5Se0", /random-looking/],
    ["an email", "Questions to asha@example.com", /email/],
    ["a phone number", "Call +91 98765 43210", /phone number/],
    ["an internal host", "https://api.example.internal/v1", /internal address/],
    ["a key in a URL", "https://api.example.com/v1?key=AIzaSyD-abcdefghijklmnopqrstuvwxyz12345", /API key/],
    ["localhost", "http://localhost:5055", /internal address/],
  ])("refuses %s", (_, text, why) => {
    expect(leaking(inPurpose, text)).toMatch(why);
  });

  it("looks everywhere: deep in the surface, in object keys, and in CEL (except for code shapes)", () => {
    expect(
      leaking((s, x) => {
        const c = (s.surface.messages[1] as { updateComponents: { components: Record<string, unknown>[] } }).updateComponents.components;
        c[1]!["text"] = x;
      }, "lib/theme.dart"),
    ).toMatch(/source file path/);
    expect(leaking((s, x) => ((s.tokens as Record<string, unknown>)[x] = { $value: 1 }), "AKIAIOSFODNN7EXAMPLE")).toMatch(/AWS/);
    expect(leaking((s, x) => (s.logic.functions["isStreakBroken"]!.cel = x), "d > 1 ? 'asha@example.com' : ''")).toMatch(/email/);
    expect(leaking((s, x) => (s.logic.functions["isStreakBroken"]!.cel = x), "a && b ? {'k': 1} : {'k': 2}")).toBe("");
  });

  it("doesn't cry wolf at ordinary words, numbers, colours or days", () => {
    for (const ok of ["Tick an exercise off when it's done", "3 × 10", "#0f766e", "2026-10-26", "Best 12 · 3 days in a row", "Inter", "48 by 64"])
      expect(leaking(inPurpose, ok), ok).toBe("");
  });

  it("skips the source fingerprint, which is a hash by design", () => {
    expect(leakProblems(sampleSpec()).filter((p) => p.at.startsWith("/manifest"))).toEqual([]);
  });
});

// Against a real codebase, which never comes into this repo: point
// BLACKBOX_LEAK_CORPUS at an app's source and every line of code dropped into a
// spec must be refused (at least 95%). Run before each release on a partner app.
describe.skipIf(!process.env["BLACKBOX_LEAK_CORPUS"])("on a real codebase", () => {
  it("refuses at least 95% of its lines of code", async () => {
    const { readdirSync: ls, statSync } = await import("node:fs");
    const { join } = await import("node:path");
    const files: string[] = [];
    const walk = (d: string) => {
      for (const f of ls(d)) {
        const p = join(d, f);
        if (statSync(p).isDirectory()) {
          if (!/^(node_modules|\.git|build|dist|\.dart_tool)$/.test(f)) walk(p);
        } else if (/\.(dart|ts|tsx|js|kt|swift)$/.test(f)) files.push(p);
      }
    };
    walk(process.env["BLACKBOX_LEAK_CORPUS"]!);
    const lines = files
      .flatMap((f) => readFileSync(f, "utf8").split("\n"))
      .map((l) => l.trim())
      .filter((l) => l.length > 25 && !/^(\/\/|\*|\/\*)/.test(l) && /[(){};=<>]/.test(l));
    let seed = 1;
    const next = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
    const picked = Array.from({ length: 1000 }, () => lines[Math.floor(next() * lines.length)]!);
    const missed = picked.filter((l) => leaking(inPurpose, l) === "");
    expect(missed.length / picked.length, missed.slice(0, 10).join("\n")).toBeLessThan(0.05);
  });
});
