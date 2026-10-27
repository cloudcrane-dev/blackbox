import type { TokenNode } from "@cloudcrane/app-spec/schema";

// A spec's DTCG tokens as CSS: each token's path is the name of the A2UI theme
// variable it sets (color.primary → --a2ui-color-primary, spacing.m →
// --a2ui-spacing-m), so A2UI's own components pick it up with nothing in
// between. Values per DTCG 2025.10: colours (hex, or colorSpace components),
// dimensions ({value, unit}), font families (a name or a list), numbers and
// strings. Sorted by name, so the same tokens are always the same CSS.

type Value = unknown;

function cssValue(type: string | undefined, v: Value): string | null {
  if (typeof v === "number") return String(v);
  if (typeof v === "string") return v;
  if (Array.isArray(v)) return type === "fontFamily" ? v.map((f) => (/^[\w-]+$/.test(String(f)) ? String(f) : JSON.stringify(String(f)))).join(", ") : null;
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    if (typeof o["hex"] === "string") return o["hex"];
    if (Array.isArray(o["components"]) && o["colorSpace"] === "srgb") {
      const [r, g, b] = (o["components"] as number[]).map((c) => Math.round(Math.max(0, Math.min(1, c)) * 255));
      const a = typeof o["alpha"] === "number" ? o["alpha"] : 1;
      return a === 1 ? `rgb(${r} ${g} ${b})` : `rgb(${r} ${g} ${b} / ${a})`;
    }
    if (typeof o["value"] === "number" && typeof o["unit"] === "string") return `${o["value"]}${o["unit"]}`;
  }
  return null;
}

/** Every token as [--a2ui-name, value], in name order. A group's $type applies to its tokens. */
export function tokenVariables(tokens: TokenNode): [string, string][] {
  const out: [string, string][] = [];
  const walk = (node: TokenNode, path: string[], type: string | undefined) => {
    const t = node.$type ?? type;
    if (node.$value !== undefined) {
      const v = cssValue(t, node.$value);
      if (v !== null && path.length) out.push([`--a2ui-${path.join("-")}`, v]);
      return;
    }
    for (const [k, child] of Object.entries(node)) if (!k.startsWith("$") && child && typeof child === "object") walk(child as TokenNode, [...path, k], t);
  };
  walk(tokens, [], undefined);
  return out.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
}

/** The tokens as a :root rule. */
export function tokensCss(tokens: TokenNode): string {
  return `:root{${tokenVariables(tokens)
    .map(([k, v]) => `${k}:${v};`)
    .join("")}}`;
}
