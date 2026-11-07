import { describe, expect, it } from "vitest";
import { sampleSpec } from "./fixtures.js";
import { buildsAddressAtRuntime, hostsNamedIn, reachProblems } from "./reach.js";

// What it can reach: a coded or page component's code names only listed sites and uses only declared features.

const withCode = (code: string) => {
  const s = sampleSpec();
  s.components = { game: { kind: "coded", kit: "game", label: "Game", inputs: {}, events: {}, code } } as unknown as typeof s.components;
  return s;
};

describe("what a component's code reaches", () => {
  it("names the sites in its code, but not links, example domains or schema.org", () => {
    expect(
      hostsNamedIn('fetch("https://api.open-meteo.com/v1?x=1"); new WebSocket("wss://live.example.com"); <a href="https://help.site.com">help</a>'),
    ).toEqual(["api.open-meteo.com"]);
    expect(hostsNamedIn('"@context": "https://schema.org"')).toEqual([]);
  });

  it("refuses a site network doesn't list, and an address built while it runs", () => {
    const said = reachProblems(withCode('fetch("https://tracker.ads.com/p")')).map((p) => p.problem);
    expect(said).toEqual([expect.stringMatching(/talks to tracker\.ads\.com, which network doesn't list/)]);
    const listed = withCode('fetch("https://tracker.ads.com/p")');
    listed.network = [{ site: "tracker.ads.com", why: "Counts plays", sends: "Nothing personal: a count" }];
    expect(reachProblems(listed)).toEqual([]);
    expect(buildsAddressAtRuntime("fetch(base + '/x')")).toBe(true);
    expect(buildsAddressAtRuntime('fetch("/data.json")')).toBe(false);
    expect(reachProblems(withCode("fetch(base + '/x')")).map((p) => p.problem)).toEqual([expect.stringMatching(/builds a request's address while it runs/)]);
  });

  it("refuses a device feature uses doesn't declare, and ones a spec can't declare at all", () => {
    expect(reachProblems(withCode("navigator.geolocation.getCurrentPosition(f)")).map((p) => p.problem)).toEqual([
      expect.stringMatching(/uses location but uses doesn't declare it/),
    ]);
    const declared = withCode("navigator.geolocation.getCurrentPosition(f)");
    declared.uses = [{ what: "location", why: "Weather where you are" }];
    expect(reachProblems(declared)).toEqual([]);
    expect(reachProblems(withCode("navigator.bluetooth.requestDevice({})")).map((p) => p.problem)).toEqual([
      expect.stringMatching(/Bluetooth, which a spec can't declare/),
    ]);
  });
});
