// Packs each package as `pnpm publish` would, checks what's in the tarballs,
// then installs them into an empty project and uses them as someone would from
// npm: the CLI builds the example app to its golden hash, and each library
// imports. Nothing is published.
//   node scripts/pack-check.mjs
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const run = (cmd, args, cwd) => execFileSync(cmd, args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
const fail = (why) => {
  console.error(`pack-check: ${why}`);
  process.exit(1);
};

const out = mkdtempSync(join(tmpdir(), "blackbox-pack-"));
const tarballs = {};
for (const name of ["app-spec", "app-runtime", "blackbox"]) {
  const dir = join(root, "packages", name);
  const file = run("pnpm", ["pack", "--pack-destination", out], dir).trim().split("\n").pop();
  const files = run("tar", ["-tzf", file]).trim().split("\n");
  const manifest = JSON.parse(run("tar", ["-xzOf", file, "package/package.json"]));
  const text = JSON.stringify(manifest);
  if (text.includes("workspace:")) fail(`${manifest.name} still names a workspace: version`);
  if (text.includes("./src/")) fail(`${manifest.name} points at its source, not dist/`);
  if (files.some((f) => /\.test\.|^package\/src\/|\.tsbuild/.test(f)))
    fail(`${manifest.name} ships tests or source: ${files.filter((f) => /\.test\.|^package\/src\/|\.tsbuild/.test(f)).join(", ")}`);
  for (const f of ["package/LICENSE", "package/README.md"]) if (!files.includes(f)) fail(`${manifest.name} is missing ${f}`);
  const kb = Math.round(Number(run("wc", ["-c", file]).trim().split(/\s+/)[0]) / 1024);
  console.log(`${manifest.name}@${manifest.version}: ${files.length} files, ${kb} KB`);
  tarballs[name] = file;
}

const project = mkdtempSync(join(tmpdir(), "blackbox-use-"));
writeFileSync(join(project, "package.json"), JSON.stringify({ name: "use", private: true, type: "module" }));
run("npm", ["install", "--no-audit", "--no-fund", "--loglevel=error", tarballs["app-spec"], tarballs["app-runtime"], tarballs["blackbox"]], project);

const spec = join(root, "fixtures/habits/spec.json");
const golden = readFileSync(join(root, "packages/app-runtime/golden/habits.sha256"), "utf8").trim();
const bin = join(project, "node_modules/.bin/blackbox");
run(bin, ["validate", spec], project);
run(bin, ["build", spec, "--out", join(project, "app.html")], project);
const built = createHash("sha256")
  .update(readFileSync(join(project, "app.html")))
  .digest("hex");
if (built !== golden) fail(`the installed CLI built ${built.slice(0, 12)}, not the golden ${golden.slice(0, 12)}`);
console.log(`installed CLI: validate passes, build matches the golden page (${golden.slice(0, 12)})`);

const imports = `
import { validateSpec, deriveBlueprint } from "@cloudcrane/app-spec";
import { Rules } from "@cloudcrane/app-spec/logic";
import { compile } from "@cloudcrane/app-runtime";
import { compile as hostCompile } from "@cloudcrane/app-runtime/host";
import { extract, touchedBy } from "@cloudcrane/blackbox";
import { createRequire } from "node:module";
const schema = createRequire(import.meta.url)("@cloudcrane/app-spec/schema.json");
const { spec } = validateSpec(JSON.parse(process.argv[2]));
if (!spec || !deriveBlueprint(spec).purpose || compile(spec).sha256 !== hostCompile(spec).sha256) process.exit(2);
if (typeof Rules !== "function" || typeof extract !== "function" || typeof touchedBy !== "function" || !schema.$id) process.exit(3);
`;
writeFileSync(join(project, "imports.mjs"), imports);
run("node", ["imports.mjs", readFileSync(spec, "utf8")], project);
console.log("installed libraries: every entry point imports and works");
