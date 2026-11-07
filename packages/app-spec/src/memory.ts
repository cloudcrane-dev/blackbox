import { Ajv2020 } from "ajv/dist/2020.js";
import type { Problem } from "./a2ui.js";
import type { Spec } from "./schema.js";

// What it keeps, checked so a person's saved data is never lost or misread: the saved data's JSON Schema is a schema,
// the data an app starts with fits it, the migrations run one version at a time from 1 all the way to data.version (a
// phone on any older version can come up to date), and the fields marked personal are in the saved data.
// Also the shape of each top-level field, in CloudCrane's words, for the blueprint.

/** CloudCrane's kept-field types (its blueprint's keeps[].shape). */
export type KeptType = "text" | "number" | "yes/no" | "date" | "list" | "object";

const ajv = () => new Ajv2020({ strict: false, allErrors: true, validateFormats: false });

/** The schema as Ajv takes it: any $schema line names a draft this one reads the same for what specs use. */
const plain = (schema: Record<string, unknown>) => {
  const { $schema: _s, ...rest } = schema;
  return rest;
};

export function memoryProblems(spec: Spec): Problem[] {
  const problems: Problem[] = [];
  let validate: ((d: unknown) => boolean) & { errors?: { instancePath: string; message?: string }[] | null };
  try {
    validate = ajv().compile(plain(spec.data.schema));
  } catch (err) {
    return [{ at: "data.schema", problem: `isn't a JSON Schema: ${err instanceof Error ? err.message : String(err)}` }];
  }
  if (spec.data.initial !== undefined && !validate(spec.data.initial))
    for (const e of validate.errors ?? [])
      problems.push({ at: `data.initial${e.instancePath.replace(/\//g, ".")}`, problem: `doesn't fit data.schema: ${e.message ?? "invalid"}` });

  // Every step from 1 to the current version, once each, so any older phone can come up to date. A page spec (an HTML
  // app as a spec) moves its own data in its own code, as the page it is, so it has no migrations to check.
  if (spec.page) return [...problems, ...personalProblems(spec)];
  const steps = new Map<number, number>();
  for (const m of spec.data.migrations) steps.set(m.from, (steps.get(m.from) ?? 0) + 1);
  for (let from = 1; from < spec.data.version; from++) {
    const n = steps.get(from) ?? 0;
    if (n === 0) problems.push({ at: "data.migrations", problem: `no step from version ${from} to ${from + 1}: a phone still on ${from} would lose its data` });
    if (n > 1) problems.push({ at: "data.migrations", problem: `${n} steps from version ${from}; there must be one` });
  }

  return [...problems, ...personalProblems(spec)];
}

/** Personal fields name something the saved data has. */
function personalProblems(spec: Spec): Problem[] {
  return (spec.data.personal ?? []).flatMap((pointer) =>
    pointsInto(spec.data.schema, pointer) ? [] : [{ at: `data.personal ${pointer}`, problem: "the saved data has no such field (data.schema)" }],
  );
}

/** Whether a JSON Pointer names a field the schema describes (properties all the way down; arrays and maps by their items). */
function pointsInto(schema: unknown, pointer: string): boolean {
  if (pointer === "") return true;
  let node = schema as Record<string, unknown> | undefined;
  for (const raw of pointer.split("/").slice(1)) {
    const part = raw.replace(/~1/g, "/").replace(/~0/g, "~");
    if (!node || typeof node !== "object") return false;
    const props = node["properties"] as Record<string, unknown> | undefined;
    if (props && part in props) node = props[part] as Record<string, unknown>;
    else if (node["items"] && /^\d+$|^\*$/.test(part)) node = node["items"] as Record<string, unknown>;
    else if (node["additionalProperties"] && typeof node["additionalProperties"] === "object") node = node["additionalProperties"] as Record<string, unknown>;
    else return false;
  }
  return true;
}

/** Each top-level saved field and its type, in CloudCrane's words. */
export function keptShape(schema: Record<string, unknown>): Record<string, KeptType> {
  const props = (schema["properties"] ?? {}) as Record<string, Record<string, unknown>>;
  const out: Record<string, KeptType> = {};
  for (const [name, p] of Object.entries(props).slice(0, 40)) {
    const type = Array.isArray(p["type"]) ? (p["type"] as string[]).find((t) => t !== "null") : (p["type"] as string | undefined);
    out[name.slice(0, 40)] =
      type === "string"
        ? p["format"] === "date" || p["format"] === "date-time"
          ? "date"
          : "text"
        : type === "number" || type === "integer"
          ? "number"
          : type === "boolean"
            ? "yes/no"
            : type === "array"
              ? "list"
              : "object";
  }
  return out;
}
