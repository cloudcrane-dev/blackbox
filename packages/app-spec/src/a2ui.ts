import { Ajv2020 } from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import type { ValidateFunction } from "ajv";
import basicCatalog from "../vendor/a2ui/v0_9_1/catalogs/basic/catalog.json" with { type: "json" };
import commonTypes from "../vendor/a2ui/v0_9_1/common_types.json" with { type: "json" };
import serverToClient from "../vendor/a2ui/v0_9_1/server_to_client.json" with { type: "json" };

// A spec's screens are A2UI v0.9.1 messages (https://github.com/google/A2UI,
// vendored with its licence under vendor/a2ui). They're checked against A2UI's
// own JSON Schemas, then against the rules A2UI states in prose that a schema
// can't: one surface, created first, unique component ids, a "root", and every
// child id present. A2UI's message schema refers to "catalog.json" for whichever
// catalog the surface uses, so the active catalog is registered under that id.

export type Problem = { at: string; problem: string };
export type Catalog = { catalogId: string; [k: string]: unknown };

export const A2UI_VERSION = "v0.9.1";
export const BASIC_CATALOG = basicCatalog as unknown as Catalog;
const CATALOG_SLOT = "https://a2ui.org/specification/v0_9/catalog.json";

const validators = new Map<string, ValidateFunction>();

/** A2UI's message validator with `catalog` as the surface's catalog (built once per catalog). */
function messageValidator(catalog: Catalog): ValidateFunction {
  const known = validators.get(catalog.catalogId);
  if (known) return known;
  const ajv = new Ajv2020({ strict: false, allErrors: true });
  (addFormats as unknown as (a: Ajv2020) => void)(ajv);
  ajv.addSchema(commonTypes as object);
  ajv.addSchema({ ...(catalog as object), $id: CATALOG_SLOT });
  const validate = ajv.compile(serverToClient as object);
  validators.set(catalog.catalogId, validate);
  return validate;
}

type Component = { id?: unknown; component?: unknown; children?: unknown; child?: unknown; [k: string]: unknown };

/** The ids a component names as its children: a list of ids, one child, or a template over a path. */
function childIdsOf(c: Component): string[] {
  const out: string[] = [];
  const add = (v: unknown) => {
    if (typeof v === "string") out.push(v);
    else if (Array.isArray(v)) v.forEach(add);
    else if (v && typeof v === "object" && "componentId" in v && typeof (v as { componentId: unknown }).componentId === "string")
      out.push((v as { componentId: string }).componentId);
  };
  add(c.children);
  add(c.child);
  for (const key of ["trigger", "content", "header", "body"]) add(c[key]);
  if (Array.isArray(c["tabs"])) for (const t of c["tabs"] as { child?: unknown }[]) add(t?.child);
  return out;
}

/** Problems with a spec's A2UI messages; none means a renderer can draw them. */
export function surfaceProblems(messages: unknown[], catalog: Catalog = BASIC_CATALOG): Problem[] {
  const problems: Problem[] = [];
  const validate = messageValidator(catalog);
  messages.forEach((m, i) => {
    if (!validate(m)) {
      for (const e of (validate.errors ?? []).slice(0, 5)) problems.push({ at: `surface.messages[${i}]${e.instancePath}`, problem: e.message ?? "invalid" });
    }
  });
  if (problems.length) return problems;

  const first = messages[0] as { createSurface?: { surfaceId: string; catalogId: string } } | undefined;
  if (!first?.createSurface) return [{ at: "surface.messages[0]", problem: "must be createSurface" }];
  const { surfaceId, catalogId } = first.createSurface;
  if (catalogId !== catalog.catalogId) problems.push({ at: "surface.messages[0].createSurface.catalogId", problem: `must be ${catalog.catalogId}` });

  const components = new Map<string, Component>();
  messages.forEach((m, i) => {
    const body = Object.values(m as object)[1] as { surfaceId?: string } | undefined;
    const kind = Object.keys(m as object).find((k) => k !== "version");
    if (i > 0 && kind === "createSurface") problems.push({ at: `surface.messages[${i}]`, problem: "only one createSurface: a spec is one surface" });
    if (kind === "deleteSurface") problems.push({ at: `surface.messages[${i}]`, problem: "a spec never deletes its surface" });
    const sid = (m as Record<string, { surfaceId?: string }>)[kind ?? ""]?.surfaceId ?? body?.surfaceId;
    if (sid !== surfaceId) problems.push({ at: `surface.messages[${i}]`, problem: `surfaceId must be ${surfaceId}` });
    if (kind === "updateComponents") {
      for (const c of (m as { updateComponents: { components: Component[] } }).updateComponents.components) {
        const id = String(c.id);
        if (components.has(id)) problems.push({ at: `component ${id}`, problem: "duplicate id" });
        components.set(id, c);
      }
    }
  });
  if (!components.has("root")) problems.push({ at: "surface", problem: 'no component has the id "root"' });
  for (const [id, c] of components) {
    for (const child of childIdsOf(c)) if (!components.has(child)) problems.push({ at: `component ${id}`, problem: `child "${child}" doesn't exist` });
  }
  return problems;
}
