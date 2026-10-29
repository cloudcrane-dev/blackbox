import { useEffect, useRef } from "preact/hooks";
import { z } from "zod";
import { CommonSchemas } from "@a2ui/web_core/v0_9";
import { createComponentImplementation } from "@a2ui/react/v0_9";
import type { Spec } from "@cloudcrane/app-spec/schema";
import { cleanEvent, cleanState, frameHtml, frameOptions, storeMessage, type CodedDef } from "./coded.js";

// Coded: places one of the spec's coded components. Its code runs in a frame
// that's sandboxed (scripts only, so its origin is opaque: no storage, nothing
// of the page's), out of the page's reach (a closed shadow root), and reached
// only through a MessagePort. Where CloudCrane's lockdown is in the page, it
// makes that frame (window.__ccFrame), with the lockdown inside too; elsewhere
// (a preview) the runtime makes the same kind of frame itself. The frame is
// allowed the device features the spec declares; a page kit whose spec
// declares the camera or microphone gets the page's origin, which the browser
// requires for them (see frameOptions).
//
// The page drives it: a seed and the inputs once, then the clock each frame,
// paused while the app is hidden. What comes back is kept to what the spec
// declared: its state, at /ui/coded/<id>/state, and events, whose fields are
// set at /ui/coded/<id>/<event> before the action the screen gives them runs.

export const CodedApi = {
  name: "Coded",
  schema: z.object({
    use: z.string(),
    label: CommonSchemas.DynamicString,
    aspect: z.number().optional(),
    inputs: z.array(z.object({ name: z.string(), value: CommonSchemas.DynamicValue })).optional(),
    on: z.array(z.object({ name: z.string(), action: CommonSchemas.Action })).optional(),
  }),
};

type Props = {
  use: string;
  label?: string;
  aspect?: number;
  inputs?: { name: string; value: unknown }[];
  on?: { name: string; action: () => Promise<void> }[];
};

type Env = { components: Record<string, CodedDef>; set(path: string, value: unknown): void; dataKey: string; uses: Spec["uses"] };
let env: Env = { components: {}, set() {}, dataKey: "app", uses: [] };

/** Where a component's localStorage is kept on the page: beside the app's own data, one key per component. */
const storeKeyOf = (use: string) => `${env.dataKey}.coded.${use}`;
function readStore(use: string): Record<string, string> {
  try {
    const v = JSON.parse(localStorage.getItem(storeKeyOf(use)) ?? "{}") as unknown;
    if (!v || typeof v !== "object" || Array.isArray(v)) return {};
    return Object.fromEntries(Object.entries(v).filter(([, x]) => typeof x === "string")) as Record<string, string>;
  } catch {
    return {};
  }
}
/** The spec's coded components and the data model, given once at boot. */
export function setCodedEnv(e: Env): void {
  env = e;
}

type Options = { allow: string; sameOrigin: boolean };
type Maker = (into: Element, html: string, options: Options) => MessagePort;

/** The same frame the lockdown makes, for a page without it. */
const ownFrame: Maker = (into, html, { allow, sameOrigin }) => {
  const host = document.createElement("div");
  host.style.cssText = "display:block;width:100%;height:100%";
  const root = host.attachShadow({ mode: "closed" });
  const f = document.createElement("iframe");
  f.setAttribute("sandbox", sameOrigin ? "allow-scripts allow-same-origin" : "allow-scripts");
  if (allow) f.setAttribute("allow", allow);
  f.setAttribute("title", "Custom part of this app");
  f.setAttribute("style", "border:0;display:block;width:100%;height:100%");
  f.setAttribute("srcdoc", html);
  const ch = new MessageChannel();
  f.addEventListener("load", () => f.contentWindow?.postMessage("cc-port", "*", [ch.port2]), { once: true });
  root.appendChild(f);
  into.appendChild(host);
  return ch.port1;
};

