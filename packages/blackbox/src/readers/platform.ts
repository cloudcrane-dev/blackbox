import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

// Which platforms an app is written for, and where each kind of file Blackbox reads lives in it: found by name, never
// run. Shared by `blackbox init` (a starter blackbox.hints.json), `blackbox plan` and extract (when the hints don't say
// where things are).

export type Platform = "flutter" | "react-native" | "ios" | "android" | "web";

/** What extract reads, by kind, as paths relative to the repo. */
export type Found = {
  platforms: Platform[];
  /** Package manifests: dependencies suggest gaps (pubspec.yaml, package.json). */
  manifests: string[];
  /** What the app declares: phone features and capabilities (AndroidManifest.xml, Info.plist, *.entitlements). */
  declares: string[];
  /** Colours: Android colors.xml (and values-night), iOS colour sets, CSS files with variables. */
  colors: string[];
  /** Words people see: strings.xml, .xcstrings, .strings, .arb. */
  strings: string[];
  /** A Flutter theme file, for the existing theme reader. */
  theme: string | null;
  /** Where the screens are, for the assistant to read (not parsed yet). */
  screens: string[];
};

/** Folders never worth walking: dependencies, builds, caches. */
const SKIP = new Set([
  "node_modules",
  ".git",
  "build",
  "dist",
  ".dart_tool",
  "Pods",
  "DerivedData",
  ".gradle",
  ".idea",
  ".expo",
  "android/app/build",
  "ios/build",
  ".next",
  "coverage",
  "blackbox",
]);
const MAX_FILES = 20_000;

/** Every file under `repo`, relative, with forward slashes; skips dependency and build folders. */
export function filesIn(repo: string): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    let names: string[];
    try {
      names = readdirSync(dir).sort();
    } catch {
      return;
    }
    for (const name of names) {
      if (out.length >= MAX_FILES) return;
      const full = join(dir, name);
      const rel = relative(repo, full).split(sep).join("/");
      if (SKIP.has(name) || SKIP.has(rel) || name.startsWith(".")) continue;
      let st;
      try {
        st = statSync(full);
      } catch {
        continue;
      }
      if (st.isDirectory()) walk(full);
      else out.push(rel);
    }
  };
  walk(repo);
  return out;
}

const depsOf = (repo: string): Record<string, unknown> => {
  try {
    const pkg = JSON.parse(readFileSync(join(repo, "package.json"), "utf8")) as { dependencies?: Record<string, unknown> };
    return pkg.dependencies ?? {};
  } catch {
    return {};
  }
};

