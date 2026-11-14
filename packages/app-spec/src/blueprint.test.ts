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
    // What it keeps, with each saved field's type from the spec's data schema.
    expect(b.data).toEqual({
      version: 1,
      keeps: [{ key: "habits.days", what: "On this phone: days, best", shape: { days: "object", best: "number" }, personal: true }],
    });
  });

  it("without screens of its own, describes the surface in the words on it, and lists the colours", () => {
    const s = habits();
    delete s.screens;
    const b = deriveBlueprint(s);
    expect(b.screens).toEqual([{ id: "habits", says: "Shows Your Habits; asks for Habit; with + Add habit; using DateStrip, CheckBox, TextField." }]);
    expect(b.design.palette).toContain("#0f766e");
    expect(b.design.notes).toBe("Built from a CloudCrane spec, runtime 0.4.1.");
  });

  it("takes the listing (icon, category, tags) when the spec has one", () => {
    const s = habits();
    s.module.icon = "check";
    s.module.category = "productivity";
    s.module.tags = ["habits", "streak"];
    expect(deriveBlueprint(s)).toMatchObject({ icon: "check", category: "productivity", tags: ["habits", "streak"] });
    expect(deriveBlueprint(habits())).not.toHaveProperty("icon");
  });

  it("carries the device features the spec uses, and none when it uses none", () => {
    const s = habits();
    s.uses = [{ what: "location", why: "To show the weather where you are" }];
    expect(deriveBlueprint(s).uses).toEqual([{ what: "location", why: "To show the weather where you are" }]);
    expect(deriveBlueprint(habits())).not.toHaveProperty("uses");
  });

  it("carries what each site is sent, the screens with their states, the orientation, and personal fields", () => {
    const s = habits();
    s.network = [{ site: "api.open-meteo.com", why: "The forecast", sends: "The city you typed" }];
    s.screens = [{ id: "today", says: "Today's habits", states: { empty: "Add your first habit", offline: "Shows what's saved" } }];
    s.screen = { orientation: "portrait" };
    s.data.personal = ["/days"];
    const b = deriveBlueprint(s);
    expect(b.network).toEqual([{ site: "api.open-meteo.com", why: "The forecast", sends: "The city you typed" }]);
    expect(b.screens).toEqual(s.screens);
    expect(b.screen).toEqual({ orientation: "portrait" });
    expect(b.data.keeps[0]!.personal).toBe(true);
  });

  it("keeps the design tokens by role, light and dark, the radius and the font", () => {
    const s = habits();
    (s.tokens as Record<string, unknown>)["dark"] = { color: { $type: "color", background: { $value: "#101010" }, "on-background": { $value: "#f5f5f5" } } };
    const t = deriveBlueprint(s).design.tokens!;
    expect(t).toMatchObject({
      "color.primary": "#0f766e",
      "color.dark.background": "#101010",
      "border-radius": "12px",
      "font-family": "system-ui, sans-serif",
    });
    expect(Object.keys(t).length).toBeLessThanOrEqual(40);
  });
});
