import { readFileSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { specJsonSchema } from "./jsonschema.js";

// schema/app-spec.v1.json is the spec's JSON Schema for tools outside
// TypeScript. It's generated from SpecSchema; this fails when the two drift.
// Regenerate with: UPDATE_SCHEMA=1 pnpm test

const FILE = new URL("../schema/app-spec.v1.json", import.meta.url);

describe("the published JSON Schema", () => {
  it("matches the schema the code checks", () => {
    const now = `${JSON.stringify(specJsonSchema(), null, 2)}\n`;
    if (process.env["UPDATE_SCHEMA"] === "1") writeFileSync(FILE, now);
    expect(readFileSync(FILE, "utf8")).toBe(now);
  });

  it("is strict: no property the spec doesn't define", () => {
    const schema = specJsonSchema() as { additionalProperties?: unknown; required?: string[] };
    expect(schema.additionalProperties).toBe(false);
    expect(schema.required).toEqual(expect.arrayContaining(["v", "manifest", "module", "tokens", "surface", "data", "logic", "journeys"]));
  });
});
