import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { deriveBlueprint } from "./blueprint.js";
import { validateSpec } from "./validate.js";

// A spec as the blueprint CloudCrane shows and checks: everything comes from
// the spec, and the screen is described in the words a person sees.

const habits = () => validateSpec(JSON.parse(readFileSync(new URL("../../../fixtures/habits/spec.json", import.meta.url), "utf8"))).spec!;

describe("a spec's blueprint", () => {
  it("carries the spec's purpose, journeys, promises and sites", () => {
    const s = habits();
    const b = deriveBlueprint(s);
    expect(b).toMatchObject({ v: 1, purpose: s.module.purpose, journeys: s.journeys, promises: s.promises, network: [] });
    expect(b.data).toEqual({ version: 1, keeps: [{ key: "habits.days", what: "On this phone: days, best" }] });
  });

  it("describes the screen in the words on it, and lists the colours", () => {
    const b = deriveBlueprint(habits());
    expect(b.screens).toEqual([{ id: "habits", says: "Shows Your Habits; asks for Habit; with + Add habit; using DateStrip, CheckBox, TextField." }]);
    expect(b.design.palette).toContain("#0f766e");
    expect(b.design.notes).toBe("Built from a CloudCrane spec, runtime 0.1.0.");
  });

  it("takes the listing (icon, category, tags) when the spec has one", () => {
    const s = habits();
    s.module.icon = "check";
    s.module.category = "productivity";
    s.module.tags = ["habits", "streak"];
    expect(deriveBlueprint(s)).toMatchObject({ icon: "check", category: "productivity", tags: ["habits", "streak"] });
    expect(deriveBlueprint(habits())).not.toHaveProperty("icon");
  });
});