/** The platforms and the files of each kind, found by name. */
export function discover(repo: string, files: string[] = filesIn(repo)): Found {
  const has = (re: RegExp) => files.some((f) => re.test(f));
  const deps = depsOf(repo);
  const platforms: Platform[] = [];
  if (files.includes("pubspec.yaml")) platforms.push("flutter");
  if ("react-native" in deps || "expo" in deps) platforms.push("react-native");
  if (has(/(^|\/)[^/]+\.xcodeproj\//) || has(/(^|\/)Info\.plist$/) || files.includes("Package.swift")) platforms.push("ios");
  if (has(/(^|\/)AndroidManifest\.xml$/)) platforms.push("android");
  if (files.includes("package.json") && !platforms.includes("react-native") && !platforms.includes("flutter")) platforms.push("web");

  // A test or example target's files aren't the app's, nor a debug or profile build's own manifests.
  const app = files.filter(
    (f) =>
      !/(^|\/)(test|tests|androidTest|debug|profile|Tests|UITests|example|examples)\//.test(f) &&
      !/Tests?\.(swift|kt)$/.test(f) &&
      !/Debug\.entitlements$/.test(f),
  );
  const flutterTheme = app.find((f) => /^lib\/.*theme[^/]*\.dart$/i.test(f)) ?? null;
  return {
    platforms,
    manifests: ["pubspec.yaml", "package.json"].filter((f) => files.includes(f)),
    declares: app.filter((f) => /(^|\/)AndroidManifest\.xml$/.test(f) || /(^|\/)Info\.plist$/.test(f) || /\.entitlements$/.test(f)).slice(0, 20),
    colors: app
      .filter(
        (f) =>
          /(^|\/)res\/values(-night)?\/colors\.xml$/.test(f) ||
          /\.colorset\/Contents\.json$/.test(f) ||
          (/\.css$/.test(f) && !/\.min\.css$/.test(f) && /(^|\/)(src|app|styles?|public)\//.test(f)),
      )
      .slice(0, 200),
    strings: app
      .filter(
        (f) => /(^|\/)res\/values\/strings\.xml$/.test(f) || /\.xcstrings$/.test(f) || /(^|\/)(en|Base)\.lproj\/[^/]+\.strings$/.test(f) || /\.arb$/.test(f),
      )
      .slice(0, 20),
    theme: flutterTheme,
    screens: app
      .filter(
        (f) =>
          /^lib\/.*(screen|page|view)[^/]*\.dart$/i.test(f) ||
          /(View|Screen)\.swift$/.test(f) ||
          /(Screen|Activity|Fragment)\.kt$/.test(f) ||
          /(^|\/)res\/layout\/[^/]+\.xml$/.test(f) ||
          /(^|\/)(screens|pages|app)\/.*\.(tsx|jsx)$/.test(f),
      )
      .slice(0, 50),
  };
}

/**
 * A colour's name as a role: Material, Android, iOS and CSS names normalised (md_theme_dark_onPrimary, colorOnPrimary,
 * OnPrimary, --color-on-primary all give "on-primary"), and whether it's Material Theme Builder's dark one. Null for
 * names that aren't a role the runtime uses.
 */
export function roleOf(name: string): { role: string; dark: boolean } | null {
  let n = name
    .replace(/^--/, "")
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/[_\s.]+/g, "-")
    .toLowerCase();
  // Only Material Theme Builder's md_theme_dark_ prefix means dark mode: Android's old colorPrimaryDark is a darker
  // shade, not night. Elsewhere dark colours come from where they're declared (values-night, iOS appearances, a CSS
  // dark media query), so another name with dark or light in it isn't taken as a role.
  const dark = /^md-theme-dark-/.test(n);
  if (/^md-theme-(light|dark)-/.test(n)) n = n.replace(/^md-theme-(light|dark)-/, "");
  else if (/(^|-)(dark|light)(-|$)/.test(n)) return null;
  n = n.replace(/^(color|colors|clr|theme)-/, "").replace(/-color$/, "");
  const ROLES: Record<string, string> = {
    primary: "primary",
    accent: "primary",
    "accent-color": "primary",
    brand: "primary",
    "on-primary": "on-primary",
    "primary-foreground": "on-primary",
    background: "background",
    "window-background": "background",
    "system-background": "background",
    "on-background": "on-background",
    foreground: "on-background",
    text: "on-background",
    "text-primary": "on-background",
    "primary-text": "on-background",
    label: "on-background",
    surface: "surface",
    card: "surface",
    "secondary-system-background": "surface",
    "on-surface": "on-surface",
    "card-foreground": "on-surface",
    secondary: "secondary",
    "on-secondary": "on-secondary",
    error: "error",
    danger: "error",
    destructive: "error",
    "on-error": "on-error",
    outline: "border",
    border: "border",
    separator: "border",
    success: "success",
    warning: "warning",
    input: "input",
  };
  const role = ROLES[n];
  return role ? { role, dark } : null;
}

/** #RRGGBB (or #RRGGBBAA) from 0-255 or 0-1 components; alpha left off when opaque. */
export function hexOf(r: number, g: number, b: number, a = 1): string {
  const h = (x: number) =>
    Math.round(Math.max(0, Math.min(255, x)))
      .toString(16)
      .padStart(2, "0");
  return `#${h(r)}${h(g)}${h(b)}${a < 1 ? h(a * 255) : ""}`;
}
