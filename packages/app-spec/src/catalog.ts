import { BASIC_CATALOG, type Catalog } from "./a2ui.js";

// The CloudCrane catalog: A2UI's basic catalog plus what an app on a phone
// needs that an agent's chat surface doesn't, written as an A2UI catalog
// document (the format A2UI's own catalogs use), so A2UI's tools and
// renderers read it as they read theirs.
//
// Functions (renderer-only local actions; they change the surface's data model):
//   set(path, value), push(path, value), removeAt(path) (the item the action
//   was fired from, by its index in a list template), batch(steps).
// Components:
//   DateStrip: the last N days as chips, today on the right, one selectable,
//   each with a status dot.
//   Coded: places one of the spec's coded components, sandboxed in a frame; its
//   state shows at /ui/coded/<id>/state.

export const CLOUDCRANE_CATALOG_ID = "https://cloudcrane.ai/catalogs/app/v1.json";
const COMMON = "https://a2ui.org/specification/v0_9/common_types.json#/$defs";

const path = { $ref: `${COMMON}/DynamicString`, description: "A JSON Pointer into the data model, like /saved/days/2026-10-27." };
const value = { $ref: `${COMMON}/DynamicValue`, description: "The value: a literal, or bound to the data model." };

const fn = (name: string, description: string, properties: Record<string, unknown>, required: string[]) => ({
  type: "object",
  description,
  properties: {
    call: { const: name },
    args: { type: "object", properties, required, additionalProperties: false },
    returnType: { const: "void" },
  },
  required: ["call", "args"],
  unevaluatedProperties: false,
});

// A step names its place `target`, not `path`: in A2UI any object with a `path` key is a data binding.
const STEP = {
  type: "object",
  properties: { op: { enum: ["set", "push", "removeAt"] }, target: path, value },
  required: ["op", "target"],
  additionalProperties: false,
};

const FUNCTIONS = {
  set: fn("set", "Sets the value at a path in the data model.", { path, value }, ["path", "value"]),
  push: fn("push", "Adds a value to the end of the list at a path, creating the list if there isn't one.", { path, value }, ["path", "value"]),
  removeAt: fn("removeAt", "Removes, from the list at a path, the item this action was fired from (by its index in a list template).", { path }, ["path"]),
  batch: fn("batch", "Runs set, push and removeAt steps in order, as one change.", { steps: { type: "array", items: STEP, minItems: 1, maxItems: 10 } }, [
    "steps",
  ]),
};

const COMPONENTS = {
  DateStrip: {
    type: "object",
    allOf: [
      { $ref: `${COMMON}/ComponentCommon` },
      { $ref: "#/$defs/CatalogComponentCommon" },
      {
        type: "object",
        properties: {
          component: { const: "DateStrip" },
          days: { type: "integer", minimum: 2, maximum: 60, description: "How many days, ending today." },
          today: { $ref: `${COMMON}/DynamicString`, description: "Today, as YYYY-MM-DD." },
          value: { $ref: `${COMMON}/DynamicString`, description: "The selected day, as YYYY-MM-DD (two-way)." },
          statuses: { $ref: `${COMMON}/DynamicValue`, description: "A map of day (YYYY-MM-DD) to complete, active, partial or incomplete, for its dot." },
        },
        required: ["component", "today", "value"],
      },
    ],
    unevaluatedProperties: false,
  },
  Coded: {
    type: "object",
    allOf: [
      { $ref: `${COMMON}/ComponentCommon` },
      { $ref: "#/$defs/CatalogComponentCommon" },
      {
        type: "object",
        properties: {
          component: { const: "Coded" },
          use: { type: "string", pattern: "^[a-z][a-zA-Z0-9_.-]{0,63}$", description: "The coded component to place, by its name in the spec's components." },
          label: { $ref: `${COMMON}/DynamicString`, description: "What it is, for people who can't see it." },
          aspect: { type: "number", minimum: 0.25, maximum: 4, description: "Width over height; 1 (square) if left out." },
          inputs: {
            type: "array",
            maxItems: 10,
            description: "What it's given, each a declared input bound to the data model.",
            items: {
              type: "object",
              properties: { name: { type: "string" }, value: { $ref: `${COMMON}/DynamicValue` } },
              required: ["name", "value"],
              additionalProperties: false,
            },
          },
          on: {
            type: "array",
            maxItems: 10,
            description: "What happens when it sends a declared event; the event's fields are at /ui/coded/<this id>/<event> while the action runs.",
            items: {
              type: "object",
              properties: { name: { type: "string" }, action: { $ref: `${COMMON}/Action` } },
              required: ["name", "action"],
              additionalProperties: false,
            },
          },
        },
        required: ["component", "use", "label"],
      },
    ],
    unevaluatedProperties: false,
  },
};

/** The CloudCrane catalog document, built from A2UI's basic catalog. */
export function cloudcraneCatalog(): Catalog {
  const basic = structuredClone(BASIC_CATALOG) as Catalog & {
    components: Record<string, unknown>;
    functions: Record<string, unknown>;
    $defs: { anyComponent: { oneOf: unknown[] }; anyFunction: { oneOf: unknown[] } };
  };
  basic.components = { ...basic.components, ...COMPONENTS };
  basic.functions = { ...basic.functions, ...FUNCTIONS };
  basic.$defs.anyComponent.oneOf.push(...Object.keys(COMPONENTS).map((k) => ({ $ref: `#/components/${k}` })));
  basic.$defs.anyFunction.oneOf.push(...Object.keys(FUNCTIONS).map((k) => ({ $ref: `#/functions/${k}` })));
  return {
    ...basic,
    $id: CLOUDCRANE_CATALOG_ID,
    catalogId: CLOUDCRANE_CATALOG_ID,
    title: "CloudCrane app catalog",
    description: "A2UI's basic catalog, plus local actions (set, push, removeAt, batch), DateStrip and Coded, for apps that run on a phone.",
  };
}

export const CLOUDCRANE_CATALOG = cloudcraneCatalog();

/** The catalog a surface names, if it's one we know. */
export function catalogFor(id: string): Catalog | undefined {
  return id === CLOUDCRANE_CATALOG_ID ? CLOUDCRANE_CATALOG : id === BASIC_CATALOG.catalogId ? BASIC_CATALOG : undefined;
}
