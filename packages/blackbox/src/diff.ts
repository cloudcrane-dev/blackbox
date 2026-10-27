import { execFileSync } from "node:child_process";
import { parseDiff, touches } from "veridic/staleness";
import type { Provenance } from "./extract.js";

// blackbox diff: which parts of a spec a code change touched. Each element's
// citations (provenance.json) are checked against `git diff` with Veridic's own
// diff reader: a hunk inside a cited range, or a cited file deleted or renamed,
// marks the element. Re-extracting regenerates exactly those (and nothing in the
// spec moves for a change no element cites).

export type Touched = { pointer: string; file: string; lines: [number, number]; why: "changed" | "deleted" | "renamed" };

export function touchedBy(repo: string, provenance: Provenance, range?: string): Touched[] {
  const files = new Set(Object.values(provenance.elements).flatMap((cs) => cs.filter((c) => c.how !== "hint").map((c) => c.file)));
  if (!files.size) return [];
  const args = ["diff", "--unified=0", "-M", "--no-color", "--no-ext-diff", ...(range ? [range] : []), "--", ...[...files].sort()];
  const changes = parseDiff(execFileSync("git", args, { cwd: repo, encoding: "utf8" }));
  const out: Touched[] = [];
  for (const [pointer, cites] of Object.entries(provenance.elements).sort(([a], [b]) => (a < b ? -1 : 1))) {
    for (const c of cites) {
      if (c.how === "hint") continue;
      const change = changes.get(c.file);
      if (!change) continue;
      if (change.status === "deleted" || change.status === "renamed") {
        out.push({ pointer, file: c.file, lines: c.lines, why: change.status });
        break;
      }
      if (change.hunks.some((h) => touches(h, c.lines[0], c.lines[1]))) {
        out.push({ pointer, file: c.file, lines: c.lines, why: "changed" });
        break;
      }
    }
  }
  return out;
}
