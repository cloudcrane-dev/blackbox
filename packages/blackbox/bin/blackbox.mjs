#!/usr/bin/env node
// Runs the CLI from source with tsx until it ships prebuilt.
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
const cli = fileURLToPath(new URL("../src/cli.ts", import.meta.url));
const tsx = fileURLToPath(new URL("../node_modules/.bin/tsx", import.meta.url));
const r = spawnSync(tsx, [cli, ...process.argv.slice(2)], { stdio: "inherit" });
process.exit(r.status ?? 1);
