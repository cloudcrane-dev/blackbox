// The words people see in an app, by key, from the files each platform keeps them in (read, never run): Android
// res/values/strings.xml, iOS String Catalogs (.xcstrings, the source language) and .strings files, and Flutter's .arb
// files. extract writes them beside the spec (strings.json) for whoever writes its screens, so labels and messages
// match the original; they aren't put in the spec.

export type FoundString = { key: string; text: string; file: string; line: number };

const lineAt = (text: string, index: number) => text.slice(0, index).split("\n").length;
const xmlText = (s: string) =>
  s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/<[^>]+>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\\'/g, "'")
    .replace(/\\"/g, '"')
    .replace(/\\n/g, "\n")
    .trim()
    .replace(/^"(.*)"$/s, "$1");

/** Text keys are kept at most this long, texts at most this long, and at most this many per file. */
const MAX_KEY = 120;
const MAX_TEXT = 500;
const MAX_PER_FILE = 2000;

export function stringsIn(file: string, text: string): FoundString[] {
  const out: FoundString[] = [];
  const push = (key: string, value: string, line: number) => {
    if (out.length >= MAX_PER_FILE || !key || !value.trim()) return;
    out.push({ key: key.slice(0, MAX_KEY), text: value.slice(0, MAX_TEXT), file, line });
  };
  if (/strings\.xml$/.test(file)) {
    for (const m of text.matchAll(/<string\b[^>]*\bname\s*=\s*"([^"]+)"[^>]*>([\s\S]*?)<\/string>/g)) push(m[1]!, xmlText(m[2]!), lineAt(text, m.index!));
  } else if (/\.xcstrings$/.test(file)) {
    let json: { sourceLanguage?: string; strings?: Record<string, { localizations?: Record<string, { stringUnit?: { value?: string } }> }> };
    try {
      json = JSON.parse(text) as typeof json;
    } catch {
      return [];
    }
    const lang = json.sourceLanguage ?? "en";
    const lines = text.split("\n");
    for (const [key, entry] of Object.entries(json.strings ?? {})) {
      const value = entry.localizations?.[lang]?.stringUnit?.value ?? key;
      const line = Math.max(1, lines.findIndex((l) => l.includes(JSON.stringify(key))) + 1);
      push(key, value, line);
    }
  } else if (/\.strings$/.test(file)) {
    for (const m of text.matchAll(/^\s*"((?:[^"\\]|\\.)*)"\s*=\s*"((?:[^"\\]|\\.)*)"\s*;/gm))
      push(m[1]!.replace(/\\"/g, '"'), m[2]!.replace(/\\"/g, '"').replace(/\\n/g, "\n"), lineAt(text, m.index!));
  } else if (/\.arb$/.test(file)) {
    let json: Record<string, unknown>;
    try {
      json = JSON.parse(text) as Record<string, unknown>;
    } catch {
      return [];
    }
    const lines = text.split("\n");
    for (const [key, value] of Object.entries(json))
      if (!key.startsWith("@") && typeof value === "string") push(key, value, Math.max(1, lines.findIndex((l) => l.includes(`"${key}"`)) + 1));
  }
  return out;
}
