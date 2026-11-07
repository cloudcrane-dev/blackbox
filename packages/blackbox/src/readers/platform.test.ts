import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { androidColors, cssColor, cssVars, iosColorset, byRole } from "./colors.js";
import { declaredIn, mergeDeclared } from "./declares.js";
import { discover, hexOf, roleOf } from "./platform.js";
import { stringsIn } from "./strings.js";

// The platform readers: what an iOS, Android, Flutter, React Native or web app keeps in its own structured files,
// read without running anything.

const INFO_PLIST = `<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0">
<dict>
  <key>CFBundleName</key>
  <string>Receipts</string>
  <key>NSCameraUsageDescription</key>
  <string>$(PRODUCT_NAME) uses the camera to scan your receipts.</string>
  <key>NSLocationWhenInUseUsageDescription</key>
  <string>To tag each receipt with the shop you&apos;re in.</string>
  <key>UIBackgroundModes</key>
  <array>
    <string>fetch</string>
    <string>remote-notification</string>
    <string>audio</string>
  </array>
</dict>
</plist>`;
const ENTITLEMENTS = `<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0"><dict>
  <key>aps-environment</key>
  <string>development</string>
  <key>com.apple.developer.icloud-container-identifiers</key>
  <array><string>iCloud.com.example.receipts</string></array>
</dict></plist>`;
const ANDROID_MANIFEST = `<manifest xmlns:android="http://schemas.android.com/apk/res/android">
    <uses-permission android:name="android.permission.INTERNET" />
    <uses-permission android:name="android.permission.CAMERA" />
    <uses-permission android:name="android.permission.POST_NOTIFICATIONS" />
    <application>
        <receiver android:name=".StreakWidget">
            <intent-filter><action android:name="android.appwidget.action.APPWIDGET_UPDATE" /></intent-filter>
        </receiver>
    </application>
</manifest>`;

describe("roleOf", () => {
  it("reads Material, Android, iOS and CSS names as the same roles", () => {
    expect(roleOf("md_theme_dark_onPrimary")).toEqual({ role: "on-primary", dark: true });
    expect(roleOf("md_theme_light_background")).toEqual({ role: "background", dark: false });
    expect(roleOf("colorPrimary")).toEqual({ role: "primary", dark: false });
    expect(roleOf("AccentColor")).toEqual({ role: "primary", dark: false });
    expect(roleOf("--color-on-primary")).toEqual({ role: "on-primary", dark: false });
    expect(roleOf("--card-foreground")).toEqual({ role: "on-surface", dark: false });
    // Android's colorPrimaryDark is a darker shade, not dark mode: not a role.
    expect(roleOf("colorPrimaryDark")).toBeNull();
    expect(roleOf("purple_500")).toBeNull();
    expect(hexOf(255, 0, 0)).toBe("#ff0000");
    expect(hexOf(0, 0, 0, 0.5)).toBe("#00000080");
  });
});

describe("declaredIn", () => {
  it("takes iOS usage descriptions as the developer's own why, and background modes and entitlements as gaps", () => {
    const d = mergeDeclared([declaredIn("ios/Runner/Info.plist", INFO_PLIST, "Receipts"), declaredIn("ios/Runner/Runner.entitlements", ENTITLEMENTS)]);
    expect(d.uses).toEqual([
      { what: "camera", why: "Receipts uses the camera to scan your receipts.", file: "ios/Runner/Info.plist", line: 6, source: "NSCameraUsageDescription" },
      {
        what: "location",
        why: "To tag each receipt with the shop you're in.",
        file: "ios/Runner/Info.plist",
        line: 8,
        source: "NSLocationWhenInUseUsageDescription",
      },
    ]);
    // Background audio works in a web app (an <audio> element), so it isn't a gap.
    expect(d.gaps.map((g) => [g.kind, g.what])).toEqual([
      ["background", "Work that runs in the background while the app is closed"],
      ["notifications", "Push notifications"],
      ["sync", "Data kept in iCloud and synced across devices"],
    ]);
  });

  it("takes Android permissions as features with no why, and widgets and notifications as gaps", () => {
    const d = declaredIn("android/app/src/main/AndroidManifest.xml", ANDROID_MANIFEST);
    expect(d.uses).toEqual([{ what: "camera", why: null, file: "android/app/src/main/AndroidManifest.xml", line: 3, source: "android.permission.CAMERA" }]);
    expect(d.gaps.map((g) => g.what)).toEqual(["Notifications", "A home-screen widget"]);
  });

  it("keeps the feature with a why when iOS and Android both declare it, and skips a binary plist", () => {
    const d = mergeDeclared([declaredIn("AndroidManifest.xml", ANDROID_MANIFEST), declaredIn("Info.plist", INFO_PLIST)]);
    expect(d.uses.find((u) => u.what === "camera")!.why).toMatch(/scan your receipts/);
    expect(declaredIn("Info.plist", "bplist00\u0000binary")).toEqual({ uses: [], gaps: [] });
  });
});

