import { describe, expect, it } from "vitest";
import { Rules } from "@cloudcrane/app-spec/logic";
import { runStep, runSteps, type Model } from "./actions.js";
import { computeAll, localToday } from "./computed.js";
import { loadSaved, serializeSaved } from "./store.js";
import { tokensCss, tokenVariables } from "./theme.js";
import { resolveSource, ViewSync } from "./views.js";

// The runtime's parts that don't need a browser: tokens to A2UI's variables,
// saved data in and out (with migrations, and never over a newer app's data),
// the local actions, two-way views and computed values.

/** A data model over a plain object, addressed by JSON Pointers, like A2UI's. */
function memoryModel(initial: Record<string, unknown> = {}): Model & { data: Record<string, unknown> } {
  const data = structuredClone(initial);
  const parts = (p: string) =>
    p
      .split("/")
      .slice(1)
      .map((s) => s.replace(/~1/g, "/").replace(/~0/g, "~"));
  return {
    data,
    get(p) {
      let o: unknown = data;
      for (const k of parts(p)) o = o && typeof o === "object" ? (o as Record<string, unknown>)[k] : undefined;
      return o;
    },
    set(p, v) {
      const ks = parts(p);
      let o = data as Record<string, unknown>;
      for (const k of ks.slice(0, -1)) o = (o[k] ??= {}) as Record<string, unknown>;
      o[ks.at(-1)!] = v;
    },
  };
}

const DATA = {
  version: 2,
  key: "k",
  persist: "/saved",
  views: [],
  schema: {},
  initial: { days: {}, best: 0 },
  migrations: [{ from: 1, to: 2, cel: "{'days': saved.days, 'best': 0}" }],
};
const rules = new Rules({ consts: {}, functions: {}, computed: {}, vectors: [] });

