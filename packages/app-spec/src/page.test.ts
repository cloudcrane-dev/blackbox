import { describe, expect, it } from "vitest";
import { pageOf, wrapPage, type PageApp } from "./page.js";
import { leakProblems } from "./leak.js";
import { validateSpec } from "./validate.js";

// An app written as one HTML page, as a spec: the page is its one page-kit
// component, shown full screen and nothing else. Such a spec is the page: the
// compiler gives back the HTML as written, so the app runs, saves and is
// tested exactly as it would on its own, and every app has a spec.

const HTML = `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><main>Hi</main><script>localStorage.setItem("x","1")</script></body></html>`;
const app = (over: Partial<PageApp> = {}): PageApp => ({
  id: "tip-split",
  name: "Tip split",
  purpose: "Splits a bill and the tip between friends.",
  html: HTML,
  generator: "cloudcrane, from an HTML app",
  data: { version: 1, key: "tip-split" },
  journeys: [{ id: "J-1", title: "Split a bill", steps: [{ id: "J-1.1", text: "Enter the total and see each share" }] }],
  ...over,
});

describe("an HTML app as a spec", () => {
  it("wraps the page into a valid spec whose one component is the page, and finds the page in it again", () => {
    const { spec, problems } = validateSpec(wrapPage(app()));
    expect(problems).toEqual([]);
    expect(spec!.components).toEqual({ page: { kind: "coded", kit: "page", inputs: {}, events: {}, code: HTML } });
    expect(pageOf(spec!)).toBe(HTML);
  });

  it("keeps what the app declares: sites, device features, promises, tests and its listing", () => {
    const wrapped = wrapPage(
      app({
        network: [{ site: "api.open-meteo.com", why: "The forecast" }],
        uses: [{ what: "camera", why: "To scan a receipt" }],
        promises: [{ id: "P-1", text: "What you entered survives an update", kind: "data" }],
        tests: [{ id: "T-1", title: "Opens", proves: ["J-1.1"], steps: [{ see: "Hi" }] }],
        icon: "calculator",
        category: "money",
        tags: ["bills"],
      }),
    );
    const { spec, problems } = validateSpec(wrapped);
    expect(problems).toEqual([]);
    expect(spec).toMatchObject({
      network: [{ site: "api.open-meteo.com" }],
      uses: [{ what: "camera" }],
      promises: [{ id: "P-1" }],
      tests: [{ id: "T-1" }],
      module: { icon: "calculator", category: "money", tags: ["bills"] },
      data: { version: 1, key: "tip-split" },
    });
  });

  it("is the page only when it says so, and then holds nothing but the page", () => {
    const problemsOf = (change: (s: Record<string, unknown> & { components: Record<string, Record<string, unknown>> }) => void) => {
      const s = wrapPage(app()) as unknown as Record<string, unknown> & { components: Record<string, Record<string, unknown>> };
      change(s);
      return validateSpec(s)
        .problems.map((p) => `${p.at}: ${p.problem}`)
        .join("\n");
    };
    // The same shape without page: it runs in a frame like any page kit.
    const framed = validateSpec({ ...wrapPage(app()), page: undefined }).spec!;
    expect(pageOf(framed)).toBeNull();
    expect(problemsOf((s) => (s["page"] = "other"))).toMatch(/page: names no page-kit component/);
    expect(problemsOf((s) => ((s.components["page"]!["kit"] = "game"), (s.components["page"]!["code"] = "game.start({})")))).toMatch(
      /page: names no page-kit component/,
    );
    expect(
      problemsOf((s) => {
        const update = (s["surface"] as { messages: { updateComponents?: { components: unknown[] } }[] }).messages[1]!.updateComponents!;
        update.components.push({ id: "title", component: "Text", text: "Hi" });
      }),
    ).toMatch(/page: the screen can hold nothing but the page/);
    expect(problemsOf((s) => ((s["logic"] as { computed: Record<string, string> }).computed["/ui/x"] = "1"))).toMatch(/page: .*no logic/);
  });

  it("still finds personal details and secrets in the page", () => {
    const { problems } = validateSpec(wrapPage(app({ html: HTML.replace("Hi", "ana@example.com") })));
    expect(problems).toEqual([{ at: "/components/page/code", problem: "looks like an email address (personal)" }]);
    expect(leakProblems(validateSpec(wrapPage(app())).spec!)).toEqual([]);
  });
});
