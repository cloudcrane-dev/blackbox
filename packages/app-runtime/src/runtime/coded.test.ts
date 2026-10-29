import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { bridgeScript, cleanEvent, cleanState, frameHtml, frameOptions, storeMessage } from "./coded.js";
import type { Use } from "@cloudcrane/app-spec/uses";
import { GAME_KIT } from "./kit.js";

// A coded component runs in a sandboxed frame and talks to the page only by
// messages. The page keeps what comes back to what the spec declared; the kit
// in the frame turns the page's clock into fixed steps, so a game moves the
// same way for the same time and seed, in a test or on a phone.

const over = { kind: "coded" as const, kit: "game" as const, inputs: {}, events: { over: { score: "number" as const, name: "string" as const } }, code: "x" };
const page = {
  kind: "coded" as const,
  kit: "page" as const,
  inputs: {},
  events: {},
  code: '<main id="n"></main><script>document.getElementById("n").textContent=localStorage.getItem("note")</script>',
};

describe("what the page takes from a coded component", () => {
  it("takes a declared event's declared fields of the right type, and nothing else", () => {
    expect(cleanEvent(over, "over", { score: 7, name: "Ana", extra: 1 })).toEqual({ score: 7, name: "Ana" });
    expect(cleanEvent(over, "over", { score: "7", name: 3 })).toEqual({});
    expect(cleanEvent(over, "over", { score: Infinity })).toEqual({});
    expect(cleanEvent(over, "won", { score: 7 })).toBeNull();
    expect(cleanEvent(over, "over", "7")).toEqual({});
    expect(cleanEvent(over, "__proto__", {})).toBeNull();
  });

  it("takes a state that's a small JSON object, and nothing bigger", () => {
    expect(cleanState({ score: 3, snake: [[1, 2]] })).toEqual({ score: 3, snake: [[1, 2]] });
    expect(cleanState(null)).toBeNull();
    expect(cleanState([1, 2])).toBeNull();
    expect(cleanState({ big: "x".repeat(20_000) })).toBeNull();
  });

  it("builds a page kit's frame: the bridge first, then the page as written, with what it saved escaped so it can't end a script", () => {
    const html = frameHtml(page, { note: "</script><script>alert(1)" });
    expect(html.indexOf(page.code)).toBeGreaterThan(html.indexOf("__ccBus"));
    expect(html).not.toContain("</script><script>alert(1)");
    expect(html).not.toContain(GAME_KIT);
  });

  it("builds the frame's page: the kit, then the component's code, each in its own script", () => {
    const html = frameHtml({ ...over, code: "game.start({});" }, {});
    expect(html.indexOf(GAME_KIT)).toBeGreaterThan(html.indexOf("__ccBus"));
    expect(html.indexOf("game.start({});")).toBeGreaterThan(html.indexOf(GAME_KIT));
    expect(html).toContain("<canvas");
  });
});

/** The kit in a stand-in frame: a canvas that records nothing, a window that takes the port, and a port that records. */
function kitFrame() {
  const sent: unknown[] = [];
  const listeners: Record<string, ((e: unknown) => void)[]> = {};
  const port = { onmessage: null as null | ((e: { data: unknown }) => void), postMessage: (m: unknown) => sent.push(JSON.parse(JSON.stringify(m))) };
  const g = { setTransform() {}, clearRect() {}, fillRect() {} };
  const canvas = { clientWidth: 300, clientHeight: 300, width: 0, height: 0, getContext: () => g, addEventListener() {} };
  const ctx: Record<string, unknown> = {
    document: { querySelector: () => canvas },
    devicePixelRatio: 2,
    addEventListener: (t: string, f: (e: unknown) => void) => (listeners[t] ??= []).push(f),
    JSON,
    Math,
  };
  ctx["window"] = ctx;
  runInNewContext(bridgeScript({}), ctx);
  runInNewContext(GAME_KIT, ctx);
  const game = ctx["game"] as {
    start(o: unknown): void;
    emit(n: string, d: unknown): void;
    random(): number;
    state: unknown;
    inputs: Record<string, unknown>;
    on(n: string, f: (...a: unknown[]) => void): void;
  };
  return {
    game,
    sent,
    connect: () => listeners["message"]!.forEach((f) => f({ data: "cc-port", ports: [port] })),
    page: (m: unknown) => port.onmessage!({ data: m }),
  };
}

