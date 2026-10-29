import type { Spec } from "./schema.js";

// A small, valid spec for tests: a checklist of today's exercises, saved on the
// phone, with one rule. Built from A2UI's basic catalog only.

export const CATALOG = "https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json";

export function sampleSpec(): Spec {
  return {
    v: 1,
    manifest: { runtime: "0.4.0", generator: "blackbox@0.4.0", source: { fingerprint: `sha256:${"0".repeat(64)}` } },
    module: { id: "plans", name: "Workout log", purpose: "Plan today's exercises and tick them off." },
    tokens: {
      color: {
        $type: "color",
        bg: { $value: { colorSpace: "srgb", components: [0, 0, 0], hex: "#000000" } },
        primary: { $value: { colorSpace: "srgb", components: [0.06, 0.46, 0.43], hex: "#0f766e" } },
      },
      radius: { $type: "dimension", card: { $value: { value: 14, unit: "px" } } },
    },
    surface: {
      catalog: CATALOG,
      messages: [
        { version: "v0.9.1", createSurface: { surfaceId: "plans", catalogId: CATALOG } },
        {
          version: "v0.9.1",
          updateComponents: {
            surfaceId: "plans",
            components: [
              { id: "root", component: "Column", children: ["title", "list"] },
              { id: "title", component: "Text", text: "Your Plans", variant: "h1" },
              { id: "list", component: "List", children: { componentId: "item", path: "/saved/today" } },
              { id: "item", component: "CheckBox", label: { path: "name" }, value: { path: "done" } },
            ],
          },
        },
      ],
    },
    data: {
      version: 1,
      key: "workouts",
      persist: "/saved",
      views: [],
      schema: { type: "object", properties: { today: { type: "array" } } },
      initial: { today: [] },
      migrations: [],
    },
    logic: {
      consts: { WEEKLY_TOKENS: 2 },
      functions: { isStreakBroken: { params: ["d", "t", "active"], cel: "active && d != null && d - 1 > t" } },
      computed: {},
      vectors: [{ fn: "isStreakBroken", in: [4, 2, true], out: true, from: "recorded" }],
    },
    network: [],
    uses: [],
    journeys: [{ id: "J-1", title: "Do today's workout", steps: [{ id: "J-1.1", text: "Tick an exercise off when it's done" }] }],
    promises: [{ id: "P-1", text: "Ticks saved on this phone survive a reload", kind: "data" }],
    tests: [],
    components: {},
    mods: { open: ["/tokens/*"], locked: ["/network/*"] },
  };
}
