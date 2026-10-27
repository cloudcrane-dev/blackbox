import type { Problem } from "./a2ui.js";

// What must never be in a spec, looked for in every string it holds: where the
// partner's code lives (file paths, file:line), code itself (functions, imports,
// classes, widget builders), secrets (well-known key formats, and long
// high-entropy strings), personal details (emails, phone numbers) and internal
// hosts. Pure, so CloudCrane and a Worker can run it too; Blackbox adds
// secretlint's rules on top. CEL expressions are exempt from the code check
// (they're the rules, by design) but not from the others.

type Rule = { kind: "path" | "code" | "secret" | "personal" | "host"; why: string; test: (s: string) => boolean };

const re = (r: RegExp) => (s: string) => r.test(s);
const SOURCE = "dart|ts|tsx|js|jsx|mjs|cjs|py|kt|kts|swift|java|go|rb|php|cs|m|mm|c|cc|cpp|h|vue|svelte";

/** Shannon entropy per character. */
function entropy(s: string): number {
  const counts = new Map<string, number>();
  for (const c of s) counts.set(c, (counts.get(c) ?? 0) + 1);
  let h = 0;
  for (const n of counts.values()) h -= (n / s.length) * Math.log2(n / s.length);
  return h;
}

/** A long run of key-like characters that looks random: a token, not a word. */
function highEntropy(s: string): boolean {
  for (const m of s.matchAll(/[A-Za-z0-9+/_=-]{32,}/g)) {
    const run = m[0];
    const hex = /^[0-9a-fA-F]+$/.test(run);
    if (entropy(run) > (hex ? 3.5 : 4.3)) return true;
  }
  return false;
}

/** 10 to 15 digits with phone punctuation, that isn't a date or a time. */
function phoneNumber(s: string): boolean {
  for (const m of s.matchAll(/(?<![\w-])\+?\d[\d\s().-]{8,}\d(?![\w-])/g)) {
    const run = m[0].trim();
    if (/^\d{4}-\d{2}-\d{2}/.test(run) || /^\d{1,2}:\d{2}/.test(run)) continue;
    const digits = run.replace(/\D/g, "").length;
    if (digits >= 10 && digits <= 15) return true;
  }
  return false;
}

