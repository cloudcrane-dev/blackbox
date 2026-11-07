import type { Problem } from "./a2ui.js";
import type { Spec } from "./schema.js";

// How closely a spec can be shown to copy the app it came from.
// - Rules with no examples: nothing checks they do what the original does (a warning; the compiler checks every example
//   a rule has, so one recorded from the original app is proof).
// - What the screens are drawn with: the catalog's components, and the coded components standing in for what the
//   catalog can't draw, with the native widget each replaces. `blackbox coverage` adds these up across specs, so the
//   catalog grows where ports need it most.

/** The functions with no example to reproduce, in one warning that names them. */
export function rulesWarnings(spec: Pick<Spec, "logic">): Problem[] {
  const shown = new Set(spec.logic.vectors.map((v) => v.fn));
  const bare = Object.keys(spec.logic.functions).filter((fn) => !shown.has(fn));
  if (!bare.length) return [];
  const [one] = bare;
  return [
    {
      at: bare.length === 1 ? `/logic/functions/${one}` : "/logic/functions",
      problem: `${bare.length === 1 ? `${one} has` : `${bare.join(", ")} have`} no examples: nothing checks ${bare.length === 1 ? "it does" : "they do"} what the original does. Record some from the app (from: app) or its tests`,
    },
  ];
}

export type CatalogUse = {
  /** Each catalog component the screens place, and how many times. */
  catalog: Record<string, number>;
  /** Each coded component the screens place, its kit, and the native widget it replaces when the spec says. */
  coded: { name: string; kit: "game" | "page"; replaces: string | null; placed: number }[];
};

type Placed = { component?: string; use?: string };

/** What a spec's screens are drawn with. A page spec (the whole app as one page) counts as its one coded component. */
export function catalogUse(spec: Pick<Spec, "surface" | "components">): CatalogUse {
  const catalog: Record<string, number> = {};
  const placed: Record<string, number> = {};
  for (const m of spec.surface.messages)
    for (const c of (m as { updateComponents?: { components?: Placed[] } }).updateComponents?.components ?? []) {
      if (typeof c.component !== "string") continue;
      if (c.component === "Coded" && typeof c.use === "string") placed[c.use] = (placed[c.use] ?? 0) + 1;
      else catalog[c.component] = (catalog[c.component] ?? 0) + 1;
    }
  const coded = Object.entries(spec.components).map(([name, c]) => ({ name, kit: c.kit, replaces: c.replaces ?? null, placed: placed[name] ?? 0 }));
  return { catalog, coded };
}
