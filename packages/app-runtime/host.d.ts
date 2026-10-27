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
  icon?: string;
  category?: string;
  tags?: string[];
  design: { palette: string[]; notes: string };
};

export type Compiled = { html: string; sha256: string; runtime: string };

export function validateSpec(input: unknown): { spec: Spec | null; problems: Problem[] };
export function leakProblems(spec: unknown): Problem[];
export function deriveBlueprint(spec: Spec): BlueprintV1;
export function compile(input: unknown): Compiled;
export class CompileError extends Error {
  readonly problems: Problem[];
}
/** The A2UI catalog spec apps are drawn with: an id, never fetched. validateSpec accepts no other. */
export const CLOUDCRANE_CATALOG_ID: string;
export const RUNTIME_JS: string;
export const RUNTIME_SHA256: string;
export const RUNTIME_VERSION: string;
