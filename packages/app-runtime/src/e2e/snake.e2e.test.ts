import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { chromium, type Browser, type Page } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { compile, runtimeFile } from "../compiler/compile.js";

// The coded-component example (Snake), compiled, in a real browser under
// CloudCrane's security policy: the game runs in its sandboxed frame by the
// page's clock, the screen's buttons steer it, what it reports shows on the
// screen, the end of a game saves the best score through the spec's own rule,
// and the frame is out of the page's reach. Skipped where there's no Chrome.

const ROOT = new URL("../../../../", import.meta.url);
const read = (p: string) => readFileSync(new URL(p, ROOT), "utf8");
const CHROME = process.env["CHROME_PATH"] ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const hasChrome = (() => {
  try {
    readFileSync(CHROME);
    return true;
  } catch {
    return false;
  }
})();

const compiled = compile(JSON.parse(read("fixtures/snake/spec.json"))).html;
const axe = readFileSync(createRequire(import.meta.url).resolve("axe-core/axe.min.js"), "utf8");
const CSP =
  "default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; manifest-src 'self'; worker-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'";

let browser: Browser;
beforeAll(async () => {
  if (hasChrome) browser = await chromium.launch({ executablePath: CHROME, headless: true });
}, 60_000);
afterAll(async () => browser?.close());

type Game = { score: number; alive: boolean; dir: string; games: number; length: number };
type Data = { saved: { best: number }; ui: { coded: { board: { state: Game } } } };

async function open(saved?: { best: number }, colorScheme: "light" | "dark" = "light"): Promise<Page & { errors: string[] }> {
  const page = (await browser.newPage({ viewport: { width: 390, height: 844 }, colorScheme })) as Page & { errors: string[] };
  await page.route("http://snake.test/**", (r) => r.fulfill({ contentType: "text/html", body: compiled, headers: { "content-security-policy": CSP } }));
  // Init scripts run in every frame; the game's, sandboxed, has no storage to seed.
  if (saved) await page.addInitScript((s) => window === window.top && localStorage.setItem("snake.best", JSON.stringify({ v: 1, ...s })), saved);
  page.errors = [];
  page.on("pageerror", (e) => page.errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && page.errors.push(m.text()));
  await page.goto("http://snake.test/");
  await page.waitForFunction(() => typeof (window as { appState?: unknown }).appState === "function");
  return page;
}
const data = (page: Page) => page.evaluate(() => (window as unknown as { appState: () => { data: Data } }).appState().data);
const game = async (page: Page) => (await data(page)).ui.coded.board.state;

describe.skipIf(!hasChrome)("Snake, compiled, in Chrome", { timeout: 60_000 }, () => {
  it("runs by the page's clock: eats the food ahead, ends at the wall, and keeps the best score through a reload", async () => {
    const page = await open();
    await expect.poll(async () => (await game(page)).games).toBe(1);
    // Heading right from the left, the first food is straight ahead; the wall comes after it.
    await expect.poll(async () => (await game(page)).alive, { timeout: 10_000 }).toBe(false);
    const ended = await game(page);
    expect(ended.score).toBeGreaterThanOrEqual(1);
    // A shared CI machine runs the browser tests side by side: give what follows the game's end the same 5 s as the rest.
    const soon = { timeout: 5_000 };
    await expect.poll(async () => (await data(page)).saved.best, soon).toBe(ended.score);
    await expect.poll(() => page.evaluate(() => localStorage.getItem("snake.best")), soon).toContain(`"best":${ended.score}`);
    // What the game reports shows on the screen.
    await expect.poll(() => page.locator("#app").innerText(), soon).toMatch(new RegExp(`Score\\s+${ended.score}\\s+Best\\s+${ended.score}`));

    await page.reload();
    await page.waitForFunction(() => typeof (window as { appState?: unknown }).appState === "function");
    expect((await data(page)).saved.best).toBe(ended.score);
    expect(page.errors).toEqual([]);
    await page.close();
  });

  it("is steered and restarted by the screen's buttons, and a worse game leaves the best alone", async () => {
    const page = await open({ best: 50 });
    await expect.poll(async () => (await game(page)).games).toBe(1);
    await page.getByRole("button", { name: "Down" }).click();
    await expect.poll(async () => (await game(page)).dir).toBe("down");
    // Down from the middle row hits the bottom wall before any food.
    await expect.poll(async () => (await game(page)).alive, { timeout: 10_000 }).toBe(false);
    await page.getByRole("button", { name: "New game" }).click();
    await expect.poll(async () => (await game(page)).games).toBe(2);
    expect((await game(page)).alive).toBe(true);
    expect((await data(page)).saved.best).toBe(50);
    expect(page.errors).toEqual([]);
    await page.close();
  });

  it("runs as a shared page, with the runtime served beside it, and refuses a runtime that isn't the one it names", async () => {
    const shared = compile(JSON.parse(read("fixtures/snake/spec.json")), { runtime: "shared" }).html;
    const served = async (runtime: string) => {
      const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
      await page.route("http://snake.test/**", (r) =>
        r.request().url().endsWith(runtimeFile().path)
          ? r.fulfill({ contentType: "text/javascript", body: runtime, headers: { "content-security-policy": CSP } })
          : r.fulfill({ contentType: "text/html", body: shared, headers: { "content-security-policy": CSP } }),
      );
      await page.goto("http://snake.test/");
      return page;
    };
    const page = await served(runtimeFile().js);
    await page.waitForFunction(() => typeof (window as { appState?: unknown }).appState === "function");
    await expect.poll(async () => (await game(page)).games).toBe(1);
    await page.close();

    const tampered = await served(runtimeFile().js.replace("Coded", "Codex"));
    await tampered.waitForTimeout(1000);
    expect(await tampered.evaluate(() => typeof (window as { appState?: unknown }).appState)).toBe("undefined");
    await tampered.close();
  });

  it("keeps the frame sandboxed and out of the page's reach, and has no serious accessibility faults, on a phone set to dark mode too", async () => {
    // The spec draws a light page; A2UI's defaults (a plain button's text) must follow the page, not the phone's setting.
    const page = await open(undefined, "dark");
    await expect.poll(async () => (await game(page)).games).toBe(1);
    const seen = await page.evaluate(() => {
      const board = document.querySelector(".cc-coded")!;
      return {
        frames: document.querySelectorAll("iframe").length,
        shadow: (board.firstElementChild as HTMLElement).shadowRoot,
        label: board.getAttribute("aria-label"),
      };
    });
    expect(seen).toEqual({ frames: 0, shadow: null, label: "Snake board: swipe or use the arrows to steer" });
    // The frame's own origin is opaque: whatever it is, it isn't the page's.
    const origins = page.frames().map((f) => f.url());
    expect(origins.filter((u) => u.startsWith("http://snake.test"))).toEqual(["http://snake.test/"]);
    await page.addScriptTag({ content: axe });
    const found = await page.evaluate(async () => {
      const r = await (window as unknown as { axe: { run: () => Promise<{ violations: { id: string; impact: string }[] }> } }).axe.run();
      return r.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => v.id);
    });
    expect(found).toEqual([]);
    await page.close();
  });
});
