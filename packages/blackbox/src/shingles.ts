import type { Problem } from "@cloudcrane/app-spec";

// The second leak gate, against the partner's own source: no string in a spec
// may contain a run of 8 consecutive tokens (words, numbers, punctuation) that
// also appears in a source file it was read from. The static scan in app-spec
// catches code by its shape; this catches it by being copied, whatever its
// shape. CEL rules are exempt: they're translated from the source by design and
// checked by vectors instead. A2UI bindings (${/path}) are the standard's syntax.

const SIZE = 8;
const tokens = (s: string) => s.match(/[A-Za-z_$][\w$]*|\d+(?:\.\d+)?|[^\s\w]/g) ?? [];

function shinglesOf(text: string): Set<string> {
  const out = new Set<string>();
  const t = tokens(text);
  for (let i = 0; i + SIZE <= t.length; i++) out.add(t.slice(i, i + SIZE).join(" "));
  return out;
}

const CEL_AT = [/^\/logic\/functions\/[^/]+\/cel$/, /^\/logic\/computed\/.+$/, /^\/data\/migrations\/\d+\/cel$/];
const escape = (k: string) => k.replace(/~/g, "~0").replace(/\//g, "~1");

function* strings(v: unknown, at = ""): Generator<[string, string]> {
  if (typeof v === "string") yield [at, v];
  else if (Array.isArray(v)) for (let i = 0; i < v.length; i++) yield* strings(v[i], `${at}/${i}`);
  else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) yield* strings(x, `${at}/${escape(k)}`);
}

/** Strings in `spec` that repeat 8 tokens running from any of `sources`. */
export function shingleLeaks(spec: unknown, sources: string[]): Problem[] {
  const known = new Set<string>();
  for (const s of sources) for (const sh of shinglesOf(s)) known.add(sh);
  const problems: Problem[] = [];
  for (const [at, raw] of strings(spec)) {
    if (CEL_AT.some((r) => r.test(at))) continue;
    const text = raw.replace(/\$\{[^}]*\}/g, " ");
    for (const sh of shinglesOf(text))
      if (known.has(sh)) {
        problems.push({ at, problem: `repeats the source word for word ("${sh.slice(0, 60)}")` });
        break;
      }
  }
  return problems;
}
