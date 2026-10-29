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

/** A colour's relative lightness, 0 to 1, from #rgb, #rrggbb or rgb(r g b); null for anything else. */
function lightness(css: string): number | null {
  let rgb: number[] | null = null;
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(css.trim());
  if (hex) {
    const h = hex[1]!.length === 3 ? [...hex[1]!].map((c) => c + c).join("") : hex[1]!;
    rgb = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
  }
  const fn = /^rgb\(\s*(\d+)\s+(\d+)\s+(\d+)/.exec(css.trim());
  if (fn) rgb = fn.slice(1, 4).map(Number);
  if (!rgb) return null;
  const [r, g, b] = rgb.map((c) => {
    const x = c / 255;
    return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

/**
 * The tokens as a :root rule, with the page's colour scheme taken from its own
 * background: A2UI's defaults for what a spec leaves out (a plain button's
 * text) are light-dark() pairs, which would otherwise follow the phone's
 * setting and put light text on a light page. Light unless the background is dark.
 */
export function tokensCss(tokens: TokenNode): string {
  const vars = tokenVariables(tokens);
  const background = vars.find(([k]) => k === "--a2ui-color-background")?.[1];
  const l = background === undefined ? null : lightness(background);
  const scheme = l !== null && l < 0.18 ? "dark" : "light";
  return `:root{color-scheme:${scheme};${vars.map(([k, v]) => `${k}:${v};`).join("")}}`;
}
