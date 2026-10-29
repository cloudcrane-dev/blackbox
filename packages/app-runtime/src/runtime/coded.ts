import type { Spec } from "@cloudcrane/app-spec/schema";
import { featuresOf, NEEDS_ORIGIN } from "@cloudcrane/app-spec/uses";
import { GAME_KIT } from "./kit.js";

// What the page takes from a coded component's frame, kept to what the spec
// declared, and the frame's page. Pure, so it's tested without a browser.

export type CodedDef = Spec["components"][string];

/**
 * What a component's frame may use: the browser features of the device
 * features the spec declares (its `allow`), and for a page kit, the page's
 * origin when the spec declares the camera or microphone, which the browser
 * gives no frame without an origin of its own. A game kit always stays apart.
 */
export function frameOptions(def: CodedDef, uses: Spec["uses"]): { allow: string; sameOrigin: boolean } {
  return { allow: featuresOf(uses).join("; "), sameOrigin: def.kit === "page" && uses.some((u) => NEEDS_ORIGIN.includes(u.what)) };
}

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

/** The most a component may keep, as JSON: within the space a phone gives a site, beside the app's own data. */
export const MAX_STORE = 4 * 1024 * 1024;

/** JSON that can't end the script it sits in. */
const scriptSafe = (v: unknown) =>
  JSON.stringify(v)
    .replace(/</g, "\\u003c")
    .replace(new RegExp(String.fromCharCode(0x2028), "g"), "\\u2028")
    .replace(new RegExp(String.fromCharCode(0x2029), "g"), "\\u2029");

/**
 * The first script in every frame: it owns the port to the page (as
 * __ccBus, which the kits use) and replaces the sandbox's unusable
 * localStorage with one holding what the component saved, which the page
 * wrote in. Each change goes to the page, which keeps it.
 */
export function bridgeScript(stored: Record<string, string>): string {
  return `(function(){"use strict";var port=null,out=[],on=[],data={};var stored=${scriptSafe(stored)};
for(var k in stored)if(Object.prototype.hasOwnProperty.call(stored,k)&&typeof stored[k]==="string")data[k]=stored[k];
function send(m){if(port)port.postMessage(m);else out.push(m)}
Object.defineProperty(window,"__ccBus",{value:{send:send,on:function(f){on.push(f)}}});
addEventListener("message",function(e){if(e.data!=="cc-port"||port||!e.ports||!e.ports[0])return;port=e.ports[0];
port.onmessage=function(m){on.forEach(function(f){f(m.data)})};var q=out;out=[];q.forEach(send)});
var has=function(k){return Object.prototype.hasOwnProperty.call(data,k)};
var store={getItem:function(k){k=String(k);return has(k)?data[k]:null},
setItem:function(k,v){k=String(k);v=String(v);data[k]=v;send({store:{set:[k,v]}})},
removeItem:function(k){k=String(k);if(has(k)){delete data[k];send({store:{remove:k}})}},
clear:function(){data={};send({store:{clear:true}})},
key:function(i){return Object.keys(data)[i]||null},
get length(){return Object.keys(data).length}};
try{Object.defineProperty(window,"localStorage",{value:store,configurable:true})}catch(e){}})();`;
}

/** What the page keeps after a change the frame sent; null for one that isn't well formed or would go past MAX_STORE. */
export function storeMessage(kept: Record<string, string>, msg: unknown): Record<string, string> | null {
  if (!msg || typeof msg !== "object") return null;
  const m = msg as { set?: unknown; remove?: unknown; clear?: unknown };
  let next: Record<string, string>;
  if (m.clear === true) next = {};
  else if (typeof m.remove === "string") {
    next = { ...kept };
    delete next[m.remove];
  } else if (Array.isArray(m.set) && typeof m.set[0] === "string" && typeof m.set[1] === "string") next = { ...kept, [m.set[0]]: m.set[1] };
  else return null;
  return JSON.stringify(next).length <= MAX_STORE ? next : null;
}

const FRAME_CSS = "html,body{margin:0;height:100%;overflow:hidden;background:transparent}canvas{display:block;width:100%;height:100%;touch-action:none}";

/** A frame's page: the bridge, then a game kit's canvas, kit and code, or a page kit's page as written (the spec refuses </script> in a game's code). */
export function frameHtml(def: CodedDef, stored: Record<string, string>): string {
  const bridge = `<script>${bridgeScript(stored)}</script>`;
  if (def.kit === "page") return bridge + def.code;
  return `<meta name="viewport" content="width=device-width,initial-scale=1"><style>${FRAME_CSS}</style>${bridge}<canvas></canvas><script>${GAME_KIT}</script><script>${def.code}</script>`;
}
