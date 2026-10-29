import type { Spec } from "./schema.js";

// A spec as a CloudCrane blueprint (v1): what CloudCrane shows on the install
// screen, in My apps and on Explore, and checks every app against. Everything
// in it is taken from the spec: purpose, journeys, promises, the sites it
// reaches, the colours it uses, and a plain account of the screen and of what
// it saves on the phone.

export type BlueprintV1 = {
  v: 1;
  purpose: string;
  screens: { id: string; says: string }[];
  data: { version: number; keeps: { key: string; what: string }[] };
  journeys: Spec["journeys"];
  promises: Spec["promises"];
  network: Spec["network"];
  uses?: Spec["uses"];
  icon?: string;
  category?: string;
  tags?: string[];
  design: { palette: string[]; notes: string };
};

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
  return {
    v: 1,
    purpose: spec.module.purpose,
    screens: [{ id: spec.module.id, says: screenWords(spec) }],
    data: {
      version: spec.data.version,
      keeps: [{ key: spec.data.key, what: saved.length ? `On this phone: ${list(saved)}` : "What you enter, on this phone" }],
    },
    journeys: spec.journeys,
    promises: spec.promises,
    network: spec.network,
    ...(spec.uses.length ? { uses: spec.uses } : {}),
    ...(spec.module.icon ? { icon: spec.module.icon } : {}),
    ...(spec.module.category ? { category: spec.module.category } : {}),
    ...(spec.module.tags?.length ? { tags: spec.module.tags } : {}),
    design: { palette: palette(spec.tokens), notes: `Built from a CloudCrane spec, runtime ${spec.manifest.runtime}.` },
  };
}
