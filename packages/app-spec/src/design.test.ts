import { describe, expect, it } from "vitest";
import { contrast, designWarnings, rgbOf, statesWarnings } from "./design.js";
import { sampleSpec } from "./fixtures.js";

// How it looks and what each screen shows, as warnings: colour roles, contrast in light and dark, and the states.

describe("colours", () => {
  it("reads hex and DTCG srgb colours, and measures WCAG contrast", () => {
    expect(rgbOf("#fff")).toEqual([255, 255, 255]);
    expect(rgbOf({ colorSpace: "srgb", components: [0, 0, 0] })).toEqual([0, 0, 0]);
    expect(rgbOf("teal")).toBeNull();
    expect(contrast([0, 0, 0], [255, 255, 255])).toBeCloseTo(21, 0);
    expect(contrast([118, 118, 118], [255, 255, 255])).toBeGreaterThan(4.5);
  });

  it("warns when a core role is missing, text doesn't read, or there are no dark colours", () => {
    const s = sampleSpec();
    s.tokens = {
      color: { $type: "color", background: { $value: "#ffffff" }, "on-background": { $value: "#cccccc" }, primary: { $value: "#0f766e" } },
    } as typeof s.tokens;
    const said = designWarnings(s)
      .map((w) => w.problem)
      .join("\n");
    expect(said).toMatch(/no color.on-primary/);
    expect(said).toMatch(/on-background on background is 1\.6:1; text needs at least 4\.5:1/);
    expect(said).toMatch(/no dark colours/);
  });

  it("checks the dark colours over the light ones they replace, and says what the runtime can't draw", () => {
    const s = sampleSpec();
    s.tokens = {
      color: {
        $type: "color",
        background: { $value: "#ffffff" },
        "on-background": { $value: "#111111" },
        primary: { $value: "#0f766e" },
        "on-primary": { $value: "#ffffff" },
      },
      dark: { color: { $type: "color", background: { $value: "#111111" } } },
      shadow: { $type: "shadow", card: { $value: { color: "#000", offsetX: "0px", offsetY: "1px", blur: "2px", spread: "0px" } } },
    } as typeof s.tokens;
    const said = designWarnings(s)
      .map((w) => `${w.at} ${w.problem}`)
      .join("\n");
    // Dark keeps the light text (#111) on a dark page: it doesn't read.
    expect(said).toMatch(/tokens\.dark\.color\.on-background on-background on background is 1\.0:1/);
    expect(said).not.toMatch(/no dark colours/);
    expect(said).toMatch(/can't draw shadow\.card \(shadow\)/);
  });

  it("says nothing when every role is there and reads, light and dark", () => {
    const s = sampleSpec();
    s.tokens = {
      color: {
        $type: "color",
        background: { $value: "#ffffff" },
        "on-background": { $value: "#111111" },
        primary: { $value: "#0f766e" },
        "on-primary": { $value: "#ffffff" },
      },
      dark: { color: { $type: "color", background: { $value: "#111111" }, "on-background": { $value: "#f5f5f5" } } },
    } as typeof s.tokens;
    expect(designWarnings(s)).toEqual([]);
  });
});

describe("screen states", () => {
  it("asks an app that talks to a site for its offline and error states, and one that lists things for its empty state", () => {
    const s = sampleSpec();
    s.network = [{ site: "api.open-meteo.com", why: "The forecast", sends: "The city you typed" }];
    expect(statesWarnings(s).map((w) => w.problem)).toEqual([expect.stringMatching(/no screens described/)]);
    s.screens = [{ id: "home", says: "The forecast" }];
    const said = statesWarnings(s)
      .map((w) => w.problem)
      .join("\n");
    expect(said).toMatch(/no offline state/);
    expect(said).toMatch(/no error state: say what it shows when api\.open-meteo\.com fails/);
    s.screens = [
      {
        id: "home",
        says: "The forecast",
        states: { empty: "Add a city to see its forecast", offline: "Shows the last forecast", error: "Says it couldn't reach the forecast" },
      },
    ];
    expect(statesWarnings(s)).toEqual([]);
  });
});