describe("tokens", () => {
  it("become A2UI's own theme variables, sorted, from DTCG values", () => {
    const vars = tokenVariables({
      color: {
        $type: "color",
        primary: { $value: { colorSpace: "srgb", components: [0.06, 0.46, 0.43], hex: "#0f766e" } },
        "on-primary": { $value: "#ffffff" },
      },
      "border-radius": { $type: "dimension", $value: { value: 14, unit: "px" } },
      "font-family": { $type: "fontFamily", $value: ["Atkinson Hyperlegible", "system-ui"] },
      shade: { $type: "color", $value: { colorSpace: "srgb", components: [0, 0, 0], alpha: 0.5 } },
    });
    expect(vars).toEqual([
      ["--a2ui-border-radius", "14px"],
      ["--a2ui-color-on-primary", "#ffffff"],
      ["--a2ui-color-primary", "#0f766e"],
      ["--a2ui-font-family", '"Atkinson Hyperlegible", system-ui'],
      ["--a2ui-shade", "rgb(0 0 0 / 0.5)"],
    ]);
    expect(tokensCss({ color: { primary: { $value: "#000" } } })).toBe(":root{color-scheme:light;--a2ui-color-primary:#000;}");
    // The page's scheme follows its own background, so A2UI's light-dark() defaults match it whatever the phone is set to.
    expect(tokensCss({ color: { background: { $value: "#f6f5f2" } } })).toMatch(/^:root\{color-scheme:light;/);
    expect(tokensCss({ color: { background: { $value: "#111" } } })).toMatch(/^:root\{color-scheme:dark;/);
    expect(tokensCss({ color: { background: { $value: { colorSpace: "srgb", components: [0.05, 0.05, 0.08] } } } })).toMatch(/^:root\{color-scheme:dark;/);
  });
});

describe("saved data", () => {
  it("starts from the spec's initial data on a new phone, and reads what's there", () => {
    expect(loadSaved(null, DATA, rules)).toMatchObject({ saved: { days: {}, best: 0 }, note: "new" });
    expect(loadSaved('{"v":2,"days":{"x":[]},"best":3}', DATA, rules)).toMatchObject({ saved: { days: { x: [] }, best: 3 }, note: "loaded" });
  });

  it("moves older data up with the spec's migrations, and leaves a newer app's data alone", () => {
    expect(loadSaved('{"v":1,"days":{"x":[1]}}', DATA, rules)).toMatchObject({ saved: { days: { x: [1] }, best: 0 }, note: "migrated" });
    const newer = loadSaved('{"v":9,"days":{}}', DATA, rules);
    expect(newer.note).toBe("newer");
    expect(serializeSaved({ days: {} }, newer, DATA)).toBeNull();
  });

  it("survives what isn't its data: garbage, no version, a missing migration", () => {
    for (const raw of ["not json", "[]", '{"days":{}}', '{"v":0,"days":{}}']) expect(loadSaved(raw, DATA, rules).note, raw).toBe("unreadable");
  });

  it("writes back in the shape the hand-written apps use: v, then the saved fields", () => {
    const loaded = loadSaved(null, DATA, rules);
    expect(serializeSaved({ days: { a: [] }, best: 1 }, loaded, DATA)).toBe('{"v":2,"days":{"a":[]},"best":1}');
  });
});

describe("local actions", () => {
  it("set, push (creating the list) and removeAt the item the action came from", () => {
    const m = memoryModel({ ui: { list: ["a", "b", "c"] } });
    runStep(m, { op: "set", path: "/ui/name", value: "x" }, undefined);
    runStep(m, { op: "push", path: "/saved/days/2026-10-27", value: { name: "squat" } }, undefined);
    runStep(m, { op: "removeAt", path: "/ui/list" }, 1);
    expect(m.data).toEqual({ ui: { list: ["a", "c"], name: "x" }, saved: { days: { "2026-10-27": [{ name: "squat" }] } } });
  });

  it("do nothing for a bad path or an index that isn't there, and copy what they write", () => {
    const m = memoryModel({ l: [1] });
    runStep(m, { op: "removeAt", path: "/l" }, 5);
    runStep(m, { op: "removeAt", path: "/l" }, undefined);
    runStep(m, { op: "set", path: "no-slash", value: 1 }, undefined);
    expect(m.data).toEqual({ l: [1] });
    const draft = { name: "a" };
    runSteps(m, [{ op: "push", path: "/l2", value: draft }], undefined);
    draft.name = "changed";
    expect(m.get("/l2")).toEqual([{ name: "a" }]);
  });
});

describe("two-way views", () => {
  const view = { path: "/ui/day", source: "/saved/days/${/ui/selected}" };

  it("show the data the selection points at, and follow the selection", () => {
    const m = memoryModel({ ui: { selected: "a" }, saved: { days: { a: [1], b: [2] } } });
    const s = new ViewSync([view]);
    s.sync(m);
    expect(m.get("/ui/day")).toEqual([1]);
    m.set("/ui/selected", "b");
    s.sync(m);
    expect(m.get("/ui/day")).toEqual([2]);
  });

  it("send an edit made through the view back to its source, and not one that came from the source", () => {
    const m = memoryModel({ ui: { selected: "a" }, saved: { days: { a: [{ done: false }] } } });
    const s = new ViewSync([view]);
    s.sync(m);
    m.set("/ui/day", [{ done: true }]);
    s.sync(m);
    expect(m.get("/saved/days/a")).toEqual([{ done: true }]);
    m.set("/saved/days/a", [{ done: false }, { done: false }]);
    s.sync(m);
    expect(m.get("/ui/day")).toEqual([{ done: false }, { done: false }]);
  });

  it("show an empty list for nothing, and don't create an empty entry by looking", () => {
    const m = memoryModel({ ui: { selected: "z" }, saved: { days: {} } });
    const s = new ViewSync([view]);
    s.sync(m);
    expect(m.get("/ui/day")).toEqual([]);
    s.sync(m);
    expect(m.get("/saved/days")).toEqual({});
    m.set("/ui/day", [{ name: "x" }]);
    s.sync(m);
    expect(m.get("/saved/days/z")).toEqual([{ name: "x" }]);
  });

  it("escape a selection that would break the pointer", () => {
    expect(resolveSource("/saved/${/ui/k}", memoryModel({ ui: { k: "a/b~c" } }))).toBe("/saved/a~1b~0c");
  });
});

describe("computed values", () => {
  it("are worked out in pointer order from saved data, screen state and today", () => {
    const r = new Rules({ consts: {}, functions: {}, computed: {}, vectors: [] });
    expect(computeAll(r, { "/computed/b": "today", "/computed/a": "saved.n + 1" }, { saved: { n: 1 }, ui: {}, today: "2026-10-27" })).toEqual([
      ["/computed/a", 2],
      ["/computed/b", "2026-10-27"],
    ]);
    expect(localToday(new Date(2026, 0, 5, 23, 59))).toBe("2026-01-05");
  });
});

describe("accessibility labels", () => {
  it("move from an A2UI element onto the control inside it, unless the control has its own", async () => {
    const { JSDOM } = await import("jsdom");
    const { bridgeLabels } = await import("./a11y.js");
    const doc = new JSDOM(
      `<a2ui-basic-button aria-label="Remove this exercise" aria-description="From today"><button>×</button></a2ui-basic-button>
       <a2ui-basic-button aria-label="Ignored"><button aria-label="Own name">x</button></a2ui-basic-button>
       <div aria-label="Not A2UI"><button>y</button></div>`,
    ).window.document;
    bridgeLabels(doc.body);
    const [a, b, c] = [...doc.querySelectorAll("button")];
    expect([a!.getAttribute("aria-label"), a!.getAttribute("aria-description")]).toEqual(["Remove this exercise", "From today"]);
    expect(b!.getAttribute("aria-label")).toBe("Own name");
    expect(c!.getAttribute("aria-label")).toBeNull();
  });
});
