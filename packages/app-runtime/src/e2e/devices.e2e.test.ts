import { readFileSync } from "node:fs";
import { chromium, type Browser, type Frame, type Page } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { compile } from "../compiler/compile.js";

// Device features inside a coded component's frame, in Chrome with a fake
// camera: the frame is allowed what the spec declares and nothing else, and a
// page kit whose spec declares the camera gets the page's origin, which
// Chrome needs to give a frame the camera, while its localStorage still goes
// through the page. Skipped where there's no Chrome.

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

// Says what it could reach, on the screen and in localStorage.
const CODE = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head><body>
<p id="location">…</p><p id="camera">…</p>
<script>
var show = function (id, text) { document.getElementById(id).textContent = id + ": " + text; localStorage.setItem(id, text); };
navigator.geolocation.getCurrentPosition(function (p) { show("location", "at " + p.coords.latitude); }, function (e) { show("location", "refused " + e.code); });
navigator.mediaDevices.getUserMedia({ video: true }).then(function (s) { show("camera", "on " + s.getVideoTracks().length); }, function (e) { show("camera", "refused " + e.name); });
</script></body></html>`;

const spec = (uses: { what: string; why: string }[], kit: "page" | "game" = "page") => {
  const s = JSON.parse(readFileSync(new URL("fixtures/notes/spec.json", ROOT), "utf8")) as Record<string, unknown> & {
    components: Record<string, Record<string, unknown>>;
  };
  s.uses = uses;
  s.components["notes"]!["code"] = CODE;
  s.components["notes"]!["kit"] = kit;
  return s;
};
const CSP =
  "default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; manifest-src 'self'; worker-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'";
// What CloudCrane sends for these: a declared feature for any frame of the page (it can have only the one), the rest for none.
const policy = (declared: string[]) => ["camera", "microphone", "geolocation"].map((f) => `${f}=${declared.includes(f) ? "*" : "()"}`).join(", ");

let browser: Browser;
beforeAll(async () => {
  if (hasChrome)
    browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"] });
}, 60_000);
afterAll(async () => browser?.close());

async function open(s: unknown, declared: string[]): Promise<{ page: Page; frame: Frame }> {
  const ctx = await browser.newContext({ permissions: ["camera", "geolocation"], geolocation: { latitude: 12.5, longitude: 77.5 } });
  const page = await ctx.newPage();
  const html = compile(s).html;
  await page.route("https://devices.test/**", (r) =>
    r.fulfill({ contentType: "text/html", body: html, headers: { "content-security-policy": CSP, "permissions-policy": policy(declared) } }),
  );
  await page.goto("https://devices.test/");
  await expect.poll(() => page.frames().length, { timeout: 5_000 }).toBe(2);
  return { page, frame: page.frames()[1]! };
}
const said = (frame: Frame, id: string) => frame.locator(`#${id}`).innerText();

describe.skipIf(!hasChrome)("device features in a coded component's frame, in Chrome", { timeout: 60_000 }, () => {
  it("gives a page kit the location and the camera its spec declares, and keeps its storage on the page", async () => {
    const { page, frame } = await open(
      spec([
        { what: "location", why: "To show where you are" },
        { what: "camera", why: "To take a picture" },
      ]),
      ["geolocation", "camera"],
    );
    await expect.poll(() => said(frame, "location"), { timeout: 5_000 }).toBe("location: at 12.5");
    await expect.poll(() => said(frame, "camera"), { timeout: 5_000 }).toBe("camera: on 1");
    await expect
      .poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("notes.app.coded.notes") ?? "{}")), { timeout: 5_000 })
      .toEqual({ location: "at 12.5", camera: "on 1" });
    await page.context().close();
  });

  it("refuses what the spec doesn't declare, and keeps a frame without the camera apart from the page", async () => {
    const { page, frame } = await open(spec([{ what: "location", why: "To show where you are" }]), ["geolocation"]);
    await expect.poll(() => said(frame, "location"), { timeout: 5_000 }).toBe("location: at 12.5");
    await expect.poll(() => said(frame, "camera"), { timeout: 5_000 }).toMatch(/^camera: refused/);
    expect(await frame.evaluate(() => origin)).toBe("null");
    await page.context().close();
  });

  it("gives nothing to a spec that declares nothing", async () => {
    const { page, frame } = await open(spec([]), []);
    await expect.poll(() => said(frame, "location"), { timeout: 5_000 }).toBe("location: refused 1");
    await expect.poll(() => said(frame, "camera"), { timeout: 5_000 }).toMatch(/^camera: refused/);
    await page.context().close();
  });
});
