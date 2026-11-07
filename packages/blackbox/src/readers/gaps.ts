// What an app does that a phone web app can't yet, read from the packages it depends on: Flutter's pubspec.yaml and
// a React Native or web app's package.json. Read, never run. Each finding is a suggestion for the spec's gaps, which the
// partner keeps, rewords or drops in blackbox.hints.json: a package can be listed and never used.

export type GapKind = "background" | "widget" | "notifications" | "purchases" | "accounts" | "sync" | "device" | "other";
export type FoundGap = { kind: GapKind; what: string; package: string; line: number };

/** Package name (exact, or a prefix ending in "*") → what the app likely does with it that a web app can't yet. */
export const KNOWN: [string, GapKind, string][] = [
  // Flutter (pub.dev)
  ["workmanager", "background", "Work that runs in the background while the app is closed"],
  ["background_fetch", "background", "Work that runs in the background while the app is closed"],
  ["flutter_background_service", "background", "Work that runs in the background while the app is closed"],
  ["android_alarm_manager_plus", "background", "Alarms that run code while the app is closed"],
  ["home_widget", "widget", "A home-screen widget"],
  ["firebase_messaging", "notifications", "Push notifications"],
  ["flutter_local_notifications", "notifications", "Scheduled notifications"],
  ["awesome_notifications", "notifications", "Scheduled notifications"],
  ["onesignal_flutter", "notifications", "Push notifications"],
  ["in_app_purchase", "purchases", "In-app purchases or subscriptions"],
  ["purchases_flutter", "purchases", "In-app purchases or subscriptions"],
  ["firebase_auth", "accounts", "Signing in to an account"],
  ["google_sign_in", "accounts", "Signing in with Google"],
  ["sign_in_with_apple", "accounts", "Signing in with Apple"],
  ["supabase_flutter", "accounts", "Signing in and keeping data on a server"],
  ["cloud_firestore", "sync", "Data kept on a server and synced across devices"],
  ["firebase_database", "sync", "Data kept on a server and synced across devices"],
  ["health", "device", "Reading Apple Health or Health Connect"],
  ["flutter_blue_plus", "device", "Bluetooth devices beyond what the browser allows"],
  ["local_auth", "device", "Face ID or fingerprint inside the app"],
  ["geofence_service", "background", "Reacting to places while the app is closed"],
  // React Native and web (npm)
  ["react-native-background-fetch", "background", "Work that runs in the background while the app is closed"],
  ["react-native-background-actions", "background", "Work that runs in the background while the app is closed"],
  ["expo-background-fetch", "background", "Work that runs in the background while the app is closed"],
  ["expo-task-manager", "background", "Work that runs in the background while the app is closed"],
  ["react-native-widget-extension", "widget", "A home-screen widget"],
  ["@react-native-firebase/messaging", "notifications", "Push notifications"],
  ["expo-notifications", "notifications", "Push or scheduled notifications"],
  ["@notifee/react-native", "notifications", "Scheduled notifications"],
  ["react-native-iap", "purchases", "In-app purchases or subscriptions"],
  ["react-native-purchases", "purchases", "In-app purchases or subscriptions"],
  ["expo-in-app-purchases", "purchases", "In-app purchases or subscriptions"],
  ["@react-native-firebase/auth", "accounts", "Signing in to an account"],
  ["expo-auth-session", "accounts", "Signing in to an account"],
  ["@react-native-firebase/firestore", "sync", "Data kept on a server and synced across devices"],
  ["react-native-health", "device", "Reading Apple Health"],
  ["react-native-health-connect", "device", "Reading Health Connect"],
  ["expo-local-authentication", "device", "Face ID or fingerprint inside the app"],
];

const matches = (name: string, pattern: string) => (pattern.endsWith("*") ? name.startsWith(pattern.slice(0, -1)) : name === pattern);

/** The dependency names in a pubspec.yaml (under dependencies only, not dev_dependencies), with their lines. */
function pubspecDeps(text: string): { name: string; line: number }[] {
  const out: { name: string; line: number }[] = [];
  let inDeps = false;
  text.split("\n").forEach((raw, i) => {
    const line = raw.replace(/#.*$/, "");
    if (/^\S/.test(line)) inDeps = /^dependencies\s*:/.test(line);
    else if (inDeps) {
      const m = /^ {2}([a-z0-9_]+)\s*:/.exec(line);
      if (m) out.push({ name: m[1]!, line: i + 1 });
    }
  });
  return out;
}

/** The dependency names in a package.json (dependencies only), with their lines. */
function packageDeps(text: string): { name: string; line: number }[] {
  let deps: Record<string, unknown> = {};
  try {
    deps = (JSON.parse(text) as { dependencies?: Record<string, unknown> }).dependencies ?? {};
  } catch {
    return [];
  }
  const lines = text.split("\n");
  return Object.keys(deps).map((name) => ({ name, line: Math.max(1, lines.findIndex((l) => l.includes(`"${name}"`)) + 1) }));
}

/** The gaps a manifest suggests, once each by what, in the order the packages are listed. */
export function gapsIn(file: string, text: string): FoundGap[] {
  const deps = file.endsWith("pubspec.yaml") ? pubspecDeps(text) : file.endsWith("package.json") ? packageDeps(text) : [];
  const out: FoundGap[] = [];
  const seen = new Set<string>();
  for (const d of deps) {
    const known = KNOWN.find(([pattern]) => matches(d.name, pattern));
    if (!known || seen.has(known[2])) continue;
    seen.add(known[2]);
    out.push({ kind: known[1], what: known[2], package: d.name, line: d.line });
  }
  return out;
}
