import type { Spec } from "@cloudcrane/app-spec/schema";
import { GAME_KIT } from "./kit.js";

// What the page takes from a coded component's frame, kept to what the spec
// declared, and the frame's page. Pure, so it's tested without a browser.

export type CodedDef = Spec["components"][string];

const OF_TYPE: Record<string, (v: unknown) => boolean> = {
  number: (v) => typeof v === "number" && Number.isFinite(v),
  string: (v) => typeof v === "string" && v.length <= 1000,
  boolean: (v) => typeof v === "boolean",
  list: (v) => Array.isArray(v),
  map: (v) => !!v && typeof v === "object" && !Array.isArray(v),
};

/** An event's declared fields of the declared types; null for an event the component doesn't declare. */
export function cleanEvent(def: CodedDef, name: string, data: unknown): Record<string, unknown> | null {
  if (!Object.hasOwn(def.events, name)) return null;
  const fields = def.events[name]!;
  const out: Record<string, unknown> = {};
  if (!data || typeof data !== "object") return out;
  for (const [k, type] of Object.entries(fields)) {
    const v = (data as Record<string, unknown>)[k];
    if (OF_TYPE[type]!(v)) out[k] = v;
  }
  return out;
}

/** The most state a frame may report at once, as JSON. */
export const MAX_STATE = 8 * 1024;

/** A state the frame reported, if it's a JSON object of at most MAX_STATE. */
export function cleanState(s: unknown): Record<string, unknown> | null {
  if (!s || typeof s !== "object" || Array.isArray(s)) return null;
  let json: string;
  try {
    json = JSON.stringify(s);
  } catch {
    return null;
  }
  return json.length <= MAX_STATE ? (JSON.parse(json) as Record<string, unknown>) : null;
}

const FRAME_CSS = "html,body{margin:0;height:100%;overflow:hidden;background:transparent}canvas{display:block;width:100%;height:100%;touch-action:none}";

/** The frame's page: a canvas, the kit, then the component's code (which the spec refuses if it holds </script>). */
export function frameHtml(code: string): string {
  return `<meta name="viewport" content="width=device-width,initial-scale=1"><style>${FRAME_CSS}</style><canvas></canvas><script>${GAME_KIT}</script><script>${code}</script>`;
}
