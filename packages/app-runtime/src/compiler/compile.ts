import { createHash } from "node:crypto";
import { canonical, validateSpec, type Spec } from "@cloudcrane/app-spec";
import { CODED_CSS, DATESTRIP_CSS } from "../runtime/styles.js";
import { tokensCss } from "../runtime/theme.js";
import { RUNTIME_JS, RUNTIME_SHA256, RUNTIME_VERSION } from "./runtime.generated.js";

// The compiler: a spec in, one HTML page out, the same bytes every time for the
// same spec and runtime version. It writes no code: it checks the spec, turns
// the tokens into CSS, puts the spec in the page as data (canonical JSON) and
// inlines the prebuilt runtime that draws it. Nothing here reads the time, the
// locale, the environment or a file.

export class CompileError extends Error {
  constructor(readonly problems: { at: string; problem: string }[]) {
    super(`The spec has ${problems.length} problem${problems.length === 1 ? "" : "s"}: ${problems.map((p) => `${p.at}: ${p.problem}`).join("; ")}`);
  }
}

/** Where a page that links the runtime finds it, and the hash its bytes must have. */
export type LinkedRuntime = { path: string; integrity: string };
export type Compiled = { html: string; sha256: string; runtime: string; linked?: LinkedRuntime };

/**
 * How a page carries the runtime: inline (the default: the page stands alone,
 * as blackbox preview and anyone hosting it themselves need) or shared (it
 * links one file every spec app on a host shares, which the host serves from
 * runtimeFile(); the integrity hash means a browser runs nothing else).
 */
export type CompileOptions = { runtime?: "inline" | "shared" };

let file: (LinkedRuntime & { js: string }) | undefined;
/** The runtime as the file a shared page links: its path (named by version and hash), its bytes and their integrity hash. */
export function runtimeFile(): LinkedRuntime & { js: string } {
  file ??= {
    path: `/_cc/runtime/${RUNTIME_VERSION}-${RUNTIME_SHA256.slice(0, 12)}.js`,
    js: RUNTIME_JS,
    integrity: `sha256-${createHash("sha256").update(RUNTIME_JS).digest("base64")}`,
  };
  return file;
}

/** The page's base: the tokens set A2UI's variables; this lays out the page around the surface. */
const BASE_CSS =
  "*{box-sizing:border-box}html,body{margin:0}body{background:var(--a2ui-color-background,#fff);color:var(--a2ui-color-on-background,#111);font-family:var(--a2ui-font-family,system-ui,sans-serif);-webkit-text-size-adjust:100%}#app{max-width:30rem;margin:0 auto;padding:max(16px,env(safe-area-inset-top)) 16px max(24px,env(safe-area-inset-bottom))}@media (prefers-reduced-motion:reduce){*{transition:none!important;animation:none!important}}";

const escapeHtml = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
/** JSON that can't end its own <script> element. */
const scriptSafe = (json: string) =>
  json
    .replace(/</g, "\\u003c")
    .replace(new RegExp(String.fromCharCode(0x2028), "g"), "\\u2028")
    .replace(new RegExp(String.fromCharCode(0x2029), "g"), "\\u2029");

export function compile(input: unknown, options: CompileOptions = {}): Compiled {
  const mode = options.runtime ?? "inline";
  if (mode !== "inline" && mode !== "shared") throw new TypeError("The runtime is inline or shared.");
  const { spec, problems } = validateSpec(input);
  if (!spec) throw new CompileError(problems);
  if (spec.manifest.runtime !== RUNTIME_VERSION)
    throw new CompileError([{ at: "manifest.runtime", problem: `this compiler builds runtime ${RUNTIME_VERSION}` }]);
  // Only what drawing the app needs goes in the page: not the journeys, promises or tests.
  // Coded components go in only when there are some, and the device features they may use only when it uses some.
  const inPage: Pick<Spec, "data" | "logic" | "surface"> & Partial<Pick<Spec, "components" | "uses">> & { module: Spec["module"] } = {
    module: spec.module,
    ...(Object.keys(spec.components).length ? { components: spec.components } : {}),
    ...(spec.uses.length ? { uses: spec.uses } : {}),
    data: spec.data,
    logic: spec.logic,
    surface: spec.surface,
  };
  const html =
    "<!doctype html>\n" +
    '<html lang="en"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">' +
    `<meta name="cc-runtime" content="${RUNTIME_VERSION}">` +
    `<title>${escapeHtml(spec.module.name)}</title>` +
    `<style>${tokensCss(spec.tokens)}${BASE_CSS}${DATESTRIP_CSS}${CODED_CSS}</style>` +
    '</head><body><main id="app"></main>' +
    `<script type="application/json" id="cc-spec">${scriptSafe(canonical(inPage))}</script>` +
    (mode === "shared"
      ? `<script type="module" src="${runtimeFile().path}" integrity="${runtimeFile().integrity}"></script>`
      : `<script type="module">${RUNTIME_JS}</script>`) +
    "</body></html>\n";
  return {
    html,
    sha256: createHash("sha256").update(html).digest("hex"),
    runtime: `@cloudcrane/app-runtime@${RUNTIME_VERSION}+${RUNTIME_SHA256.slice(0, 12)}`,
    ...(mode === "shared" ? { linked: { path: runtimeFile().path, integrity: runtimeFile().integrity } } : {}),
  };
}
