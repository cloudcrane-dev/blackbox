import type { GapKind } from "./gaps.js";

// What an app declares about itself to the phone, read from its manifests, never run:
// - phone features (the spec's uses): Android permissions, and iOS usage descriptions, which are the developer's own
//   words for why, shown to people when the app asks;
// - what a web app can't do yet (the spec's gaps): background modes, push, widgets, Health, iCloud, purchases...
// From AndroidManifest.xml, Info.plist (XML) and *.entitlements.

export type Use = "camera" | "microphone" | "location" | "motion" | "screen-awake" | "gamepad" | "voice" | "contacts" | "nfc";
export type DeclaredUse = { what: Use; why: string | null; file: string; line: number; source: string };
export type DeclaredGap = { kind: GapKind; what: string; file: string; line: number; source: string };
export type Declared = { uses: DeclaredUse[]; gaps: DeclaredGap[] };

/** iOS usage-description keys: the feature each asks for. Others (photos, Bluetooth, Health) are gaps or need nothing. */
const IOS_USES: Record<string, Use> = {
  NSCameraUsageDescription: "camera",
  NSMicrophoneUsageDescription: "microphone",
  NSLocationWhenInUseUsageDescription: "location",
  NSLocationAlwaysAndWhenInUseUsageDescription: "location",
  NSLocationUsageDescription: "location",
  NSMotionUsageDescription: "motion",
  NSSpeechRecognitionUsageDescription: "voice",
  NSContactsUsageDescription: "contacts",
  NFCReaderUsageDescription: "nfc",
};
const IOS_GAP_KEYS: Record<string, [GapKind, string]> = {
  NSBluetoothAlwaysUsageDescription: ["device", "Bluetooth devices beyond what the browser allows"],
  NSHealthShareUsageDescription: ["device", "Reading Apple Health"],
  NSHealthUpdateUsageDescription: ["device", "Writing to Apple Health"],
  NSLocationAlwaysUsageDescription: ["background", "Location while the app is closed"],
  NSCalendarsUsageDescription: ["device", "Reading and changing the calendar directly"],
  NSRemindersUsageDescription: ["device", "Reading and changing Reminders"],
};
const IOS_BACKGROUND: Record<string, string> = {
  fetch: "Work that runs in the background while the app is closed",
  processing: "Work that runs in the background while the app is closed",
  location: "Location while the app is closed",
  "remote-notification": "Push notifications",
  "bluetooth-central": "Bluetooth devices beyond what the browser allows",
};
const ENTITLEMENTS: [RegExp, GapKind, string][] = [
  [/^aps-environment$/, "notifications", "Push notifications"],
  [/^com\.apple\.developer\.healthkit$/, "device", "Reading Apple Health"],
  [
    /^com\.apple\.developer\.(icloud-container-identifiers|ubiquity-kvstore-identifier|icloud-services)$/,
    "sync",
    "Data kept in iCloud and synced across devices",
  ],
  [/^com\.apple\.developer\.applesignin$/, "accounts", "Signing in with Apple"],
  [/^com\.apple\.developer\.in-app-payments$/, "purchases", "Apple Pay"],
  [/^com\.apple\.developer\.homekit$/, "device", "Controlling HomeKit devices"],
  [/^com\.apple\.developer\.siri$/, "device", "Siri"],
  [/^com\.apple\.security\.application-groups$/, "widget", "Sharing data with a widget or extension"],
];

/** Android permissions: the feature each asks for, or what a web app can't do. */
const ANDROID_USES: Record<string, Use> = {
  "android.permission.CAMERA": "camera",
  "android.permission.RECORD_AUDIO": "microphone",
  "android.permission.ACCESS_FINE_LOCATION": "location",
  "android.permission.ACCESS_COARSE_LOCATION": "location",
  "android.permission.READ_CONTACTS": "contacts",
  "android.permission.NFC": "nfc",
};
const ANDROID_GAPS: Record<string, [GapKind, string]> = {
  "android.permission.POST_NOTIFICATIONS": ["notifications", "Notifications"],
  "android.permission.RECEIVE_BOOT_COMPLETED": ["background", "Work that starts when the phone does"],
  "android.permission.FOREGROUND_SERVICE": ["background", "Work that runs in the background while the app is closed"],
  "android.permission.SCHEDULE_EXACT_ALARM": ["background", "Alarms that run code while the app is closed"],
  "android.permission.USE_EXACT_ALARM": ["background", "Alarms that run code while the app is closed"],
  "android.permission.ACCESS_BACKGROUND_LOCATION": ["background", "Location while the app is closed"],
  "android.permission.BODY_SENSORS": ["device", "Body sensors"],
  "android.permission.ACTIVITY_RECOGNITION": ["device", "Step counting and activity recognition"],
  "android.permission.BLUETOOTH_CONNECT": ["device", "Bluetooth devices beyond what the browser allows"],
  "android.permission.BLUETOOTH_SCAN": ["device", "Bluetooth devices beyond what the browser allows"],
  "android.permission.READ_CALENDAR": ["device", "Reading and changing the calendar directly"],
  "android.permission.READ_SMS": ["device", "Reading text messages"],
  "android.permission.CALL_PHONE": ["device", "Placing phone calls directly"],
};
const ANDROID_ACTIONS: Record<string, [GapKind, string]> = {
  "com.google.firebase.MESSAGING_EVENT": ["notifications", "Push notifications"],
  "android.appwidget.action.APPWIDGET_UPDATE": ["widget", "A home-screen widget"],
  "android.intent.action.BOOT_COMPLETED": ["background", "Work that starts when the phone does"],
};