const RULES: Rule[] = [
  { kind: "path", why: "a source file path", test: re(new RegExp(`(^|[\\s"'(\`])(?:[\\w.-]+/)+[\\w.-]+\\.(?:${SOURCE})\\b`)) },
  { kind: "path", why: "a file:line reference", test: re(new RegExp(`\\b[\\w./-]+\\.(?:${SOURCE}):\\d+`)) },
  { kind: "path", why: "an absolute path on someone's machine", test: re(/(^|\s)(\/Users\/|\/home\/|[A-Z]:\\)/) },
  { kind: "path", why: "a package folder", test: re(/node_modules\/|\.dart_tool\/|\/pubspec\.yaml/) },
  { kind: "secret", why: "an AWS access key", test: re(/\bAKIA[0-9A-Z]{16}\b/) },
  {
    kind: "secret",
    why: "an API key",
    test: re(/\b(sk|pk|rk)[-_](live|test|proj)?[-_]?[A-Za-z0-9]{20,}\b|\bAIza[0-9A-Za-z_-]{35}\b|\bgh[pousr]_[A-Za-z0-9]{36}\b|\bxox[abpr]-[A-Za-z0-9-]{10,}/),
  },
  { kind: "secret", why: "a JSON Web Token", test: re(/\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\./) },
  { kind: "secret", why: "a private key", test: re(/-----BEGIN [A-Z ]*PRIVATE KEY-----/) },
  { kind: "secret", why: "a long random-looking string", test: highEntropy },
  { kind: "personal", why: "an email address", test: re(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/) },
  { kind: "personal", why: "a phone number", test: phoneNumber },
  {
    kind: "host",
    why: "an internal address",
    test: re(
      /\b(localhost|127\.0\.0\.1|0\.0\.0\.0|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+|[\w-]+\.(internal|local|corp|lan))\b/,
    ),
  },
  { kind: "code", why: "an arrow function", test: re(/=>/) },
  { kind: "code", why: "a function definition", test: re(/\bfunction\s*\w*\s*\(|\bdef\s+\w+\s*\(|\bfun\s+\w+\s*\(/) },
  { kind: "code", why: "an import", test: re(/^\s*(import|export)\s+[\w{*'"]|\brequire\(\s*['"]/m) },
  { kind: "code", why: "a class definition", test: re(/\bclass\s+\w+\s+(extends|implements|with)\b/) },
  { kind: "code", why: "a widget builder", test: re(/\bWidget\s+build\s*\(|\bsetState\s*\(|\buseState\s*\(/) },
  { kind: "code", why: "a variable declaration", test: re(/\b(const|let|var|final)\s+[A-Za-z_]\w*\s*(:\s*\w+\s*)?=/) },
  { kind: "code", why: "statement punctuation", test: (s) => (s.match(/[;{}]/g)?.length ?? 0) >= 4 },
  { kind: "code", why: "a method call", test: re(/\b[A-Za-z_$][\w$]*(\?)?\.[A-Za-z_$][\w$]*(<[^>]*>)?\(/) },
  { kind: "code", why: "a constructor call", test: re(/(?<![\w$])_?[A-Z][A-Za-z0-9_]*(<[^>]*>)?\(/) },
  { kind: "code", why: "a property line", test: re(/^\s*[a-z_$][\w$]*\s*:\s*\S.*[,({[]\s*$/) },
  { kind: "code", why: "control flow", test: re(/\b(if|for|while|switch|catch)\s*\(|\bawait\s+[\w$.]|\breturn\s+[\w$(!'"[{]|\}\s*else\b/) },
  { kind: "code", why: "a code operator", test: re(/===?|!==?|&&|\|\||\?\?|\?\.|\+\+|--(?=[\w$])|\b\w+\s*[+\-*/]?=\s*[\w$'"(\[]/) },
  {
    kind: "code",
    why: "a typed declaration",
    test: re(/\b(final|late|required|static|private|public|protected|readonly)\s+[A-Za-z_$][\w$<>?,\s]*\s+[A-Za-z_$][\w$]*\s*[;=,)]/),
  },
  { kind: "code", why: "a statement end", test: re(/[)\]}]\s*;\s*$|^\s*[\w$.]+\s*\([^)]*\)\s*;?\s*$/) },
  { kind: "code", why: "a generic type", test: re(/\b[A-Za-z_$][\w$]*<[A-Z][\w$<>?,\s]*>/) },
  { kind: "code", why: "a block opener", test: re(/\)\s*(async\s*)?\{\s*$|\(\{\s*$|\)\s+[a-z_$][\w$]*\s*\(/) },
  { kind: "code", why: "a member of this", test: re(/\bthis\.[A-Za-z_$]/) },
  { kind: "code", why: "a trailing code comment", test: re(/[;,){\]]\s*\/\/\s/) },
  { kind: "code", why: "a quoted key", test: re(/^\s*(['"])[\w-]+\1\s*:\s*\S/) },
  { kind: "code", why: "a string literal in code", test: re(/^\s*(['"]).*\1\s*[,)]\s*(\1|$)|^\s*(['"])[^'"]*\4\s*,\s*(['"])|\\n/) },
  { kind: "code", why: "a typed function", test: re(/\b(bool|int|double|String|void|dynamic|num|var|Future|Stream)\??\s+_?[A-Za-z$][\w$]*\s*\(/) },
  { kind: "code", why: "a conditional expression", test: re(/(^|[\s(])\?\s*[\w$.'"!]+.*\s:\s*[\w$.'"]/) },
  { kind: "code", why: "a member access", test: re(/\b[A-Z][A-Za-z0-9]*\.[a-z_][\w$]*\b|\b[a-z_$][\w$]*\.[a-z_$][\w$]*[A-Z][\w$]*\b/) },
  { kind: "code", why: "string interpolation", test: re(/\$\{|\$[a-z_][\w]*/) },
  { kind: "code", why: "a cast or an index", test: re(/\bas\s+[A-Z][\w$]*\??|\[(['"])[\w-]+\1\]|\w!\.|\w!\(|\}\s*from\s*['"]|\/\*\*|\*\//) },
  {
    kind: "code",
    why: "a type annotation",
    test: re(/^\s*[A-Za-z_$][\w$]*\??\s*:\s*[^\s].*[;,]\s*$|\|\s*(null|undefined|string|number|boolean)\b|\bPromise<|\basync\s+[\w$]+\s*\(/),
  },
  { kind: "code", why: "a call", test: re(/^\s*\.[a-z_$][\w$]*\(|\b[a-z_$][\w$]*\((['"`]|[\w$]{2,}[,)]|\)|\{)/) },
  { kind: "code", why: "a constant name", test: re(/\b[A-Z][A-Z0-9]*_[A-Z0-9_]+\b/) },
];

/** Strings the scan skips, by pointer: the source hash is a hash by design. */
const EXEMPT = new Set(["/manifest/source/fingerprint"]);
/** Where CEL lives: rules may look like code there, but nothing else may. */
const CEL_AT = [/^\/logic\/functions\/[^/]+\/cel$/, /^\/logic\/computed\/.+$/, /^\/data\/migrations\/\d+\/cel$/];

const escape = (k: string) => k.replace(/~/g, "~0").replace(/\//g, "~1");

/** Every string in a value, with its JSON Pointer (object keys count as strings too). */
function* strings(v: unknown, at = ""): Generator<[string, string]> {
  if (typeof v === "string") yield [at, v];
  else if (Array.isArray(v)) for (let i = 0; i < v.length; i++) yield* strings(v[i], `${at}/${i}`);
  else if (v && typeof v === "object")
    for (const [k, x] of Object.entries(v)) {
      yield [`${at}/${escape(k)}#key`, k];
      yield* strings(x, `${at}/${escape(k)}`);
    }
}

/** What in a spec looks like code, a path, a secret, a personal detail or an internal host. */
export function leakProblems(spec: unknown): Problem[] {
  const problems: Problem[] = [];
  for (const [at, raw] of strings(spec)) {
    if (EXEMPT.has(at)) continue;
    // DTCG's own keys ($type, $value, …) are the format's, not the partner's.
    if (at.endsWith("#key") && /^\$[a-z]+$/.test(raw)) continue;
    // Rule names, parameters and pointers under /logic are CEL identifiers the schema already restricts.
    if (at.endsWith("#key") && at.startsWith("/logic/")) continue;
    // A2UI's bindings inside text (${/path}, ${fn(…)}) are the standard's syntax.
    const s = at.startsWith("/surface/") || at.startsWith("/data/views/") ? raw.replace(/\$\{[^}]*\}/g, " ") : raw;
    const isCel = CEL_AT.some((r) => r.test(at));
    // Web addresses are checked as addresses (hosts, secrets), never as code.
    const withoutUrls = s.replace(/https?:\/\/[^\s"'<>]+/g, " ");
    for (const rule of RULES) {
      if (isCel && rule.kind === "code") continue;
      if (rule.test(rule.kind === "code" ? withoutUrls : s)) {
        problems.push({ at: at || "/", problem: `looks like ${rule.why} (${rule.kind})` });
        break;
      }
    }
  }
  return problems;
}
