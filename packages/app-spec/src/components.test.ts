import { describe, expect, it } from "vitest";
import { CLOUDCRANE_CATALOG_ID } from "./catalog.js";
import { sampleSpec } from "./fixtures.js";
import { leakProblems } from "./leak.js";
import { validateSpec } from "./validate.js";

// A coded component: what the catalog's components can't draw (a game on a
// canvas), as the spec's own code, run sandboxed in a frame. It declares what
// it's given (inputs) and what it may say (events); a screen places it with the
// Coded component, binding each input to the data model and each event to an
// action. Its code is code by design, so the leak scan's code rules skip it,
// but nothing else does.

const GAME = `game.start({ rate: 10, step: function () { game.state = { score: 1 }; }, draw: function (g, w, h) { g.fillRect(0, 0, w, h); } });`;

function codedSpec() {
  const s = sampleSpec();
  s.surface.catalog = CLOUDCRANE_CATALOG_ID;
  const [create, update] = s.surface.messages as [{ createSurface: { catalogId: string } }, { updateComponents: { components: Record<string, unknown>[] } }];
  create.createSurface.catalogId = CLOUDCRANE_CATALOG_ID;
  update.updateComponents.components = [
    { id: "root", component: "Column", children: ["title", "board"] },
    { id: "title", component: "Text", text: "Snake", variant: "h1" },
    {
      id: "board",
      component: "Coded",
      use: "snake",
      label: "The snake game",
      aspect: 1,
      inputs: [{ name: "best", value: { path: "/saved/best" } }],
      on: [{ name: "over", action: { functionCall: { call: "set", args: { path: "/saved/best", value: { path: "/ui/coded/board/over/score" } } } } }],
    },
  ];
  (s as { components?: unknown }).components = {
    snake: { kind: "coded", kit: "game", inputs: { best: "number" }, events: { over: { score: "number" } }, code: GAME },
  };
  return s;
}

const problemsOf = (change: (s: ReturnType<typeof codedSpec>) => void = () => {}) => {
  const s = codedSpec();
  change(s);
  return validateSpec(s)
    .problems.map((p) => `${p.at}: ${p.problem}`)
    .join("\n");
};
const board = (s: ReturnType<typeof codedSpec>) =>
  (s.surface.messages[1] as { updateComponents: { components: Record<string, unknown>[] } }).updateComponents.components[2]!;
const snake = (s: ReturnType<typeof codedSpec>) => (s as unknown as { components: { snake: Record<string, unknown> } }).components.snake;

describe("coded components", () => {
  it("accepts a coded component placed on a screen, its inputs bound and its events given actions", () => {
    expect(problemsOf()).toBe("");
  });

  it("refuses a placement of a component the spec doesn't define, or of an input or event it doesn't declare", () => {
    expect(problemsOf((s) => (board(s)["use"] = "tetris"))).toMatch(/board.*no coded component "tetris"/);
    expect(problemsOf((s) => ((board(s)["inputs"] as { name: string }[])[0]!.name = "lives"))).toMatch(/board.*snake declares no input "lives"/);
    expect(problemsOf((s) => ((board(s)["on"] as { name: string }[])[0]!.name = "won"))).toMatch(/board.*snake declares no event "won"/);
  });

  it("holds a component to its shape: a known kit, typed inputs and event fields, code that can't end its own script", () => {
    expect(problemsOf((s) => (snake(s)["kit"] = "physics"))).toMatch(/components\.snake\.kit/);
    expect(problemsOf((s) => (snake(s)["inputs"] = { best: "integer" }))).toMatch(/components\.snake\.inputs\.best/);
    expect(problemsOf((s) => (snake(s)["events"] = { over: { score: "float" } }))).toMatch(/components\.snake\.events\.over\.score/);
    expect(problemsOf((s) => (snake(s)["code"] = `game.start({}); </SCRIPT ><script>alert(1)</script>`))).toMatch(/components\.snake\.code.*<\/script>/);
    expect(problemsOf((s) => (snake(s)["extra"] = 1))).toMatch(/components\.snake/);
  });

  it("refuses a component no screen places", () => {
    expect(problemsOf((s) => (board(s)["use"] = "snake2"))).toMatch(/no coded component "snake2"/);
    expect(
      problemsOf((s) => {
        (s as unknown as { components: Record<string, unknown> }).components["pong"] = { ...snake(s) };
      }),
    ).toMatch(/components\.pong: no screen places it/);
  });

  it("skips the code rules for a component's code, but still finds secrets, personal details and internal hosts in it", () => {
    const leaks = (code: string) => {
      const s = codedSpec();
      snake(s)["code"] = code;
      return leakProblems(s).map((p) => `${p.at}: ${p.problem}`);
    };
    expect(leaks(GAME)).toEqual([]);
    expect(leaks(`${GAME} var who = "ana@example.com";`)).toEqual(["/components/snake/code: looks like an email address (personal)"]);
    expect(leaks(`${GAME} fetch("http://localhost:8080/x");`)).toEqual(["/components/snake/code: looks like an internal address (host)"]);
    expect(leaks(`${GAME} var key = "AKIAABCDEFGHIJKLMNOP";`)).toEqual(["/components/snake/code: looks like an AWS access key (secret)"]);
    // Anywhere else, code is still refused.
    const s = codedSpec();
    s.module.purpose = "var x = function () { return 1; };";
    expect(leakProblems(s).map((p) => p.at)).toContain("/module/purpose");
  });
});
