import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { build, coverage, preview, validate } from "./commands.js";

// The CLI's commands: validate says what's wrong (or that it's ready), build
// writes the same page the compiler golden pins, and preview serves it under
// CloudCrane's own security policy.

const SPEC = new URL("../../../fixtures/habits/spec.json", import.meta.url).pathname;
const GOLDEN = readFileSync(new URL("../../app-runtime/golden/habits.sha256", import.meta.url), "utf8").trim();
const dir = mkdtempSync(join(tmpdir(), "blackbox-"));

describe("blackbox", () => {
  it("validate: ready for a good spec, every problem for a bad one", () => {
    const ready = validate(SPEC);
    expect(ready.ok).toBe(true);
    expect(ready.lines[0]).toMatch(/ready\. 3 journeys, 3 promises, \d+ rules\./);
    // Ready, and told which rules nothing checks yet: the example's composed rules have no examples of their own.
    expect(ready.lines.slice(1).join("\n")).toMatch(/streakStep, streakFromHistory, checkins, dayStatus have no examples/);
    const bad = JSON.parse(readFileSync(SPEC, "utf8"));
    bad.module.purpose = "see lib/theme.dart";
    bad.extra = 1;
    writeFileSync(join(dir, "bad.json"), JSON.stringify(bad));
    const out = validate(join(dir, "bad.json"));
    expect(out.ok).toBe(false);
    expect(out.lines.join("\n")).toMatch(/Unrecognized key/);
    // Ready, and still told what would make it better: the habits spec without its dark colours.
    const light = JSON.parse(readFileSync(SPEC, "utf8"));
    delete light.tokens.dark;
    writeFileSync(join(dir, "light.json"), JSON.stringify(light));
    const better = validate(join(dir, "light.json"));
    expect(better.ok).toBe(true);
    expect(better.lines.join("\n")).toMatch(/2 things to make it better:\n {4}tokens: no dark colours/);
  });

  it("build: writes the golden page", () => {
    const out = join(dir, "app.html");
    const r = build(SPEC, out);
    expect(r.ok).toBe(true);
    expect(r.lines[0]).toContain(GOLDEN);
    expect(readFileSync(out, "utf8")).toMatch(/^<!doctype html>/);
  });

  it("build: says why it can't", () => {
    const bad = JSON.parse(readFileSync(SPEC, "utf8"));
    bad.module.purpose = "Built from lib/screens/home_screen.dart";
    writeFileSync(join(dir, "leaky.json"), JSON.stringify(bad));
    expect(build(join(dir, "leaky.json"))).toEqual({
      ok: false,
      lines: [expect.stringContaining("can't be built"), expect.stringMatching(/source file path/)],
    });
  });

  it("preview: serves the app under CloudCrane's policy, and nothing else", async () => {
    const { server, url } = await preview(SPEC, 0);
    try {
      const res = await fetch(url);
      expect(res.status).toBe(200);
      const csp = res.headers.get("content-security-policy")!;
      expect(csp).toContain("default-src 'none'");
      expect(csp).toContain("connect-src 'self'");
      expect(csp).not.toContain("unsafe-eval");
      // The phone features it declares (none here), and nothing else, as CloudCrane serves it.
      const permissions = res.headers.get("permissions-policy")!;
      expect(permissions).toContain("camera=()");
      expect(permissions).toContain("geolocation=()");
      expect(permissions).toContain("payment=()");
      expect(await res.text()).toContain('id="cc-spec"');
      expect((await fetch(`${url}secrets.json`)).status).toBe(404);
    } finally {
      server.close();
    }
  });

  it("coverage: adds up what specs are drawn with, coded components by what they replace, most needed first", () => {
    const fixture = (name: string) => new URL(`../../../fixtures/${name}/spec.json`, import.meta.url).pathname;
    const snake = JSON.parse(readFileSync(fixture("snake"), "utf8"));
    const name = Object.keys(snake.components)[0]!;
    snake.components[name].replaces = "SnakeGameWidget";
    writeFileSync(join(dir, "snake.json"), JSON.stringify(snake));
    const out = coverage([SPEC, join(dir, "snake.json"), fixture("notes")]);
    expect(out.ok).toBe(true);
    expect(out.lines[0]).toMatch(/^3 specs: \d+ catalog components placed, 2 coded components \(\d+% drawn by the catalog\)\.$/);
    const text = out.lines.join("\n");
    expect(text).toMatch(/SnakeGameWidget: 1 spec, placed 1 time/);
    expect(text).toMatch(/\(a whole page\): 1 spec/);
    expect(text).toMatch(/Catalog components used:\n {2}\w+: \d+/);
  });
});
