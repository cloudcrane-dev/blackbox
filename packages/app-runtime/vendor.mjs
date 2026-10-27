// Builds the host bundle: src/host.ts as one ES module for Node, with zod left
// to the host (it's a peer), into the directory given (CloudCrane's lib/blackbox/vendor),
// beside host.d.ts (as blackbox.d.mts) and VENDOR.json (the commit, versions and each file's sha256).
//   node vendor.mjs <out-dir>
import { build } from "esbuild";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const out = process.argv[2];
if (!out) {
  console.error("usage: node vendor.mjs <out-dir>");
  process.exit(1);
}
mkdirSync(out, { recursive: true });
const result = await build({
  entryPoints: ["src/host.ts"],
  bundle: true,
  format: "esm",
  platform: "node",
  target: "node22",
  external: ["zod"],
  legalComments: "eof",
  charset: "utf8",
  write: false,
  logLevel: "error",
});
const files = { "blackbox.mjs": result.outputFiles[0].text, "blackbox.d.mts": readFileSync("host.d.ts", "utf8") };
for (const [name, text] of Object.entries(files)) writeFileSync(join(out, name), text);
const sha = (s) => createHash("sha256").update(s).digest("hex");
const git = (...a) => execFileSync("git", a, { encoding: "utf8" }).trim();
const { version } = JSON.parse(readFileSync("package.json", "utf8"));
const vendor = {
  from: "blackbox (packages/app-runtime/src/host.ts)",
  commit: git("rev-parse", "HEAD"),
  dirty: git("status", "--porcelain") !== "",
  runtime: version,
  files: Object.fromEntries(Object.entries(files).map(([n, t]) => [n, sha(t)])),
};
writeFileSync(join(out, "VENDOR.json"), JSON.stringify(vendor, null, 2) + "\n");
copyFileSync(new URL("../../LICENSE", import.meta.url), join(out, "LICENSE"));
console.log(`host bundle: ${files["blackbox.mjs"].length} bytes into ${out}`);
