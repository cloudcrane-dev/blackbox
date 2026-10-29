// Types for the host bundle (vendor.mjs copies this beside blackbox.mjs).
// Written by hand so a host needs no Blackbox types; host.test.ts checks the
// bundle exports exactly these names.

export type Problem = { at: string; problem: string };

/** A spec that passed validateSpec. Opaque to a host beyond what it reads. */
export type Spec = {
  v: 1;
  manifest: { runtime: string; generator: string; source: { fingerprint: string } };
  module: { id: string; name: string; purpose: string; icon?: string; category?: string; tags?: string[] };
  data: { version: number; key: string; [k: string]: unknown };
  network: { site: string; why: string }[];
  uses: { what: string; why: string }[];
  page?: string;
  [k: string]: unknown;
};

export type BlueprintV1 = {
  v: 1;
  purpose: string;
  screens: { id: string; says: string }[];
  data: { version: number; keeps: { key: string; what: string }[] };
  journeys: { id: string; title: string; steps: { id: string; text: string }[] }[];
  promises: { id: string; text: string; kind?: "data" }[];
  network: { site: string; why: string }[];
  uses?: { what: string; why: string }[];
  icon?: string;
  category?: string;
  tags?: string[];
  design: { palette: string[]; notes: string };
};

export type LinkedRuntime = { path: string; integrity: string };
/** `runtime` names the runtime the page carries, or is "page" for an HTML app's spec, which is its page as written. */
export type Compiled = { html: string; sha256: string; runtime: string; linked?: LinkedRuntime };

/** What an HTML app says about itself, to make its spec from (wrapPage). */
export type PageApp = {
  id: string;
  name: string;
  purpose: string;
  html: string;
  generator: string;
  runtime?: string;
  data: { version: number; key: string };
  journeys: { id: string; title: string; steps: { id: string; text: string }[] }[];
  promises?: { id: string; text: string; kind?: "data" }[];
  network?: { site: string; why: string }[];
  uses?: { what: string; why: string }[];
  tests?: Record<string, unknown>[];
  icon?: string;
  category?: string;
  tags?: string[];
};
export type CompileOptions = { runtime?: "inline" | "shared" };

export function validateSpec(input: unknown): { spec: Spec | null; problems: Problem[] };
export function leakProblems(spec: unknown): Problem[];
export function deriveBlueprint(spec: Spec): BlueprintV1;
/** An HTML app as a spec whose one component is the page; check it with validateSpec. */
export function wrapPage(app: PageApp): Record<string, unknown>;
/** The spec as the HTML page it is, or null when it isn't one. */
export function pageOf(spec: Spec): string | null;
export function compile(input: unknown, options?: CompileOptions): Compiled;
export function runtimeFile(): LinkedRuntime & { js: string };
export class CompileError extends Error {
  readonly problems: Problem[];
}
/** The A2UI catalog spec apps are drawn with: an id, never fetched. validateSpec accepts no other. */
export const CLOUDCRANE_CATALOG_ID: string;
export const RUNTIME_JS: string;
export const RUNTIME_SHA256: string;
export const RUNTIME_VERSION: string;
