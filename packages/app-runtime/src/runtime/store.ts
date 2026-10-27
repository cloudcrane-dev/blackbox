import type { Rules } from "@cloudcrane/app-spec/logic";
import type { Spec } from "@cloudcrane/app-spec/schema";

// What an app saves on the phone: the part of its data model under
// data.persist, kept under data.key as {"v": version, ...saved}, the shape the
// hand-written apps already use (so a spec-built version reads what they saved).
// An older version is moved up one step at a time by the spec's CEL migrations;
// a newer one (from a later version of the app) is read as it is, never
// overwritten with less.

type Data = Spec["data"];
export type Loaded = { saved: Record<string, unknown>; version: number; note: "new" | "loaded" | "migrated" | "newer" | "unreadable" };

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

export function loadSaved(raw: string | null, data: Data, rules: Rules): Loaded {
  const fresh = (note: Loaded["note"]): Loaded => ({ saved: structuredClone(data.initial) as Record<string, unknown>, version: data.version, note });
  if (raw === null) return fresh("new");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return fresh("unreadable");
  }
  if (!isRecord(parsed) || typeof parsed["v"] !== "number") return fresh("unreadable");
  const { v, ...saved } = parsed as { v: number } & Record<string, unknown>;
  if (v === data.version) return { saved, version: v, note: "loaded" };
  if (v > data.version) return { saved, version: v, note: "newer" };
  let now: Record<string, unknown> = saved;
  for (let from = v; from < data.version; from++) {
    const step = data.migrations.find((m) => m.from === from);
    if (!step) return fresh("unreadable");
    const next = rules.evaluate(step.cel, { saved: now });
    if (!isRecord(next)) return fresh("unreadable");
    now = next;
  }
  return { saved: now, version: data.version, note: "migrated" };
}

/** What to write back: never over data a newer version of the app saved. */
export function serializeSaved(saved: unknown, loaded: Loaded, data: Data): string | null {
  if (loaded.note === "newer") return null;
  return JSON.stringify({ v: data.version, ...(isRecord(saved) ? saved : {}) });
}
