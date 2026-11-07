import type { Problem } from "./a2ui.js";
import type { Spec } from "./schema.js";
import { USE_NAMES, type Use } from "./uses.js";

// What it can reach, checked against the code: a coded or page component's code may name only the sites in `network`
// and use only the device features in `uses`, so what the person is shown before the app opens is everything it does.
// Refusals, not warnings. The same reading CloudCrane's checks give an app's code (its apps.rules.ts and
// blueprints/capabilities.ts), so a spec that passes here passes there.

/** Example domains and schema.org name no site an app talks to. */
const EXAMPLE_DOMAIN = /^(?:[a-z0-9-]+\.)*example\.(?:com|org|net)$|^(?:[a-z0-9-]+\.)+(?:example|test|invalid|localhost)$/i;
const notASite = (host: string) => EXAMPLE_DOMAIN.test(host.replace(/:\d+$/, "")) || /^(?:[a-z0-9-]+\.)*schema\.org(?::\d+)?$/.test(host);

/** Links and the page's own tags carry nothing with them: their addresses aren't sites the code talks to. */
const OWN_TAG = /<(a|script|link|iframe|embed|object|form)\b[^>]*>/gi;
const ADDRESS_ATTR = /(?<=\s)(href|src|data|action)\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi;

/** Every host an https:// or wss:// address in the code names, lower-case, once each. */
export function hostsNamedIn(code: string): string[] {
  const text = code.replace(OWN_TAG, (tag) => tag.replace(ADDRESS_ATTR, '$1=""'));
  const hosts = new Set<string>();
  for (const m of text.matchAll(/\b(?:https|wss):\/\/([^\s/?#"'`<>\\()[\]{},;$]+)/gi)) {
    const authority = m[1]!;
    const host = authority
      .slice(authority.lastIndexOf("@") + 1)
      .toLowerCase()
      .replace(/\.$/, "")
      .replace(/:443$/, "");
    if (host && !notASite(host)) hosts.add(host);
  }
  return [...hosts];
}

/** Calls that reach the network, and where their address starts. */
const REQUESTS = [
  /(?<![\w$])fetch\s*\(\s*/g,
  /\bnew\s+(?:WebSocket|EventSource)\s*\(\s*/g,
  /\.sendBeacon\s*\(\s*/g,
  /\.open\s*\(\s*(["'`])[A-Za-z]+\1\s*,\s*/g,
];

/** Whether a request's address is put together while the app runs, so no one can read which site it reaches. */
export function buildsAddressAtRuntime(code: string): boolean {
  for (const pattern of REQUESTS) {
    if (pattern.source.startsWith("\\.open") && !/XMLHttpRequest/.test(code)) continue;
    for (const m of code.matchAll(pattern)) {
      const rest = code.slice(m.index! + m[0].length, m.index! + m[0].length + 300);
      const quote = rest[0];
      if (quote !== '"' && quote !== "'" && quote !== "`") return true;
      const end = rest.indexOf(quote, 1);
      let start = rest.slice(1, end === -1 ? undefined : end);
      if (quote === "`" && start.includes("${")) start = start.slice(0, start.indexOf("${"));
      if (!start) return true;
      const absolute = /^([a-z][a-z0-9+.-]*:|\/\/)/i.test(start);
      if (absolute && !/^(?:[a-z][a-z0-9+.-]*:)?\/\/[a-z0-9-]+(\.[a-z0-9-]+)*/i.test(start)) return true;
    }
  }
  return false;
}

/** How code uses each device feature a spec can declare. */
const USED_BY: Record<Use, RegExp[]> = {
  camera: [/\bgetUserMedia\b/],
  microphone: [/\bgetUserMedia\b/],
  location: [/\bgeolocation\b/],
  motion: [/\bDevice(Motion|Orientation)Event\b/, /\bdevice(motion|orientation)\b/],
  "screen-awake": [/\bwakeLock\b/],
  gamepad: [/\bgetGamepads\b/, /\bgamepad(dis)?connected\b/],
  voice: [/\b(webkit)?SpeechRecognition\b/],
  contacts: [/\bnavigator\.contacts\b/, /\bContactsManager\b/],
  nfc: [/\bNDEF(Reader|Message|Record)\b/],
};
/** Features a spec can't declare, so code that uses them is refused. */
const NOT_FOR_SPECS: [string, RegExp][] = [
  ["Bluetooth", /\bnavigator\.bluetooth\b/],
  ["direct connections to other phones (RTCPeerConnection)", /\b(webkit)?RTCPeerConnection\b/],
  ["USB, serial or HID devices", /\bnavigator\.(usb|serial|hid)\b/],
  ["payments", /\bPaymentRequest\b/],
];

export function reachProblems(spec: Spec): Problem[] {
  const problems: Problem[] = [];
  const sites = new Set(spec.network.map((n) => n.site));
  const declared = new Set(spec.uses.map((u) => u.what));
  for (const [name, component] of Object.entries(spec.components)) {
    const at = `components.${name}.code`;
    const code = component.code;
    for (const host of hostsNamedIn(code))
      if (!sites.has(host)) problems.push({ at, problem: `talks to ${host}, which network doesn't list: add it with why and what it's sent, or take it out` });
    if (buildsAddressAtRuntime(code))
      problems.push({ at, problem: "builds a request's address while it runs, so no one can tell which site it reaches: write each address out in full" });
    // camera and microphone share getUserMedia: either one declared covers it.
    for (const what of USE_NAMES) {
      if (declared.has(what) || !USED_BY[what].some((p) => p.test(code))) continue;
      if ((what === "camera" || what === "microphone") && (declared.has("camera") || declared.has("microphone"))) continue;
      problems.push({ at, problem: `uses ${what} but uses doesn't declare it: add it with why, or take it out` });
    }
    for (const [what, pattern] of NOT_FOR_SPECS) if (pattern.test(code)) problems.push({ at, problem: `uses ${what}, which a spec can't declare` });
  }
  return problems;
}
