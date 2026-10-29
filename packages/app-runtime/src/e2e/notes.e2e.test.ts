import { readFileSync } from "node:fs";
import { chromium, type Browser, type Page } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { compile } from "../compiler/compile.js";

// An app written as plain HTML, as one page-kit coded component (Notes): it
// runs full screen in its sandboxed frame and saves with localStorage as it
// would on a page of its own, while what it saves is kept on the page, under
// the component's key, so it survives a reload and an update. Skipped where
// there's no Chrome.

const ROOT = new URL("../../../../", import.meta.url);
const CHROME = process.env["CHROME_PATH"] ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const hasChrome = (() => {
  try {
    readFileSync(CHROME);
    return true;
  } catch {
    return false;
  }
})();
const compiled = compile(JSON.parse(readFileSync(new URL("fixtures/notes/spec.json", ROOT), "utf8"))).html;
const CSP =
  "default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; manifest-src 'self'; worker-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'";

let browser: Browser;
beforeAll(async () => {
  if (hasChrome) browser = await chromium.launch({ executablePath: CHROME, headless: true });
}, 60_000);
afterAll(async () => browser?.close());

describe.skipIf(!hasChrome)("an HTML app as a page-kit component, in Chrome", { timeout: 60_000 }, () => {
  it("saves with localStorage through the page, and what it saved survives a reload", async () => {
    const page: Page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await page.route("http://notes.test/**", (r) => r.fulfill({ contentType: "text/html", body: compiled, headers: { "content-security-policy": CSP } }));
    // Something else the page keeps, which the frame must never see.
    await page.addInitScript(() => window === window.top && localStorage.setItem("someone.else", "private"));
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto("http://notes.test/");
    // The frame sits in a closed shadow root, out of a locator's reach: take it from the page's frames.
    const frame = async () => {
      await expect.poll(() => page.frames().length, { timeout: 5_000 }).toBe(2);
      return page.frames()[1]!;
    };
    const app = await frame();
    await app.getByLabel("New note").fill("Buy milk");
    await app.getByRole("button", { name: "Save note" }).click();
    await expect.poll(() => app.getByRole("listitem").allTextContents(), { timeout: 5_000 }).toEqual(["Buy milk"]);
    await expect
      .poll(() => page.evaluate(() => localStorage.getItem("notes.app.coded.notes")), { timeout: 5_000 })
      .toBe(JSON.stringify({ notes: '["Buy milk"]' }));

    await page.reload();
    const again = await frame();
    await expect.poll(() => again.getByRole("listitem").allTextContents(), { timeout: 5_000 }).toEqual(["Buy milk"]);
    // The frame sees only what it saved.
    const seen = await again.evaluate(() => [localStorage.length, localStorage.getItem("someone.else")]);
    expect(seen).toEqual([1, null]);
    expect(errors).toEqual([]);
    await page.close();
  });
});