describe("colours", () => {
  it("reads Android colors.xml, ARGB included, and values-night as dark", () => {
    const xml = `<resources>\n  <color name="colorPrimary">#FF3366FF</color>\n  <color name="md_theme_light_onPrimary">#FFFFFF</color>\n  <color name="purple_200">#BB86FC</color>\n  <color name="background">#80000000</color>\n</resources>`;
    expect(androidColors("app/src/main/res/values/colors.xml", xml).map((c) => [c.role, c.value, c.dark, c.line])).toEqual([
      ["primary", "#3366ff", false, 2],
      ["on-primary", "#ffffff", false, 3],
      ["background", "#00000080", false, 5],
    ]);
    expect(androidColors("app/src/main/res/values-night/colors.xml", xml)[0]!.dark).toBe(true);
  });

  it("reads an iOS colour set's light and dark colours, from floats, hex or 0-255", () => {
    const json = JSON.stringify({
      colors: [
        { idiom: "universal", color: { "color-space": "srgb", components: { red: "0.200", green: "0.400", blue: "1.000", alpha: "1.000" } } },
        {
          idiom: "universal",
          appearances: [{ appearance: "luminosity", value: "light" }],
          color: { components: { red: "0xFF", green: "0x00", blue: "0x00" } },
        },
        {
          idiom: "universal",
          appearances: [{ appearance: "luminosity", value: "dark" }],
          color: { components: { red: "0x0A", green: "0x0A", blue: "10", alpha: "1" } },
        },
      ],
    });
    expect(iosColorset("ios/Assets.xcassets/AccentColor.colorset/Contents.json", json).map((c) => [c.role, c.value, c.dark])).toEqual([
      ["primary", "#3366ff", false],
      ["primary", "#0a0a0a", true],
    ]);
    expect(iosColorset("ios/Assets.xcassets/Brand.colorset/Contents.json", "{")).toEqual([]);
  });

  it("reads CSS variables in hex, rgb, hsl and shadcn's bare HSL, dark by media query or .dark", () => {
    const css = `/* the theme */
:root {
  --background: 0 0% 100%;
  --primary: #3366ff;
  --spacing: 4px;
}
.dark { --background: 222.2 84% 4.9%; }
@media (prefers-color-scheme: dark) {
  :root { --primary: rgb(10, 20, 30); }
}`;
    expect(cssVars("src/index.css", css).map((c) => [c.role, c.value, c.dark, c.line])).toEqual([
      ["background", "#ffffff", false, 3],
      ["primary", "#3366ff", false, 4],
      ["background", "#020817", true, 7],
      ["primary", "#0a141e", true, 9],
    ]);
    expect(cssColor("var(--x)")).toBeNull();
    expect(cssColor("hsl(0, 100%, 50%)")).toBe("#ff0000");
  });

  it("keeps each role once in light and once in dark, the first file's winning", () => {
    const a = androidColors("res/values/colors.xml", `<color name="primary">#111111</color>`);
    const b = androidColors("res/values/colors.xml", `<color name="primary">#222222</color>`);
    expect(byRole([...a, ...b]).light.get("primary")!.value).toBe("#111111");
  });
});

