import { surfaceProblems, type Catalog, type Problem } from "./a2ui.js";
import { catalogFor } from "./catalog.js";
import { leakProblems } from "./leak.js";
import { logicProblems } from "./logic.js";
import { SpecSchema, type Spec } from "./schema.js";

// Everything wrong with a spec, collected rather than stopping at the first: the
// envelope's shape, then the A2UI surface, then references between parts.

const pathOf = (path: (string | number)[]) =>
  path
    .map((p) => (typeof p === "number" ? `[${p}]` : `.${p}`))
    .join("")
    .replace(/^\./, "");

export function validateSpec(input: unknown, catalog?: Catalog): { spec: Spec | null; problems: Problem[] } {
  const parsed = SpecSchema.safeParse(input);
  if (!parsed.success) return { spec: null, problems: parsed.error.issues.map((i) => ({ at: pathOf(i.path) || "spec", problem: i.message })) };
  const spec = parsed.data;
  // The surface is checked against the catalog it names (CloudCrane's, or A2UI's basic one).
  const named = catalog ?? catalogFor(spec.surface.catalog);
  if (!named) return { spec: null, problems: [{ at: "surface.catalog", problem: "not a catalog this runtime has" }] };
  const problems: Problem[] = [...surfaceProblems(spec.surface.messages, named)];

  const catalogId = (spec.surface.messages[0] as { createSurface?: { catalogId?: string } }).createSurface?.catalogId;
  if (catalogId && catalogId !== spec.surface.catalog) problems.push({ at: "surface.catalog", problem: "must be the catalog createSurface names" });

  const ids = new Set<string>();
  for (const j of spec.journeys) {
    if (ids.has(j.id)) problems.push({ at: `journeys ${j.id}`, problem: "duplicate id" });
    ids.add(j.id);
    for (const s of j.steps) {
      if (!s.id.startsWith(`${j.id}.`)) problems.push({ at: `journeys ${s.id}`, problem: `a step of ${j.id} is numbered ${j.id}.n` });
      if (ids.has(s.id)) problems.push({ at: `journeys ${s.id}`, problem: "duplicate id" });
      ids.add(s.id);
    }
  }
  for (const p of spec.promises) {
    if (ids.has(p.id)) problems.push({ at: `promises ${p.id}`, problem: "duplicate id" });
    ids.add(p.id);
  }
  for (const v of spec.logic.vectors) if (!(v.fn in spec.logic.functions)) problems.push({ at: `logic.vectors ${v.fn}`, problem: "no such function" });
  for (const m of spec.data.migrations)
    if (m.to !== m.from + 1 || m.to > spec.data.version)
      problems.push({ at: `data.migrations ${m.from}`, problem: "steps go one version at a time, up to data.version" });
  problems.push(...logicProblems(spec), ...leakProblems(spec));
  for (const locked of spec.mods.locked) if (spec.mods.open.includes(locked)) problems.push({ at: `mods ${locked}`, problem: "both open and locked" });
  return { spec: problems.length ? null : spec, problems };
}
