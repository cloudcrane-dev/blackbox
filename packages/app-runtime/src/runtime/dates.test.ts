import { afterEach, describe, expect, it, vi } from "vitest";
// The date parser the runtime bundles, as patched (patches/@a2ui__web_core@0.14.0.patch).
import { parseTimestamp } from "../../node_modules/@a2ui/web_core/src/common/basic_functions.js";

// Safari reads only the forms the language's standard names: a date alone, or a date, a "T" and a time, with an
// optional offset. Chrome (and Node) also read "2026-11-02Z" and "2026-11-02 10:00Z", so a test there never sees
// what an iPhone does. This stands in for Safari: any other string is an Invalid Date.
const STANDARD = /^[+-]?\d{4,6}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})?)?$/;
const RealDate = Date;
function likeSafari() {
  vi.stubGlobal(
    "Date",
    new Proxy(RealDate, {
      construct(target, args: unknown[]) {
        const [first] = args;
        if (args.length === 1 && typeof first === "string" && !STANDARD.test(first)) return new target(NaN);
        return new target(...(args as ConstructorParameters<typeof Date>));
      },
    }),
  );
}
const fields = (value: string) => {
  const parsed = parseTimestamp(value) as { shifted: Date } | null;
  return parsed && parsed.shifted.toISOString().slice(0, 16);
};

describe("dates as an iPhone reads them", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("reads a date with no time, which Safari refuses once a Z is put straight after it", () => {
    likeSafari();
    expect(fields("2026-11-02")).toBe("2026-11-02T00:00");
  });

  it("reads a date and time written with a space, or with no seconds", () => {
    likeSafari();
    expect(fields("2026-11-02 09:30")).toBe("2026-11-02T09:30");
    expect(fields("2026-11-02T09:30")).toBe("2026-11-02T09:30");
    expect(fields("2026-11-02T09:30:15")).toBe("2026-11-02T09:30");
  });

  it("keeps the fields a time with an offset was written with", () => {
    likeSafari();
    expect(fields("2026-11-02T09:30:00+05:30")).toBe("2026-11-02T09:30");
    expect(fields("2026-11-02T09:30:00Z")).toBe("2026-11-02T09:30");
  });

  it("still refuses a date that doesn't exist, and words that aren't a date", () => {
    likeSafari();
    expect(parseTimestamp("2026-02-30")).toBeNull();
    expect(parseTimestamp("tomorrow")).toBeNull();
    expect(parseTimestamp("")).toBeNull();
  });
});
