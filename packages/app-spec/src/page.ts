import { CLOUDCRANE_CATALOG_ID } from "./catalog.js";
import type { Spec } from "./schema.js";

// An app written as one HTML page, as a spec. The page is its one page-kit
// component, and `page` names it: the spec is then the page, and the compiler
// gives back its HTML as written, with no runtime. It runs, saves and is
// tested exactly as it would on its own (the same storage keys, the same
// address, the same tests), while it's described, versioned and checked like
// any spec. Without `page`, the same component runs in a frame among the
// spec's own screens.

/** The spec as the page it is, or null when it isn't one. */
export function pageOf(spec: Spec): string | null {
  if (!spec.page) return null;
  const c = spec.components[spec.page];
  return c?.kit === "page" ? c.code : null;
}

type Problem = { at: string; problem: string };

/** What a spec that says it's a page may hold: the page, full screen, and no logic of its own. */
export function pageProblems(spec: Spec): Problem[] {
  if (!spec.page) return [];
  const c = spec.components[spec.page];
  if (c?.kit !== "page") return [{ at: "page", problem: "names no page-kit component" }];
  const problems: Problem[] = [];
  if (Object.keys(spec.components).length !== 1) problems.push({ at: "page", problem: "the page is the spec's only component" });
  if (Object.keys(c.inputs).length || Object.keys(c.events).length) problems.push({ at: "page", problem: "the page takes no inputs and sends no events" });
  const placed = spec.surface.messages.flatMap(
    (m) => ((m["updateComponents"] as { components?: unknown[] } | undefined)?.components ?? []) as Record<string, unknown>[],
  );
  if (placed.length !== 1 || placed[0]!["component"] !== "Coded" || placed[0]!["use"] !== spec.page)
    problems.push({ at: "page", problem: "the screen can hold nothing but the page" });
  const { functions, computed, vectors } = spec.logic;
  if (Object.keys(functions).length || Object.keys(computed).length || vectors.length || spec.data.views.length || spec.data.migrations.length)
    problems.push({ at: "page", problem: "a page has no logic, views or migrations of the spec's own: its code keeps its data" });
  return problems;
}

/** What an HTML app says about itself, to make its spec from. */
export type PageApp = {
  id: string;
  name: string;
  purpose: string;
  html: string;
  /** What made the spec, like "cloudcrane, from an HTML app" (the leak scan refuses one shaped like a call). */
  generator: string;
  /** The runtime version the spec is for; a page needs none, but the spec names the compiler's. */
  runtime?: string;
  data: { version: number; key: string };
  journeys: Spec["journeys"];
  promises?: Spec["promises"];
  network?: Spec["network"];
  uses?: Spec["uses"];
  tests?: Spec["tests"];
  icon?: string;
  category?: string;
  tags?: string[];
};

// A page draws itself, so these only satisfy the spec's shape; they're never shown.
const TOKENS = {
  color: { $type: "color", background: { $value: "#ffffff" }, "on-background": { $value: "#111111" }, primary: { $value: "#0f766e" } },
};

/** An HTML app as a spec whose one component is the page, full screen. Check it with validateSpec. */
export function wrapPage(app: PageApp): Record<string, unknown> {
  return {
    v: 1,
    manifest: { runtime: app.runtime ?? "0.0.0", generator: app.generator, source: { fingerprint: `sha256:${"0".repeat(64)}` } },
    module: {
      id: app.id,
      name: app.name,
      purpose: app.purpose,
      ...(app.icon ? { icon: app.icon } : {}),
      ...(app.category ? { category: app.category } : {}),
      ...(app.tags?.length ? { tags: app.tags } : {}),
    },
    tokens: TOKENS,
    surface: {
      catalog: CLOUDCRANE_CATALOG_ID,
      messages: [
        { version: "v0.9.1", createSurface: { surfaceId: app.id, catalogId: CLOUDCRANE_CATALOG_ID } },
        { version: "v0.9.1", updateComponents: { surfaceId: app.id, components: [{ id: "root", component: "Coded", use: "page", label: app.name }] } },
      ],
    },
    data: { version: app.data.version, key: app.data.key, persist: "/saved", views: [], schema: { type: "object" }, initial: {}, migrations: [] },
    logic: { consts: {}, functions: {}, computed: {}, vectors: [] },
    network: app.network ?? [],
    uses: app.uses ?? [],
    journeys: app.journeys,
    promises: app.promises ?? [],
    tests: app.tests ?? [],
    components: { page: { kind: "coded", kit: "page", inputs: {}, events: {}, code: app.html } },
    page: "page",
    mods: { open: [], locked: [] },
  };
}
