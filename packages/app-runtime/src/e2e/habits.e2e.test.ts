import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { chromium, type Browser, type Page } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { compile } from "../compiler/compile.js";

// The example app (Daily Habits), compiled, in a real browser (the Chrome on
// this machine, or CHROME_PATH), under CloudCrane's security policy: its
// journeys, the eight streak cases worked out by hand, data that survives a
// reload, and no serious accessibility faults. Skipped where there's no Chrome.

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

const compiled = compile(JSON.parse(read("fixtures/habits/spec.json"))).html;
const cases = JSON.parse(read("fixtures/habits/cases.json")).cases as {
  id: string;
  today: string;
  checkins: string[];
  partial?: string[];
  best?: number;
  expect: unknown;
}[];
const axe = readFileSync(createRequire(import.meta.url).resolve("axe-core/axe.min.js"), "utf8");

const CSP =
  "default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; manifest-src 'self'; worker-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'";

let browser: Browser;
beforeAll(async () => {
  if (hasChrome) browser = await chromium.launch({ executablePath: CHROME, headless: true });
}, 60_000);
afterAll(async () => browser?.close());

type Day = { name: string; done: boolean };

/** A page serving `html` at an origin of its own, with today fixed and saved data in place. */
async function open(html: string, today: string, saved?: { days: Record<string, Day[]>; best: number }): Promise<Page> {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.clock.setFixedTime(new Date(`${today}T12:00:00`));
  // Served under CloudCrane's apps-host policy (as blackbox preview does): no eval, nothing from other sites.
  await page.route("http://habits.test/**", (r) => r.fulfill({ contentType: "text/html", body: html, headers: { "content-security-policy": CSP } }));
  if (saved) await page.addInitScript((s) => localStorage.setItem("habits.days", JSON.stringify({ v: 1, ...s })), saved);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  await page.goto("http://habits.test/");
  await page.waitForFunction(() => typeof (window as { appState?: unknown }).appState === "function");
  (page as Page & { errors: string[] }).errors = errors;
  return page;
}

const historyOf = (c: (typeof cases)[number]) => {
  const days: Record<string, Day[]> = {};
  for (const d of c.checkins)
    days[d] = [
      { name: "Read", done: true },
      { name: "Walk", done: true },
    ];
  for (const d of c.partial ?? [])
    days[d] = [
      { name: "Read", done: true },
      { name: "Walk", done: false },
    ];
  return { days, best: c.best ?? 0 };
};
const streakIn = (page: Page) =>
  page.evaluate(() => (window as unknown as { appState: () => { data: { computed: { streak: unknown } } } }).appState().data.computed.streak);

describe.skipIf(!hasChrome)("Daily Habits, compiled, in Chrome", () => {
  it("gives the eight streak cases worked out by hand", async () => {
    for (const c of cases) {
      const page = await open(compiled, c.today, historyOf(c));
      expect(await streakIn(page), c.id).toEqual(c.expect);
      await page.close();
    }
  });

  it("adds, ticks, removes and keeps habits across a reload; past days are read-only", async () => {
    const page = await open(compiled, "2026-10-27");
    await page.getByRole("textbox", { name: "Habit", exact: true }).fill("Read");
    await page.getByRole("button", { name: "+ Add habit" }).click();
    await page.getByRole("textbox", { name: "Habit", exact: true }).fill("Stretch");
    await page.getByRole("button", { name: "+ Add habit" }).click();
    await expect.poll(() => page.evaluate(() => localStorage.getItem("habits.days"))).toContain("Stretch");

    const state = () =>
      page.evaluate(
        () =>
          (
            window as unknown as { appState: () => { data: { saved: { days: Record<string, Day[]> }; computed: { dayStatus: { status: string }[] } } } }
          ).appState().data,
      );
    await page.getByRole("checkbox", { name: "Read" }).check();
    await page.getByRole("checkbox", { name: "Stretch" }).check();
    await expect.poll(async () => (await state()).computed.dayStatus.at(-1)!.status).toBe("complete");

    await page.getByRole("button", { name: "Remove this habit" }).first().click();
    await expect.poll(async () => (await state()).saved.days["2026-10-27"]!.map((e) => e.name)).toEqual(["Stretch"]);

    await page.reload();
    await page.waitForFunction(() => typeof (window as { appState?: unknown }).appState === "function");
    expect((await state()).saved.days["2026-10-27"]).toEqual([{ done: true, name: "Stretch" }]);

    await page.getByRole("button", { name: /Mon 26 October/ }).click();
    await expect.poll(() => page.getByRole("checkbox").count()).toBe(0);
    await expect.poll(() => page.getByRole("textbox", { name: "Habit", exact: true }).count()).toBe(0);
    expect((page as Page & { errors: string[] }).errors).toEqual([]);
    await page.close();
  });

  it("has no serious or critical accessibility faults", async () => {
    const page = await open(compiled, "2026-10-27", historyOf(cases[1]!));
    await page.addScriptTag({ content: axe });
    const found = await page.evaluate(async () => {
      const r = await (window as unknown as { axe: { run: () => Promise<{ violations: { id: string; impact: string }[] }> } }).axe.run();
      return r.violations
        .filter((v) => v.impact === "serious" || v.impact === "critical")
        .map(
          (v) =>
            `${v.id}: ${(v as unknown as { nodes: { target: string[]; failureSummary: string }[] }).nodes.map((n) => `${n.target.join(" ")} (${n.failureSummary.split("\n").slice(-1)[0]})`).join("; ")}`,
        );
    });
    expect(found).toEqual([]);
    await page.close();
  });
});
