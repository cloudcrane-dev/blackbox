import { describe, expect, it } from "vitest";
import { sampleSpec } from "./fixtures.js";
import { keptShape, memoryProblems } from "./memory.js";

// What it keeps, refused when it would lose or misread saved data.

describe("saved data", () => {
  it("refuses a schema that isn't one, and initial data that doesn't fit it", () => {
    const s = sampleSpec();
    s.data.schema = { type: "nope" };
    expect(memoryProblems(s)[0]!.problem).toMatch(/isn't a JSON Schema/);
    const t = sampleSpec();
    t.data.schema = { type: "object", properties: { best: { type: "integer" } } };
    t.data.initial = { best: "high" };
    expect(memoryProblems(t)).toEqual([{ at: "data.initial.best", problem: expect.stringMatching(/doesn't fit data.schema/) }]);
  });

  it("refuses a migration chain with a gap, or two steps from one version", () => {
    const s = sampleSpec();
    s.data.version = 3;
    s.data.migrations = [{ from: 2, to: 3, cel: "saved" }];
    expect(memoryProblems(s).map((p) => p.problem)).toEqual([expect.stringMatching(/no step from version 1 to 2: a phone still on 1 would lose its data/)]);
    s.data.migrations = [
      { from: 1, to: 2, cel: "saved" },
      { from: 1, to: 2, cel: "saved" },
      { from: 2, to: 3, cel: "saved" },
    ];
    expect(memoryProblems(s).map((p) => p.problem)).toEqual([expect.stringMatching(/2 steps from version 1/)]);
  });

  it("refuses a personal field the saved data doesn't have", () => {
    const s = sampleSpec();
    s.data.schema = { type: "object", properties: { people: { type: "array", items: { type: "object", properties: { name: { type: "string" } } } } } };
    s.data.initial = { people: [] };
    s.data.personal = ["/people/*/name", "/salary"];
    expect(memoryProblems(s)).toEqual([{ at: "data.personal /salary", problem: expect.stringMatching(/no such field/) }]);
  });

  it("gives each top-level field its type in CloudCrane's words", () => {
    expect(
      keptShape({
        type: "object",
        properties: {
          name: { type: "string" },
          on: { type: "string", format: "date" },
          count: { type: "integer" },
          done: { type: "boolean" },
          items: { type: "array" },
          more: { type: "object" },
          maybe: { type: ["null", "number"] },
        },
      }),
    ).toEqual({ name: "text", on: "date", count: "number", done: "yes/no", items: "list", more: "object", maybe: "number" });
  });
});
