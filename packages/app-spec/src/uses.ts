// The device features an app can declare, by CloudCrane's names, and the
// browser's Permissions-Policy features each needs. A coded component's frame
// is allowed those of the features the spec declares. The contact picker and
// NFC have no browser feature: CloudCrane's lockdown is their only block.

export const USES = {
  camera: ["camera"],
  microphone: ["microphone"],
  location: ["geolocation"],
  motion: ["accelerometer", "gyroscope", "magnetometer"],
  "screen-awake": ["screen-wake-lock"],
  gamepad: ["gamepad"],
  voice: ["microphone"],
  contacts: [],
  nfc: [],
} as const satisfies Record<string, readonly string[]>;

export type Use = keyof typeof USES;
export const USE_NAMES = Object.keys(USES) as [Use, ...Use[]];

/** What a frame with no origin of its own can't have, whatever it's allowed: the browser gives it no camera or microphone. */
export const NEEDS_ORIGIN: readonly Use[] = ["camera", "microphone"];

/** The browser features for the uses declared, each once, in a fixed order. */
export function featuresOf(uses: readonly { what: string }[]): string[] {
  const declared = new Set(uses.map((u) => u.what));
  const out = new Set<string>();
  for (const name of USE_NAMES) if (declared.has(name)) for (const f of USES[name]) out.add(f);
  return [...out];
}