describe("the storage bridge", () => {
  function bridged(stored: Record<string, string>) {
    const sent: unknown[] = [];
    const listeners: ((e: unknown) => void)[] = [];
    const ctx: Record<string, unknown> = { addEventListener: (_t: string, f: (e: unknown) => void) => listeners.push(f), JSON, Object, String };
    ctx["window"] = ctx;
    runInNewContext(bridgeScript(stored), ctx);
    const port = { onmessage: null, postMessage: (m: unknown) => sent.push(m) };
    return { store: ctx["localStorage"] as Storage, sent, connect: () => listeners.forEach((f) => f({ data: "cc-port", ports: [port] })) };
  }

  it("gives the frame a localStorage holding what it saved, and sends each change to the page once the port arrives", () => {
    const b = bridged({ note: "Buy milk", "</script>": "x" });
    expect(b.store.getItem("note")).toBe("Buy milk");
    expect(b.store.getItem("nothing")).toBeNull();
    expect(b.store.length).toBe(2);
    b.store.setItem("note", "Buy bread");
    b.store.setItem("count", 3 as unknown as string);
    b.store.removeItem("</script>");
    expect(b.sent).toEqual([]);
    b.connect();
    expect(b.sent).toEqual([{ store: { set: ["note", "Buy bread"] } }, { store: { set: ["count", "3"] } }, { store: { remove: "</script>" } }]);
    expect(b.store.getItem("count")).toBe("3");
    b.store.clear();
    expect(b.store.length).toBe(0);
    expect(b.sent.at(-1)).toEqual({ store: { clear: true } });
  });

  it("keeps on the page only well-formed changes, within the space a phone gives", () => {
    const kept = { a: "1" };
    expect(storeMessage(kept, { set: ["b", "2"] })).toEqual({ a: "1", b: "2" });
    expect(storeMessage(kept, { remove: "a" })).toEqual({});
    expect(storeMessage(kept, { clear: true })).toEqual({});
    expect(storeMessage(kept, { set: ["b", 2] })).toBeNull();
    expect(storeMessage(kept, { set: ["big", "x".repeat(5 * 1024 * 1024)] })).toBeNull();
    expect(storeMessage(kept, "nonsense")).toBeNull();
  });
});

describe("the game kit", () => {
  it("holds what the game sends until the page's port arrives, then sends it in order", () => {
    const f = kitFrame();
    f.game.emit("over", { score: 1 });
    expect(f.sent).toEqual([]);
    f.connect();
    expect(f.sent).toEqual([{ emit: { name: "over", data: { score: 1 } } }]);
  });

  it("sets the game up once the page has given its seed and inputs, then steps it at its rate by the page's clock", () => {
    const f = kitFrame();
    let steps = 0;
    const seen: unknown[] = [];
    f.game.start({ rate: 10, setup: () => seen.push(f.game.inputs["best"]), step: () => steps++ });
    f.connect();
    expect(seen).toEqual([]);
    f.page({ init: { seed: 42, inputs: { best: 5 } } });
    expect(seen).toEqual([5]);
    f.page({ tick: 1000 });
    expect(steps).toBe(10);
    f.page({ tick: 50 });
    f.page({ tick: 50 });
    expect(steps).toBe(11);
    // Hidden, it doesn't move.
    f.page({ visible: false });
    f.page({ tick: 1000 });
    expect(steps).toBe(11);
  });

  it("draws once as soon as it's set up, before the first tick", () => {
    const f = kitFrame();
    let draws = 0;
    f.game.start({ setup: () => {}, draw: () => draws++ });
    f.connect();
    f.page({ init: { seed: 1, inputs: {} } });
    expect(draws).toBe(1);
    f.page({ tick: 16 });
    expect(draws).toBe(2);
  });

  it("gives the same random numbers for the same seed", () => {
    const run = (seed: number) => {
      const f = kitFrame();
      const out: number[] = [];
      f.game.start({ setup: () => out.push(f.game.random(), f.game.random()) });
      f.connect();
      f.page({ init: { seed, inputs: {} } });
      return out;
    };
    expect(run(7)).toEqual(run(7));
    expect(run(7)).not.toEqual(run(8));
    expect(run(7).every((n) => n >= 0 && n < 1)).toBe(true);
  });

  it("reports its state to the page when it changes, and passes on new inputs", () => {
    const f = kitFrame();
    const heard: unknown[] = [];
    f.game.on("input", (n, v) => heard.push([n, v]));
    f.game.start({ rate: 10, step: () => (f.game.state = { score: 1 }) });
    f.connect();
    f.page({ init: { seed: 1, inputs: {} } });
    f.page({ tick: 100 });
    f.page({ tick: 100 });
    expect(f.sent).toEqual([{ state: { score: 1 } }]);
    f.page({ input: { name: "dir", value: "up" } });
    expect(heard).toEqual([["dir", "up"]]);
    expect(f.game.inputs["dir"]).toBe("up");
  });
});

describe("what a component's frame may use", () => {
  const uses = (...what: Use[]) => what.map((w) => ({ what: w, why: "x" }));
  it("allows the browser features of the device features the spec declares, and no others", () => {
    expect(frameOptions(over, [])).toEqual({ allow: "", sameOrigin: false });
    expect(frameOptions(over, uses("location", "motion"))).toEqual({ allow: "geolocation; accelerometer; gyroscope; magnetometer", sameOrigin: false });
    // A feature two declared uses need (the microphone, for microphone and voice) is named once.
    expect(frameOptions(page, uses("microphone", "voice")).allow).toBe("microphone");
    expect(frameOptions(page, uses("contacts", "nfc")).allow).toBe("");
  });

  it("gives a page kit the page's origin only when the spec declares the camera or microphone, which a frame with none can't use", () => {
    expect(frameOptions(page, uses("location"))).toMatchObject({ sameOrigin: false });
    expect(frameOptions(page, uses("camera"))).toEqual({ allow: "camera", sameOrigin: true });
    expect(frameOptions(page, uses("microphone"))).toMatchObject({ sameOrigin: true });
    // A game kit never: it stays apart from the page whatever the spec says.
    expect(frameOptions(over, uses("camera"))).toMatchObject({ sameOrigin: false });
  });
});
