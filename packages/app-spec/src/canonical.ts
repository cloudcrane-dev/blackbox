import canonicalizeJson from "canonicalize";

/** A value as RFC 8785 (JCS) canonical JSON: the same bytes for the same value, everywhere. */
export function canonical(value: unknown): string {
  const out = (canonicalizeJson as unknown as (v: unknown) => string | undefined)(value);
  if (out === undefined) throw new TypeError("Not representable as JSON");
  return out;
}
