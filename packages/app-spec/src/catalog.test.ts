import { describe, expect, it } from "vitest";
import { surfaceProblems } from "./a2ui.js";
import { CLOUDCRANE_CATALOG, CLOUDCRANE_CATALOG_ID } from "./catalog.js";
import { sampleSpec } from "./fixtures.js";
import { validateSpec } from "./validate.js";

// CloudCrane's catalog is A2UI's basic catalog plus local actions and a
// DateStrip, as an A2UI catalog document: surfaces using it validate with
// A2UI's own message schema, and everything basic still works.

const msgs = (components: unknown[]) => [
  { version: "v0.9.1", createSurface: { surfaceId: "s", catalogId: CLOUDCRANE_CATALOG_ID } },
  { version: "v0.9.1", updateComponents: { surfaceId: "s", components } },
];

describe("the CloudCrane catalog", () => {
  it("keeps every basic component and function, and adds its own", () => {
    const c = CLOUDCRANE_CATALOG as unknown as { components: object; functions: object };
    for (const k of ["Text", "Column", "List", "CheckBox", "TextField", "Button", "Card", "Modal"]) expect(c.components).toHaveProperty(k);
    for (const k of ["formatString", "required", "openUrl"]) expect(c.functions).toHaveProperty(k);
    expect(Object.keys(c.components)).toContain("DateStrip");
    expect(Object.keys(c.functions)).toEqual(expect.arrayContaining(["set", "push", "removeAt", "batch"]));
  });

  it("validates a DateStrip and local actions, and refuses misuse", () => {
    const ok = msgs([
      { id: "root", component: "Column", children: ["days", "add"] },
      { id: "days", component: "DateStrip", days: 14, today: { path: "/today" }, value: { path: "/ui/selected" }, statuses: { path: "/computed/dayStatus" } },
      {
        id: "add",
        component: "Button",
        child: "addLabel",
        action: {
          functionCall: {
            call: "batch",
            args: {
              steps: [
                { op: "push", target: "/saved/x", value: { path: "/ui/draft" } },
                { op: "set", target: "/ui/draft/name", value: "" },
              ],
            },
          },
        },
      },
      { id: "addLabel", component: "Text", text: "Add" },
    ]);
    expect(surfaceProblems(ok, CLOUDCRANE_CATALOG)).toEqual([]);
    const badStrip = msgs([{ id: "root", component: "DateStrip", days: 400, today: "2026-10-27", value: { path: "/ui/selected" } }]);
    expect(surfaceProblems(badStrip, CLOUDCRANE_CATALOG).length).toBeGreaterThan(0);
    const badOp = msgs([
      { id: "root", component: "Button", child: "t", action: { functionCall: { call: "batch", args: { steps: [{ op: "delete", target: "/saved" }] } } } },
      { id: "t", component: "Text", text: "x" },
    ]);
    expect(surfaceProblems(badOp, CLOUDCRANE_CATALOG).length).toBeGreaterThan(0);
  });

  it("is the catalog a spec names, and an unknown one is refused", () => {
    const s = sampleSpec();
    s.surface.catalog = CLOUDCRANE_CATALOG_ID;
    (s.surface.messages[0] as { createSurface: { catalogId: string } }).createSurface.catalogId = CLOUDCRANE_CATALOG_ID;
    expect(validateSpec(s).problems).toEqual([]);
    s.surface.catalog = "https://example.com/catalog.json";
    expect(validateSpec(s).problems[0]?.problem).toMatch(/not a catalog this runtime has/);
  });
});
