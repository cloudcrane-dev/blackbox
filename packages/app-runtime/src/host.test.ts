import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// The host bundle CloudCrane vendors: built by vendor.mjs, it runs on its own
// (zod from the host), exports what host.d.ts declares, and builds the same
// page as the compiler here.

const spec = () => JSON.parse(readFileSync(new URL("../../../fixtures/habits/spec.json", import.meta.url), "utf8"));
const golden = readFileSync(new URL("../golden/habits.sha256", import.meta.url), "utf8").trim();

describe("the host bundle", () => {
  const out = mkdtempSync(join(tmpdir(), "host-"));
  execFileSync("node", ["vendor.mjs", out], { cwd: new URL("..", import.meta.url) });

  it("exports what its types declare, and builds the golden page", async () => {
    const host = await import(join(out, "blackbox.mjs"));
    const declared = [...readFileSync(join(out, "blackbox.d.mts"), "utf8").matchAll(/^export (?:function|class|const) (\w+)/gm)].map((m) => m[1]).sort();
    expect(Object.keys(host).sort()).toEqual(declared);
    expect(host.compile(spec()).sha256).toBe(golden);
    expect(host.deriveBlueprint(host.validateSpec(spec()).spec).purpose).toBe(spec().module.purpose);
  });

  it("records where it came from and each file's hash", () => {
    const vendor = JSON.parse(readFileSync(join(out, "VENDOR.json"), "utf8"));
    expect(vendor.runtime).toBe("0.4.0");
    expect(Object.keys(vendor.files).sort()).toEqual(["blackbox.d.mts", "blackbox.mjs"]);
    expect(vendor.commit).toMatch(/^[0-9a-f]{40}$/);
  });
});
