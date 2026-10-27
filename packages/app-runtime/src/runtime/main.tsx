import { h, render } from "preact";
import { z } from "zod";
import { Catalog, CommonSchemas, MessageProcessor, createFunctionImplementation } from "@a2ui/web_core/v0_9";
import { basicCatalog } from "@a2ui/web_core/v0_9/basic_catalog";
import { A2uiSurface } from "@a2ui/react/v0_9";
import { Rules } from "@cloudcrane/app-spec/logic";
import type { Spec } from "@cloudcrane/app-spec/schema";
import { runStep, runSteps, type Model, type Step } from "./actions.js";
import { computeAll, localToday } from "./computed.js";
import { watchLabels } from "./a11y.js";
import { DateStrip } from "./datestrip.js";
import { TextField } from "./textfield.js";
import { loadSaved, serializeSaved } from "./store.js";
import { ViewSync } from "./views.js";

// The runtime: reads the spec the compiler put in the page, draws it with A2UI's
// own processor and renderer, and adds what an app on a phone needs: saved data
// that loads and saves itself, CEL computed values kept up to date, and the
// catalog's local actions. Nothing here is specific to one app.

export const CLOUDCRANE_CATALOG_ID = "https://cloudcrane.ai/catalogs/app/v1.json";

type DataContextLike = { dataModel: Model; getIndex(): number | undefined; resolveDynamicValue<V>(v: unknown): V };

const modelOf = (ctx: DataContextLike): Model => ({ get: (p) => ctx.dataModel.get(p), set: (p, v) => ctx.dataModel.set(p, v) });

const FUNCTIONS = [
  createFunctionImplementation(
    {
      name: "set",
      returnType: "void",
      schema: z.object({ path: CommonSchemas.DynamicString, value: CommonSchemas.DynamicValue }),
      allowedCallers: "rendererOnly",
    },
    (args, ctx) => runStep(modelOf(ctx as unknown as DataContextLike), { op: "set", path: args.path as string, value: args.value }, undefined),
  ),
  createFunctionImplementation(
    {
      name: "push",
      returnType: "void",
      schema: z.object({ path: CommonSchemas.DynamicString, value: CommonSchemas.DynamicValue }),
      allowedCallers: "rendererOnly",
    },
    (args, ctx) => runStep(modelOf(ctx as unknown as DataContextLike), { op: "push", path: args.path as string, value: args.value }, undefined),
  ),
  createFunctionImplementation(
    { name: "removeAt", returnType: "void", schema: z.object({ path: CommonSchemas.DynamicString }), allowedCallers: "rendererOnly" },
    (args, ctx) => {
      const c = ctx as unknown as DataContextLike;
      runStep(modelOf(c), { op: "removeAt", path: args.path as string }, c.getIndex());
    },
  ),
  createFunctionImplementation(
    { name: "batch", returnType: "void", schema: z.object({ steps: z.array(z.record(z.unknown())) }), allowedCallers: "rendererOnly" },
    (args, ctx) => {
      const c = ctx as unknown as DataContextLike;
      // A step's path and value may be bound to the data model: resolve them here, in order.
      const steps = (args.steps as Record<string, unknown>[]).map((s): Step => ({
        op: s["op"] as Step["op"],
        path: c.resolveDynamicValue<string>(s["target"]),
        value: c.resolveDynamicValue(s["value"]),
      }));
      runSteps(modelOf(c), steps, c.getIndex());
    },
  ),
];

function boot(): void {
  const spec = JSON.parse(document.getElementById("cc-spec")!.textContent!) as Spec;
  const rules = new Rules(spec.logic);
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(spec.data.key);
  } catch {
    raw = null;
  }
  const loaded = loadSaved(raw, spec.data, rules);

  // A2UI's basic components, with TextField's label tied to its input (see textfield.tsx), plus DateStrip.
  const basics = [...basicCatalog.components.values()].filter((c) => c.name !== "TextField");
  const catalog = new Catalog(
    CLOUDCRANE_CATALOG_ID,
    "v0.9",
    [...basics, TextField, DateStrip] as never[],
    [...basicCatalog.functions.values(), ...FUNCTIONS] as never[],
  );
  const processor = new MessageProcessor([catalog as never]);
  processor.processMessages(spec.surface.messages as never);
  const surface = [...processor.model.surfacesMap.values()][0]!;
  const model = surface.dataModel;
  // A2UI reports problems on the surface, not the console: pass them on, so a broken spec is visible.
  surface.onError.subscribe((e: unknown) => console.error("[a2ui]", JSON.stringify(e)));
  surface.onWarning.subscribe((w: unknown) => console.warn("[a2ui]", JSON.stringify(w)));
  const persist = spec.data.persist;

  const today = (window as { __ccToday?: string }).__ccToday ?? localToday();
  model.set("/today", today);
  if ((model.get("/ui/selected") ?? "") === "") model.set("/ui/selected", today);
  model.set(persist, loaded.saved);

  const views = new ViewSync(spec.data.views);
  const modelView = { get: (p: string) => model.get(p), set: (p: string, v: unknown) => model.set(p, v) };
  let busy = false;
  /** After any change: views, then computed values, until nothing moves (a change made here comes back once, as a no-op). */
  const settle = () => {
    if (busy) return;
    busy = true;
    try {
      for (let i = 0; i < 5 && (views.sync(modelView) || recomputeChanged()); i++);
    } finally {
      busy = false;
    }
  };
  const recomputeChanged = () => {
    let changed = false;
    const env = { saved: model.get(persist), ui: model.get("/ui"), today };
    for (const [pointer, value] of computeAll(rules, spec.logic.computed, env)) {
      if (JSON.stringify(model.get(pointer)) !== JSON.stringify(value)) {
        model.set(pointer, value);
        changed = true;
      }
    }
    return changed;
  };
  const save = () => {
    const out = serializeSaved(model.get(persist), loaded, spec.data);
    if (out === null) return;
    try {
      localStorage.setItem(spec.data.key, out);
    } catch {
      // A full or blocked storage keeps the app working; it just can't save.
    }
  };
  settle();
  model.subscribe(persist, () => {
    settle();
    save();
  });
  model.subscribe("/ui", settle);
  if (loaded.note === "migrated") save();

  (window as { appState?: () => unknown }).appState = () => ({ data: model.get("/"), today, loaded: loaded.note });
  const app = document.getElementById("app")!;
  render(h(A2uiSurface as never, { surface } as never), app);
  watchLabels(app);
}

boot();