const unescape = (s: string) =>
  s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .trim();
const lineAt = (text: string, index: number) => text.slice(0, index).split("\n").length;

/** Each top-level-looking key of an XML plist with its string value, array of strings, or presence, and its line. */
function plistEntries(text: string): { key: string; value: string | string[] | true; line: number }[] {
  const out: { key: string; value: string | string[] | true; line: number }[] = [];
  for (const m of text.matchAll(/<key>([^<]+)<\/key>\s*(<string>([^<]*)<\/string>|<array>([\s\S]*?)<\/array>|<(true|dict|string)\s*\/?>)?/g)) {
    const line = lineAt(text, m.index!);
    if (m[3] !== undefined) out.push({ key: m[1]!.trim(), value: unescape(m[3]), line });
    else if (m[4] !== undefined) out.push({ key: m[1]!.trim(), value: [...m[4].matchAll(/<string>([^<]*)<\/string>/g)].map((x) => unescape(x[1]!)), line });
    else out.push({ key: m[1]!.trim(), value: true, line });
  }
  return out;
}

/** What an Info.plist, an .entitlements file or an AndroidManifest.xml declares. `appName` stands in for $(PRODUCT_NAME). */
export function declaredIn(file: string, text: string, appName = "the app"): Declared {
  const uses: DeclaredUse[] = [];
  const gaps: DeclaredGap[] = [];
  if (/AndroidManifest\.xml$/.test(file)) {
    for (const m of text.matchAll(/<uses-permission(?:-sdk-23)?\b[^>]*android:name\s*=\s*"([^"]+)"/g)) {
      const name = m[1]!;
      const line = lineAt(text, m.index!);
      if (ANDROID_USES[name]) uses.push({ what: ANDROID_USES[name], why: null, file, line, source: name });
      const gap = ANDROID_GAPS[name];
      if (gap) gaps.push({ kind: gap[0], what: gap[1], file, line, source: name });
    }
    for (const m of text.matchAll(/<action\b[^>]*android:name\s*=\s*"([^"]+)"/g)) {
      const gap = ANDROID_ACTIONS[m[1]!];
      if (gap) gaps.push({ kind: gap[0], what: gap[1], file, line: lineAt(text, m.index!), source: m[1]! });
    }
  } else if (/\.(plist|entitlements)$/.test(file)) {
    if (!/<plist\b/.test(text)) return { uses, gaps }; // a binary plist: not read
    for (const e of plistEntries(text)) {
      const use = IOS_USES[e.key];
      if (use && typeof e.value === "string")
        uses.push({ what: use, why: e.value.replace(/\$\((PRODUCT_NAME|EXECUTABLE_NAME)\)/g, appName) || null, file, line: e.line, source: e.key });
      const g = IOS_GAP_KEYS[e.key];
      if (g) gaps.push({ kind: g[0], what: g[1], file, line: e.line, source: e.key });
      if (e.key === "UIBackgroundModes" && Array.isArray(e.value))
        for (const mode of e.value) {
          const what = IOS_BACKGROUND[mode];
          if (what)
            gaps.push({
              kind: mode === "remote-notification" ? "notifications" : mode.startsWith("bluetooth") ? "device" : "background",
              what,
              file,
              line: e.line,
              source: `UIBackgroundModes ${mode}`,
            });
        }
      if (e.key === "NSExtensionPointIdentifier" && e.value === "com.apple.widgetkit-extension")
        gaps.push({ kind: "widget", what: "A home-screen widget", file, line: e.line, source: e.key });
      for (const [re, kind, what] of ENTITLEMENTS) if (re.test(e.key)) gaps.push({ kind, what, file, line: e.line, source: e.key });
    }
  }
  return { uses, gaps };
}

/** Several files' declarations together: each feature once (the first with the developer's why wins), each gap once by what. */
export function mergeDeclared(all: Declared[]): Declared {
  const uses = new Map<Use, DeclaredUse>();
  const gaps = new Map<string, DeclaredGap>();
  for (const d of all) {
    for (const u of d.uses) {
      const had = uses.get(u.what);
      if (!had || (!had.why && u.why)) uses.set(u.what, u);
    }
    for (const g of d.gaps) if (!gaps.has(g.what)) gaps.set(g.what, g);
  }
  return { uses: [...uses.values()], gaps: [...gaps.values()] };
}
