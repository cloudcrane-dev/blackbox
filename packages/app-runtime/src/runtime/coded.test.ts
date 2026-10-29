import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { cleanEvent, cleanState, frameHtml } from "./coded.js";
import { GAME_KIT } from "./kit.js";

// A coded component runs in a sandboxed frame and talks to the page only by
// messages. The page keeps what comes back to what the spec declared; the kit
// in the frame turns the page's clock into fixed steps, so a game moves the
// same way for the same time and seed, in a test or on a phone.

const over = { kind: "coded" as const, kit: "game" as const, inputs: {}, events: { over: { score: "number" as const, name: "string" as const } }, code: "x" };

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

  it("builds the frame's page: the kit, then the component's code, each in its own script", () => {
    const html = frameHtml("game.start({});");
    expect(html.indexOf(GAME_KIT)).toBeGreaterThan(0);
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
