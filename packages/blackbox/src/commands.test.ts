import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { build, preview, validate } from "./commands.js";

// The CLI's commands: validate says what's wrong (or that it's ready), build
// writes the same page the compiler golden pins, and preview serves it under
// CloudCrane's own security policy.

const SPEC = new URL("../../../fixtures/habits/spec.json", import.meta.url).pathname;
const GOLDEN = readFileSync(new URL("../../app-runtime/golden/habits.sha256", import.meta.url), "utf8").trim();
const dir = mkdtempSync(join(tmpdir(), "blackbox-"));

describe("blackbox", () => {
  it("validate: ready for a good spec, every problem for a bad one", () => {
    expect(validate(SPEC)).toEqual({ ok: true, lines: [expect.stringMatching(/ready\. 3 journeys, 3 promises, \d+ rules\./)] });
    const bad = JSON.parse(readFileSync(SPEC, "utf8"));
    bad.module.purpose = "see lib/theme.dart";
    bad.extra = 1;
    writeFileSync(join(dir, "bad.json"), JSON.stringify(bad));
    const out = validate(join(dir, "bad.json"));
    expect(out.ok).toBe(false);
    expect(out.lines.join("\n")).toMatch(/Unrecognized key/);
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
      expect(await res.text()).toContain('id="cc-spec"');
      expect((await fetch(`${url}secrets.json`)).status).toBe(404);
    } finally {
      server.close();
    }
  });
});
