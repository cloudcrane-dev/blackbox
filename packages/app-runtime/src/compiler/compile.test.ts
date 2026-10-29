import { readFileSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { compile, CompileError, runtimeFile } from "./compile.js";
import { RUNTIME_JS, RUNTIME_SHA256, RUNTIME_VERSION } from "./runtime.generated.js";
import { createHash } from "node:crypto";
import { wrapPage } from "@cloudcrane/app-spec";

// The compiler is a pure function: the same spec always gives the same page
// (golden hashes pin it), it refuses what it can't build, it keeps the page in
// budget, and no text in a spec can break out of the page's data.
// Regenerate goldens on purpose with: UPDATE_GOLDEN=1 pnpm test

const ROOT = new URL("../../../../", import.meta.url);
const habits = () => JSON.parse(readFileSync(new URL("fixtures/habits/spec.json", ROOT), "utf8"));
const GOLDEN = new URL("../../golden/habits.sha256", import.meta.url);
const GOLDEN_SHARED = new URL("../../golden/habits.shared.sha256", import.meta.url);

describe("the compiler", () => {
  it("gives the same page for the same spec, whatever its key order", () => {
    const a = compile(habits());
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
    expect(compile(reversed(habits())).sha256).toBe(a.sha256);
    expect(a.sha256).toBe(createHash("sha256").update(a.html).digest("hex"));
  });

  it("matches the golden page for the example app", () => {
    const { sha256 } = compile(habits());
    if (process.env["UPDATE_GOLDEN"] === "1") writeFileSync(GOLDEN, `${sha256}\n`);
    expect(readFileSync(GOLDEN, "utf8").trim()).toBe(sha256);
  });

  it("can link the runtime instead of inlining it: one file, named by version and hash, held to its bytes by an integrity hash", () => {
    const file = runtimeFile();
    expect(file.js).toBe(RUNTIME_JS);
    expect(file.path).toBe(`/_cc/runtime/${RUNTIME_VERSION}-${RUNTIME_SHA256.slice(0, 12)}.js`);
    expect(file.integrity).toBe(`sha256-${createHash("sha256").update(RUNTIME_JS).digest("base64")}`);

    const shared = compile(habits(), { runtime: "shared" });
    expect(shared.html).not.toContain(RUNTIME_JS.slice(0, 200));
    expect(shared.html).toContain(`<script type="module" src="${file.path}" integrity="${file.integrity}"></script>`);
    expect(shared.linked).toEqual({ path: file.path, integrity: file.integrity });
    expect(Buffer.byteLength(shared.html)).toBeLessThan(64 * 1024);
    expect(compile(habits(), { runtime: "shared" }).sha256).toBe(shared.sha256);
    if (process.env["UPDATE_GOLDEN"] === "1") writeFileSync(GOLDEN_SHARED, `${shared.sha256}\n`);
    expect(readFileSync(GOLDEN_SHARED, "utf8").trim()).toBe(shared.sha256);
    // Inline is the default, and links nothing.
    expect(compile(habits(), { runtime: "inline" }).html).toBe(compile(habits()).html);
    expect(compile(habits()).linked).toBeUndefined();
    expect(() => compile(habits(), { runtime: "cdn" as never })).toThrow(/inline or shared/);
  });

  it("inlines the runtime it was locked to, and names it", () => {
    const lock = JSON.parse(readFileSync(new URL("../../runtime-lock.json", import.meta.url), "utf8")) as Record<string, string>;
    expect(lock[RUNTIME_VERSION]).toBe(RUNTIME_SHA256);
    expect(createHash("sha256").update(RUNTIME_JS).digest("hex")).toBe(RUNTIME_SHA256);
    const { html, runtime } = compile(habits());
    expect(html).toContain(RUNTIME_JS);
    expect(runtime).toBe(`@cloudcrane/app-runtime@${RUNTIME_VERSION}+${RUNTIME_SHA256.slice(0, 12)}`);
    expect(html).toContain(`<meta name="cc-runtime" content="${RUNTIME_VERSION}">`);
  });

  it("keeps the page within budget: 650 KB, well inside CloudCrane's 1 MB", () => {
    expect(Buffer.byteLength(compile(habits()).html)).toBeLessThan(650 * 1024);
  });

  it("refuses a spec with problems, or for another runtime, saying why", () => {
    const bad = habits();
    bad.module.purpose = "Built from lib/screens/home_screen.dart";
    expect(() => compile(bad)).toThrow(CompileError);
    expect(() => compile(bad)).toThrow(/source file path/);
    const other = habits();
    other.manifest.runtime = "9.9.9";
    expect(() => compile(other)).toThrow(/this compiler builds runtime/);
  });

  it("keeps the spec's text inside the page's data, whatever it says", () => {
    const s = habits();
    s.module.name = "</script><b>Habits</b>";
    s.surface.messages[2].updateComponents.components[1].text = "</script><script>alert(1)</script>";
    const { html } = compile(s);
    expect(html.match(/<\/script>/g)).toHaveLength(2); // only the page's own two scripts close
    expect(html).toContain("<title>&lt;/script&gt;&lt;b&gt;Habits&lt;/b&gt;</title>");
  });

  it("puts only what drawing needs in the page: no journeys, promises or tests", () => {
    const { html } = compile(habits());
    const data = JSON.parse(html.match(/<script type="application\/json" id="cc-spec">([\s\S]*?)<\/script>/)![1]!);
    expect(Object.keys(data).sort()).toEqual(["data", "logic", "module", "surface"]);
  });

  it("gives back an HTML app's page as written, with no runtime, for any runtime the spec names", () => {
    const html = '<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><main>Hi</main></body></html>';
    const app = {
      id: "hello",
      name: "Hello",
      purpose: "Says hello.",
      html,
      generator: "cloudcrane, from an HTML app",
      data: { version: 1, key: "hello" },
      journeys: [{ id: "J-1", title: "Open it", steps: [{ id: "J-1.1", text: "See hello" }] }],
    };
    for (const runtime of [RUNTIME_VERSION, "0.0.0"]) {
      for (const mode of ["inline", "shared"] as const) {
        const out = compile(wrapPage({ ...app, runtime }), { runtime: mode });
        expect(out).toEqual({ html, sha256: createHash("sha256").update(html).digest("hex"), runtime: "page" });
      }
    }
  });
});
