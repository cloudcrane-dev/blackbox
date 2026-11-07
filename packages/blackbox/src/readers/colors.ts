import { hexOf, roleOf } from "./platform.js";

// An app's colours by role, light and dark, from the files each platform keeps them in (read, never run):
// - Android res/values/colors.xml, and res/values-night/colors.xml for dark;
// - iOS asset-catalog colour sets (Name.colorset/Contents.json), with their dark appearance;
// - CSS custom properties (--primary...), dark under @media (prefers-color-scheme: dark) or a .dark / [data-theme=dark]
//   selector, as hex, rgb(), hsl() or shadcn's bare "222 84% 5%".
// Only names that are a role the runtime uses are kept (roleOf); the hints' theme roles can map others.

export type FoundColor = { name: string; role: string; dark: boolean; value: string; file: string; line: number };

const lineAt = (text: string, index: number) => text.slice(0, index).split("\n").length;

/** #RGB, #ARGB, #RRGGBB or Android's #AARRGGBB as #rrggbb (or #rrggbbaa when not opaque). */
function androidHex(v: string): string | null {
  const m = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(v.trim());
  if (!m) return null;
  let h = m[1]!.toLowerCase();
  if (h.length <= 4) h = [...h].map((c) => c + c).join("");
  if (h.length === 8) {
    const a = h.slice(0, 2);
    h = h.slice(2) + (a === "ff" ? "" : a);
  }
  return `#${h}`;
}

function hslHex(h: number, s: number, l: number, a = 1): string {
  s /= 100;
  l /= 100;
  const k = (n: number) => (n + h / 30) % 12;
  const f = (n: number) => l - s * Math.min(l, 1 - l) * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
  return hexOf(f(0) * 255, f(8) * 255, f(4) * 255, a);
}

/** A CSS colour value as hex, or null when it isn't one we can read (a var(), a named colour, a gradient). */
export function cssColor(v: string): string | null {
  const t = v.trim().replace(/\s*!important$/, "");
  if (/^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(t)) {
    const h = t.slice(1).toLowerCase();
    return `#${h.length === 3 ? [...h].map((c) => c + c).join("") : h}`;
  }
  const num = (x: string) => Number.parseFloat(x);
  const rgb = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+%?))?\s*\)$/i.exec(t);
  if (rgb) return hexOf(num(rgb[1]!), num(rgb[2]!), num(rgb[3]!), rgb[4] ? (rgb[4].endsWith("%") ? num(rgb[4]) / 100 : num(rgb[4])) : 1);
  const hsl = /^(?:hsla?\()?\s*([\d.]+)(?:deg)?[\s,]+([\d.]+)%[\s,]+([\d.]+)%(?:[\s,/]+([\d.]+%?))?\s*\)?$/i.exec(t);
  if (hsl) return hslHex(num(hsl[1]!), num(hsl[2]!), num(hsl[3]!), hsl[4] ? (hsl[4].endsWith("%") ? num(hsl[4]) / 100 : num(hsl[4])) : 1);
  return null;
}

/** Android colors.xml: each <color name="...">#...</color> whose name is a role. In values-night, every one is dark. */
export function androidColors(file: string, text: string): FoundColor[] {
  const night = /(^|\/)values-night\//.test(file);
  const out: FoundColor[] = [];
  for (const m of text.matchAll(/<color\b[^>]*\bname\s*=\s*"([^"]+)"[^>]*>\s*([^<]+?)\s*<\/color>/g)) {
    const r = roleOf(m[1]!);
    const value = androidHex(m[2]!);
    if (r && value) out.push({ name: m[1]!, role: r.role, dark: night || r.dark, value, file, line: lineAt(text, m.index!) });
  }
  return out;
}

type Component = string | number;
const channel = (c: Component | undefined): number => {
  if (c === undefined) return 0;
  if (typeof c === "number") return c <= 1 ? c * 255 : c;
  const s = c.trim();
  if (/^0x/i.test(s)) return Number.parseInt(s, 16);
  const n = Number.parseFloat(s);
  return s.includes(".") || n <= 1 ? n * 255 : n;
};

/** An iOS colour set: its light colour, and its dark one when it has a dark appearance; the role from the set's name. */
export function iosColorset(file: string, text: string): FoundColor[] {
  const name = /([^/]+)\.colorset\/Contents\.json$/.exec(file)?.[1];
  const r = name ? roleOf(name) : null;
  if (!name || !r) return [];
  let json: { colors?: { appearances?: { appearance?: string; value?: string }[]; color?: { components?: Record<string, Component> } }[] };
  try {
    json = JSON.parse(text) as typeof json;
  } catch {
    return [];
  }
  const out: FoundColor[] = [];
  for (const c of json.colors ?? []) {
    const comps = c.color?.components;
    if (!comps) continue;
    const dark = (c.appearances ?? []).some((a) => a.appearance === "luminosity" && a.value === "dark");
    // Any other appearance (light, high contrast) repeats or varies the default: only the default and dark are kept.
    if ((c.appearances ?? []).length && !dark) continue;
    const alpha = comps["alpha"] === undefined ? 1 : channel(comps["alpha"]) / 255;
    out.push({ name, role: r.role, dark, value: hexOf(channel(comps["red"]), channel(comps["green"]), channel(comps["blue"]), alpha), file, line: 1 });
  }
  return out;
}

const DARK_SELECTOR = /(^|[\s,])(\.dark|\[data-theme=["']?dark["']?\]|:root\.dark|html\.dark|\.theme-dark)\b/;

/** CSS custom properties that are roles, light and dark: dark when any enclosing @media or selector says so. */
export function cssVars(file: string, text: string): FoundColor[] {
  const src = text.replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, " "));
  const out: FoundColor[] = [];
  // Walk the rules with their nesting: each declaration knows its selector and whether an enclosing @media is dark.
  const stack: { prelude: string; dark: boolean }[] = [];
  let start = 0;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (ch === "{") {
      const prelude = src.slice(start, i).trim();
      const parentDark = stack.some((s) => s.dark);
      const dark = parentDark || /prefers-color-scheme\s*:\s*dark/.test(prelude) || DARK_SELECTOR.test(prelude);
      stack.push({ prelude, dark });
      start = i + 1;
    } else if (ch === "}" || ch === ";") {
      const decl = src.slice(start, i);
      const m = /^\s*(--[\w-]+)\s*:\s*([^;{}]+?)\s*$/.exec(decl);
      if (m && stack.length) {
        const r = roleOf(m[1]!);
        const value = cssColor(m[2]!);
        if (r && value) out.push({ name: m[1]!, role: r.role, dark: stack.some((s) => s.dark), value, file, line: lineAt(src, start + decl.search(/\S/)) });
      }
      if (ch === "}") stack.pop();
      start = i + 1;
    }
  }
  return out;
}

/** The colours of one file, by its kind. */
export function colorsIn(file: string, text: string): FoundColor[] {
  if (/colors\.xml$/.test(file)) return androidColors(file, text);
  if (/\.colorset\/Contents\.json$/.test(file)) return iosColorset(file, text);
  if (/\.css$/.test(file)) return cssVars(file, text);
  return [];
}

/** Each role once in light and once in dark: the first file listed wins, so a theme's own file can come before others. */
export function byRole(found: FoundColor[]): { light: Map<string, FoundColor>; dark: Map<string, FoundColor> } {
  const light = new Map<string, FoundColor>();
  const dark = new Map<string, FoundColor>();
  for (const c of found) {
    const into = c.dark ? dark : light;
    if (!into.has(c.role)) into.set(c.role, c);
  }
  return { light, dark };
}