// The lockdown's maker decides for itself what the frame may use, from what the app's version declares; these are what the page asks for.
const makeFrame: Maker = (into, html, options) => {
  const lockdowns = (window as { __ccFrame?: Maker }).__ccFrame;
  return typeof lockdowns === "function" ? lockdowns(into, html, options) : ownFrame(into, html, options);
};

const inputsOf = (p: Props) => Object.fromEntries((p.inputs ?? []).map((i) => [i.name, i.value]));

export const Coded = createComponentImplementation(CodedApi, ({ props, context }: { props: unknown; context: { componentModel: { id: string } } }) => {
  const p = props as Props;
  const id = context.componentModel.id;
  const box = useRef<HTMLDivElement>(null);
  const port = useRef<MessagePort | null>(null);
  const latest = useRef(p);
  latest.current = p;
  const sent = useRef<Record<string, string>>({});

  useEffect(() => {
    const def = env.components[p.use];
    if (!def || !box.current) return;
    const at = `/ui/coded/${id}`;
    let kept = readStore(p.use);
    const ch = makeFrame(box.current, frameHtml(def, kept), frameOptions(def, env.uses));
    port.current = ch;
    let lastState = "";
    ch.onmessage = (e: MessageEvent) => {
      const d = (e.data ?? {}) as { state?: unknown; emit?: { name?: unknown; data?: unknown }; store?: unknown };
      if ("store" in d) {
        const next = storeMessage(kept, d.store);
        if (next) {
          try {
            localStorage.setItem(storeKeyOf(p.use), JSON.stringify(next));
            kept = next;
          } catch {
            // A full or blocked storage keeps the app running; it just can't save, as on a page of its own.
          }
        }
        return;
      }
      if ("state" in d) {
        const s = cleanState(d.state);
        const json = s && JSON.stringify(s);
        if (s && json !== lastState) {
          lastState = json!;
          env.set(`${at}/state`, s);
        }
      }
      if (d.emit && typeof d.emit.name === "string") {
        const fields = cleanEvent(def, d.emit.name, d.emit.data);
        if (!fields) return;
        env.set(`${at}/${d.emit.name}`, fields);
        void latest.current.on?.find((h) => h.name === d.emit!.name)?.action();
      }
    };
    const inputs = inputsOf(latest.current);
    sent.current = Object.fromEntries(Object.entries(inputs).map(([k, v]) => [k, JSON.stringify(v)]));
    ch.postMessage({ init: { seed: Math.floor(Math.random() * 2 ** 31), inputs } });

    // The clock: one tick a frame while the app shows.
    let raf = 0;
    let before: number | null = null;
    const tick = (t: number) => {
      if (before !== null) ch.postMessage({ tick: t - before });
      before = t;
      raf = requestAnimationFrame(tick);
    };
    const shown = () => {
      ch.postMessage({ visible: !document.hidden });
      cancelAnimationFrame(raf);
      before = null;
      if (!document.hidden) raf = requestAnimationFrame(tick);
    };
    document.addEventListener("visibilitychange", shown);
    shown();
    const into = box.current;
    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener("visibilitychange", shown);
      ch.close();
      port.current = null;
      into.replaceChildren();
    };
  }, [p.use, id]);

  // An input the page changes (a button the screen has) goes to the frame.
  useEffect(() => {
    if (!port.current) return;
    for (const [name, value] of Object.entries(inputsOf(p))) {
      const json = JSON.stringify(value);
      if (sent.current[name] === json) continue;
      sent.current[name] = json;
      port.current.postMessage({ input: { name, value } });
    }
  });

  const page = env.components[p.use]?.kit === "page";
  return page ? (
    <div class="cc-coded cc-page" ref={box} role="group" aria-label={p.label} />
  ) : (
    <div class="cc-coded" ref={box} role="group" aria-label={p.label} style={{ aspectRatio: String(p.aspect ?? 1) }} />
  );
});
