// A Flutter theme's colours, font and corner radius, read from its Dart source:
// `static Color get name => dark ? const Color(0xAARRGGBB) : const Color(...)`
// (or one colour, or Colors.white / Colors.black), `GoogleFonts.<family>(`, and
// `BorderRadius.circular(<n>)` / `double radius = <n>`. Reading text, not
// running Dart. Each value keeps its line, for provenance.

export type ThemeColor = { name: string; dark: string; light: string; line: number };
export type FlutterTheme = { colors: ThemeColor[]; font: { family: string; line: number } | null; radius: { value: number; line: number } | null };

const NAMED: Record<string, string> = { white: "#ffffff", black: "#000000", transparent: "#00000000" };

/** 0xAARRGGBB as #rrggbb (or #rrggbbaa when not opaque). */
function hexOf(argb: string): string {
  const v = argb.toLowerCase().replace(/^0x/, "").padStart(8, "f");
  const [a, rgb] = [v.slice(0, 2), v.slice(2)];
  return a === "ff" ? `#${rgb}` : `#${rgb}${a}`;
}

const colorIn = (s: string): string | null => {
  const hex = /Color\(\s*(0x[0-9a-fA-F]{6,8})\s*\)/.exec(s);
  if (hex) return hexOf(hex[1]!);
  const named = /Colors\.(\w+)\b/.exec(s);
  return named && NAMED[named[1]!] ? NAMED[named[1]!]! : null;
};

/** "atkinsonHyperlegible" → "Atkinson Hyperlegible". */
const familyName = (camel: string) => camel.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/^./, (c) => c.toUpperCase());

export function readFlutterTheme(source: string): FlutterTheme {
  const colors: ThemeColor[] = [];
  let font: FlutterTheme["font"] = null;
  let radius: FlutterTheme["radius"] = null;
  source.split("\n").forEach((text, i) => {
    const line = i + 1;
    const getter = /static\s+(?:const\s+)?Color\s+get\s+(\w+)\s*=>\s*(.+);/.exec(text) ?? /static\s+(?:const\s+)?Color\s+(\w+)\s*=\s*(.+);/.exec(text);
    if (getter) {
      const [, name, value] = getter;
      const branch = /^(.*?)\?(.*):(.*)$/.exec(value!);
      const dark = branch ? colorIn(branch[2]!) : colorIn(value!);
      const light = branch ? colorIn(branch[3]!) : dark;
      if (dark && light) colors.push({ name: name!, dark, light, line });
    }
    const f = /GoogleFonts\.(\w+?)(?:TextTheme)?\(/.exec(text);
    if (f && !font) font = { family: familyName(f[1]!), line };
    const r = /double\s+radius\s*=\s*(\d+(?:\.\d+)?)/.exec(text) ?? /BorderRadius\.circular\(\s*(\d+(?:\.\d+)?)\s*\)/.exec(text);
    if (r && !radius) radius = { value: Number(r[1]), line };
  });
  return { colors, font, radius };
}

/** Common Flutter colour names → the A2UI theme variable they set (tokens' paths). A hint can add or override. */
export const ROLES: Record<string, string[]> = {
  primaryColor: ["color", "primary"],
  primary: ["color", "primary"],
  primaryForeground: ["color", "on-primary"],
  onPrimary: ["color", "on-primary"],
  background: ["color", "background"],
  scaffoldBackgroundColor: ["color", "background"],
  cardColor: ["color", "surface"],
  surfaceColor: ["color", "surface"],
  surface: ["color", "surface"],
  cardBorder: ["color", "border"],
  borderColor: ["color", "border"],
  foreground: ["color", "on-background"],
  onSurface: ["color", "on-surface"],
  mutedForeground: ["text", "caption-color"],
  inputColor: ["color", "input"],
  successColor: ["color", "success"],
  amber: ["color", "warning"],
  warningColor: ["color", "warning"],
  destructive: ["color", "error"],
  errorColor: ["color", "error"],
};
