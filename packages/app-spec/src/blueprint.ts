import type { Spec } from "./schema.js";
import { keptShape, type KeptType } from "./memory.js";
import { rgbOf } from "./design.js";

// A spec as a CloudCrane blueprint (v1): what CloudCrane shows on the install
// screen, in My apps and on Explore, and checks every app against. Everything
// in it is taken from the spec, in the blueprint's four sections:
// - what it does: purpose, its screens (as the spec describes them, with their empty, loading, offline and error
//   states, or a plain account of the surface), journeys and promises;
// - what it keeps: the data version, and the saved data's fields and their types, with the personal ones marked;
// - how it looks: its design tokens by role (light, and dark as color.dark.*), its palette, its orientation;
// - what it can reach: each site with why and what it's sent, and the device features it uses.

export type BlueprintV1 = {
  v: 1;
  purpose: string;
  screens: { id: string; says: string; states?: { empty?: string; loading?: string; offline?: string; error?: string } }[];
  data: { version: number; keeps: { key: string; what: string; shape?: Record<string, KeptType>; personal?: boolean }[] };
  journeys: Spec["journeys"];
  promises: Spec["promises"];
  network: Spec["network"];
  uses?: Spec["uses"];
  icon?: string;
  category?: string;
  tags?: string[];
  screen?: { orientation?: "portrait" | "landscape" | "any"; fullscreen?: boolean };
  design: { palette: string[]; notes: string; tokens?: Record<string, string> };
};

/** A blueprint's tokens are at most this many, by role (CloudCrane's blueprint takes 40). */
const MAX_TOKENS = 40;

/**
 * The design tokens by role, as CloudCrane's blueprint holds them: colours as #hex (light as color.<role>, dark as
 * color.dark.<role>), the corner radius and the font. Names as the spec has them, lower-case.
 */
function rolesOf(tokens: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  const hex = (v: unknown) => {
    const rgb = rgbOf(v);
    return rgb ? `#${rgb.map((c) => c.toString(16).padStart(2, "0")).join("")}` : null;
  };
  const tree = (tokens ?? {}) as Record<string, Record<string, unknown>>;
  const colours = (group: unknown, prefix: string) => {
    if (!group || typeof group !== "object") return;
    for (const [role, node] of Object.entries(group as Record<string, unknown>)) {
      if (role.startsWith("$") || !node || typeof node !== "object" || !("$value" in node)) continue;
      const h = hex((node as { $value: unknown }).$value);
      if (h && /^[a-z][a-z0-9-]*$/.test(role)) out[`${prefix}.${role}`] = h;
    }
  };
  colours(tree["color"], "color");
  colours((tree["dark"] as Record<string, unknown> | undefined)?.["color"], "color.dark");
  const radius = tree["border-radius"]?.["$value"] as { value?: number; unit?: string } | undefined;
  if (radius && typeof radius.value === "number" && typeof radius.unit === "string") out["border-radius"] = `${radius.value}${radius.unit}`;
  const font = tree["font-family"]?.["$value"];
  if (typeof font === "string") out["font-family"] = font.slice(0, 100);
  else if (Array.isArray(font)) out["font-family"] = font.map(String).join(", ").slice(0, 100);
  return Object.fromEntries(Object.entries(out).slice(0, MAX_TOKENS));
}

type Component = { id: string; component: string; text?: unknown; label?: unknown; child?: string };

const literal = (v: unknown) => (typeof v === "string" ? v.replace(/\$\{[^}]*\}/g, "…").trim() : null);
const list = (xs: string[], max = 6) => {
  const u = [...new Set(xs.filter(Boolean))];
  return u.length > max ? `${u.slice(0, max).join(", ")} and more` : u.join(", ");
};

/** The plain words a person sees on the screen: titles, labels and buttons. */
function screenWords(spec: Spec): string {
  const components = spec.surface.messages.flatMap((m) => (m as { updateComponents?: { components: Component[] } }).updateComponents?.components ?? []);
  const byId = new Map(components.map((c) => [c.id, c]));
  const texts = components.filter((c) => c.component === "Text").map((c) => literal(c.text));
  const inputs = components
    .filter((c) => ["TextField", "CheckBox", "ChoicePicker", "Slider", "DateTimeInput"].includes(c.component))
    .map((c) => literal(c.label));
  // A one-character label (×, +) is a glyph, not a word a person reads.
  const buttons = components.filter((c) => c.component === "Button").map((c) => literal(byId.get(c.child ?? "")?.text));
  const words = (xs: (string | null)[]) => xs.filter((t): t is string => !!t && t.length > 1);
  const widgets = components.filter((c) => !["Text", "Column", "Row", "List", "Card", "Button", "Divider"].includes(c.component)).map((c) => c.component);
  const parts = [
    words(texts).length && `Shows ${list(words(texts).filter((t) => !buttons.includes(t)))}`,
    words(inputs).length && `asks for ${list(words(inputs))}`,
    words(buttons).length && `with ${list(words(buttons))}`,
    widgets.length && `using ${list(widgets)}`,
  ].filter(Boolean);
  return `${parts.join("; ")}.`;
}

/** Every colour in the tokens, as written. */
function palette(tokens: unknown): string[] {
  const out: string[] = [];
  const walk = (n: unknown) => {
    if (!n || typeof n !== "object") return;
    const v = (n as { $value?: unknown }).$value;
    if (typeof v === "string" && /^#[0-9a-fA-F]{3,8}$/.test(v)) out.push(v.toLowerCase());
    else if (v && typeof v === "object" && typeof (v as { hex?: unknown }).hex === "string") out.push((v as { hex: string }).hex.toLowerCase());
    for (const [k, c] of Object.entries(n)) if (!k.startsWith("$")) walk(c);
  };
  walk(tokens);
  return [...new Set(out)].slice(0, 12);
}

export function deriveBlueprint(spec: Spec): BlueprintV1 {
  const saved = spec.data.initial && typeof spec.data.initial === "object" ? Object.keys(spec.data.initial as object) : [];
  const shape = keptShape(spec.data.schema);
  const tokens = rolesOf(spec.tokens);
  return {
    v: 1,
    purpose: spec.module.purpose,
    // The screens as the spec describes them, with their states; else one, in the surface's own words.
    screens: spec.screens ?? [{ id: spec.module.id, says: screenWords(spec) }],
    data: {
      version: spec.data.version,
      keeps: [
        {
          key: spec.data.key,
          what: saved.length ? `On this phone: ${list(saved)}` : "What you enter, on this phone",
          ...(Object.keys(shape).length ? { shape } : {}),
          ...(spec.data.personal?.length ? { personal: true } : {}),
        },
      ],
    },
    journeys: spec.journeys,
    promises: spec.promises,
    network: spec.network,
    ...(spec.uses.length ? { uses: spec.uses } : {}),
    ...(spec.module.icon ? { icon: spec.module.icon } : {}),
    ...(spec.module.category ? { category: spec.module.category } : {}),
    ...(spec.module.tags?.length ? { tags: spec.module.tags } : {}),
    ...(spec.screen ? { screen: spec.screen } : {}),
    design: {
      palette: palette(spec.tokens),
      notes: `Built from a CloudCrane spec, runtime ${spec.manifest.runtime}.`,
      ...(Object.keys(tokens).length ? { tokens } : {}),
    },
  };
}
