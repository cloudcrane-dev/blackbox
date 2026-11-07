// The security policy CloudCrane's apps host serves every app with (appCsp in
// CloudCrane's apps-host/host.rules.ts), word for word, so a preview behaves as
// the app will on a phone: no scripts, styles or fonts from other sites, no eval,
// and only the sites the spec lists reachable.

const SITE = /^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

/** Features no app may have, whatever it declares (CloudCrane's ALWAYS_OFF). */
const ALWAYS_OFF = ["payment", "usb", "serial", "hid", "midi", "display-capture"];
/** Every feature an app could ask for: each is allowed only when the spec's uses declare it (CloudCrane's permissionsPolicy). */
const FEATURES = ["camera", "microphone", "geolocation", "accelerometer", "gyroscope", "magnetometer", "screen-wake-lock", "gamepad", "bluetooth"];

/** The Permissions-Policy CloudCrane serves an app with: what its uses declare, and nothing else. */
export function appPermissions(allowed: readonly string[]): string {
  const on = new Set(allowed);
  return [...FEATURES.map((f) => `${f}=${on.has(f) ? "*" : "()"}`), ...ALWAYS_OFF.map((f) => `${f}=()`)].join(", ");
}

export function appCsp(sites: readonly string[]): string {
  const listed = [...new Set(sites.map((s) => s.toLowerCase()))].filter((s) => SITE.test(s));
  const https = listed.map((s) => ` https://${s}`).join("");
  const connect = listed.map((s) => ` https://${s} wss://${s}`).join("");
  return [
    "default-src 'none'",
    "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' data: blob:${https}`,
    "media-src 'self' data: blob:",
    "font-src 'self' data:",
    `connect-src 'self'${connect}`,
    "manifest-src 'self'",
    "worker-src 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "base-uri 'none'",
  ].join("; ");
}
