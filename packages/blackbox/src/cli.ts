#!/usr/bin/env node
import { parseArgs } from "node:util";
import { build, diff, extract, preview, validate, type Outcome } from "./commands.js";

// blackbox: write a CloudCrane app spec from an app's code, see what a code
// change touched, and validate, build and preview a spec.

const USAGE = `blackbox <command> <path> [options]

  extract  <repo> [--hints FILE] [--out DIR]   write a spec from an app's code and its blackbox.hints.json
  diff     <repo> [--module ID] [--range A..B] which parts of the spec a code change touched
  validate <spec.json>                 check a spec: schema, A2UI surface, rules, leaks
  build    <spec.json> [--out FILE]    build the app page (the same bytes every time)
  preview  <spec.json> [--port N]      serve the app here, under CloudCrane's security policy`;

const print = (o: Outcome) => {
  for (const l of o.lines) (o.ok ? console.log : console.error)(l);
  return o.ok ? 0 : 1;
};

async function main(argv: string[]): Promise<number> {
  const { positionals, values } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      out: { type: "string" },
      port: { type: "string" },
      hints: { type: "string" },
      module: { type: "string" },
      range: { type: "string" },
      help: { type: "boolean", short: "h" },
    },
  });
  const [command, file] = positionals;
  if (values.help || !command) {
    console.log(USAGE);
    return command ? 0 : 1;
  }
  if (!file) {
    console.error(`${command} needs a spec file.\n\n${USAGE}`);
    return 1;
  }
  if (command === "extract") return print(extract(file, values.hints, values.out));
  if (command === "diff") return print(diff(file, values.module, values.range));
  if (command === "validate") return print(validate(file));
  if (command === "build") return print(build(file, values.out));
  if (command === "preview") {
    const { url } = await preview(file, values.port ? Number(values.port) : 5420);
    console.log(`Previewing at ${url} (Ctrl+C to stop)`);
    return new Promise(() => {});
  }
  console.error(`Unknown command: ${command}\n\n${USAGE}`);
  return 1;
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (e: Error) => {
    console.error(e.message);
    process.exit(1);
  },
);