describe("stringsIn", () => {
  it("reads Android, iOS (catalogs and .strings) and Flutter strings by key", () => {
    expect(
      stringsIn(
        "res/values/strings.xml",
        `<resources>\n<string name="add">Add a receipt</string>\n<string name="q">Don\\'t &amp; won&apos;t</string>\n</resources>`,
      ),
    ).toEqual([
      { key: "add", text: "Add a receipt", file: "res/values/strings.xml", line: 2 },
      { key: "q", text: "Don't & won't", file: "res/values/strings.xml", line: 3 },
    ]);
    const catalog = JSON.stringify(
      { sourceLanguage: "en", strings: { "Total %@": { localizations: { en: { stringUnit: { value: "Total %@" } } } }, Scan: {} } },
      null,
      2,
    );
    expect(stringsIn("Localizable.xcstrings", catalog).map((s) => [s.key, s.text])).toEqual([
      ["Total %@", "Total %@"],
      ["Scan", "Scan"],
    ]);
    expect(stringsIn("en.lproj/Localizable.strings", `"empty" = "No receipts yet";\n/* note */\n"quote" = "Say \\"hi\\"";`).map((s) => s.text)).toEqual([
      "No receipts yet",
      'Say "hi"',
    ]);
    expect(stringsIn("lib/l10n/app_en.arb", JSON.stringify({ title: "Receipts", "@title": { description: "x" } })).map((s) => s.key)).toEqual(["title"]);
    expect(stringsIn("app_en.arb", "{")).toEqual([]);
  });
});

describe("discover", () => {
  const repo = (files: Record<string, string>) => {
    const dir = mkdtempSync(join(tmpdir(), "platform-"));
    for (const [f, text] of Object.entries(files)) {
      mkdirSync(dirname(join(dir, f)), { recursive: true });
      writeFileSync(join(dir, f), text);
    }
    return dir;
  };

  it("finds a Flutter app's platforms and every kind of file, but not tests, builds or dependencies", () => {
    const found = discover(
      repo({
        "pubspec.yaml": "name: receipts\n",
        "lib/theme/app_theme.dart": "",
        "lib/screens/home_screen.dart": "",
        "lib/l10n/app_en.arb": "{}",
        "ios/Runner.xcodeproj/project.pbxproj": "",
        "ios/Runner/Info.plist": INFO_PLIST,
        "ios/Runner/Assets.xcassets/AccentColor.colorset/Contents.json": "{}",
        "android/app/src/main/AndroidManifest.xml": ANDROID_MANIFEST,
        "android/app/src/main/res/values/colors.xml": "<resources/>",
        "android/app/src/debug/AndroidManifest.xml": ANDROID_MANIFEST,
        "android/app/build/intermediates/AndroidManifest.xml": "",
        "node_modules/x/Info.plist": "",
      }),
    );
    expect(found.platforms).toEqual(["flutter", "ios", "android"]);
    expect(found.declares).toEqual(["android/app/src/main/AndroidManifest.xml", "ios/Runner/Info.plist"]);
    expect(found.colors).toEqual(["android/app/src/main/res/values/colors.xml", "ios/Runner/Assets.xcassets/AccentColor.colorset/Contents.json"]);
    expect(found.strings).toEqual(["lib/l10n/app_en.arb"]);
    expect(found.theme).toBe("lib/theme/app_theme.dart");
    expect(found.screens).toEqual(["lib/screens/home_screen.dart"]);
  });

  it("tells React Native from a website by its dependencies", () => {
    expect(discover(repo({ "package.json": JSON.stringify({ dependencies: { "react-native": "0.76" } }) })).platforms).toEqual(["react-native"]);
    expect(discover(repo({ "package.json": JSON.stringify({ dependencies: { react: "19" } }), "src/index.css": ":root{}" })).platforms).toEqual(["web"]);
  });
});
