import type { Problem } from "./a2ui.js";
import type { Spec } from "./schema.js";

// Warnings, not refusals: what makes an app look good and work well, measured from the spec alone.
//
// How it looks: the colour roles a screen needs are there, and each text colour reads on what it sits on (WCAG 2.2
// contrast, 4.5:1 for text), in light and, when the spec has them, dark colours (tokens.dark). Token types the
// runtime can't draw are said rather than silently dropped.
// What it does: a screen that lists saved things says what it shows when there are none, and an app that talks to a
// site says what it shows offline and when the site fails.

/** The colour roles every screen uses: the page, and its main action. */
export const CORE_ROLES = ["background", "on-background", "primary", "on-primary"] as const;
/** Each "on" colour and what it sits on, read as text. */
export const TEXT_PAIRS: [string, string][] = [
  ["on-background", "background"],
  ["on-surface", "surface"],
  ["on-primary", "primary"],
  ["on-input", "input"],
  ["error", "background"],
];
/** WCAG 2.2 minimum contrast for normal-size text. */
export const TEXT_CONTRAST = 4.5;
/** DTCG types the runtime has no CSS for. */
const UNDRAWN = new Set(["shadow", "typography", "gradient", "border", "transition", "strokeStyle", "cubicBezier"]);

type Node = Record<string, unknown>;

/** A colour token's value as [r, g, b] 0-255, from #rgb, #rrggbb (or #rrggbbaa) or DTCG srgb components; null otherwise. */
export function rgbOf(value: unknown): [number, number, number] | null {
  if (typeof value === "string") {
    const hex = /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(value.trim());
    if (!hex) return null;
    const h = hex[1]!.length === 3 ? [...hex[1]!].map((c) => c + c).join("") : hex[1]!.slice(0, 6);
    return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number];
  }
  if (value && typeof value === "object") {
    const o = value as Node;
    if (typeof o["hex"] === "string") return rgbOf(o["hex"]);
    if (o["colorSpace"] === "srgb" && Array.isArray(o["components"]) && o["components"].length >= 3)
      return (o["components"] as number[]).slice(0, 3).map((c) => Math.round(Math.max(0, Math.min(1, Number(c))) * 255)) as [number, number, number];
  }
  return null;
}

/** WCAG relative luminance. */
const luminance = ([r, g, b]: [number, number, number]) => {
  const [lr, lg, lb] = [r, g, b].map((c) => {
    const x = c / 255;
    return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * lr! + 0.7152 * lg! + 0.0722 * lb!;
};

/** WCAG contrast ratio between two colours, 1 to 21. */
export function contrast(a: [number, number, number], b: [number, number, number]): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/** The color.* tokens of a tree, by role, as written. */
function colours(tree: unknown): Map<string, unknown> {
  const out = new Map<string, unknown>();
  const color = tree && typeof tree === "object" ? (tree as Node)["color"] : undefined;
  if (!color || typeof color !== "object") return out;
  for (const [k, v] of Object.entries(color as Node))
    if (!k.startsWith("$") && v && typeof v === "object" && "$value" in (v as Node)) out.set(k, (v as Node)["$value"]);
  return out;
}

/** Every token's $type that the runtime can't draw, with where it is. */
function undrawn(tree: unknown, path: string[] = [], type?: string): string[] {
  if (!tree || typeof tree !== "object") return [];
  const node = tree as Node;
  const t = typeof node["$type"] === "string" ? (node["$type"] as string) : type;
  if ("$value" in node) return t && UNDRAWN.has(t) ? [`${path.join(".")} (${t})`] : [];
  return Object.entries(node).flatMap(([k, v]) => (k.startsWith("$") ? [] : undrawn(v, [...path, k], t)));
}

function themeWarnings(scheme: "light" | "dark", roles: Map<string, unknown>): Problem[] {
  const at = scheme === "light" ? "tokens.color" : "tokens.dark.color";
  const out: Problem[] = [];
  for (const [text, under] of TEXT_PAIRS) {
    const a = roles.get(text);
    const b = roles.get(under);
    if (a === undefined || b === undefined) continue;
    const fg = rgbOf(a);
    const bg = rgbOf(b);
    if (!fg || !bg) continue;
    const ratio = contrast(fg, bg);
    if (ratio < TEXT_CONTRAST)
      out.push({ at: `${at}.${text}`, problem: `${text} on ${under} is ${ratio.toFixed(1)}:1; text needs at least ${TEXT_CONTRAST}:1 to read (WCAG)` });
  }
  return out;
}

/** What could look better: the colour roles, their contrast in light and dark, and token types the runtime can't draw. */
export function designWarnings(spec: Spec): Problem[] {
  const out: Problem[] = [];
  const light = colours(spec.tokens);
  for (const role of CORE_ROLES) if (!light.has(role)) out.push({ at: "tokens.color", problem: `no color.${role}: every screen uses it` });
  out.push(...themeWarnings("light", light));
  const darkTree = (spec.tokens as Node)["dark"];
  if (darkTree) {
    // Dark colours replace the light ones they name; the rest stay as they are.
    const dark = new Map([...light, ...colours(darkTree)]);
    out.push(...themeWarnings("dark", dark));
  } else {
    out.push({ at: "tokens", problem: "no dark colours (tokens.dark): the app stays light when the phone is set to dark" });
  }
  for (const where of undrawn(spec.tokens))
    out.push({ at: `tokens.${where.split(" ")[0]}`, problem: `the runtime can't draw ${where} yet; it's left out of the page` });
  return out;
}

/** Whether a surface shows a list of things (an A2UI List, or a view of saved data). */
function listsThings(spec: Spec): boolean {
  if (spec.data.views.length) return true;
  return spec.surface.messages.some((m) =>
    ((m as { updateComponents?: { components?: { component?: string }[] } }).updateComponents?.components ?? []).some((c) => c.component === "List"),
  );
}

/** What could work better: each screen's empty, offline and error states, said. */
export function statesWarnings(spec: Spec): Problem[] {
  const out: Problem[] = [];
  const online = spec.network.length > 0;
  if (!spec.screens) {
    if (listsThings(spec) || online)
      out.push({ at: "screens", problem: "no screens described: say what each shows when it's empty, offline or something fails" });
    return out;
  }
  // Said once for the app, not per screen: not every screen lists things or goes online.
  const has = (state: "empty" | "offline" | "error") => spec.screens!.some((s) => s.states?.[state]);
  if (listsThings(spec) && !has("empty")) out.push({ at: "screens", problem: "no empty state: say what a screen shows before anything is saved" });
  if (online && !has("offline")) out.push({ at: "screens", problem: "no offline state: say what it shows without a connection" });
  if (online && !has("error")) out.push({ at: "screens", problem: `no error state: say what it shows when ${spec.network[0]!.site} fails` });
  return out;
}
