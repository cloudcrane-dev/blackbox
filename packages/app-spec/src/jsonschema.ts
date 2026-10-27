import { zodToJsonSchema } from "zod-to-json-schema";
import { SpecSchema } from "./schema.js";

/** The spec's JSON Schema, for tools outside TypeScript (schema/app-spec.v1.json is this, checked in). */
export function specJsonSchema(): Record<string, unknown> {
  return {
    $id: "https://cloudcrane.ai/schemas/app-spec.v1.json",
    title: "CloudCrane app spec v1",
    description: "An A2UI surface in an envelope: DTCG tokens, saved data, CEL logic, journeys, promises, tests and mod points. No code.",
    ...(zodToJsonSchema(SpecSchema, { target: "jsonSchema2019-09", $refStrategy: "none" }) as Record<string, unknown>),
  };
}
