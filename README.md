# Blackbox

Turn an app you already have into a **CloudCrane app spec**: a description of
the app with none of its code in it, which builds into the same app every time.

```
your repo ──blackbox extract──▶ spec.json + provenance.json ──blackbox build──▶ app.html
```

- **`spec.json`** is what you share. It holds your app's look (design tokens),
  its screens (A2UI), its rules (CEL expressions), the data it saves on the
  phone, and the journeys and promises it keeps. No source code, no file paths.
  A leak scan and a copy check against your source refuse a spec that carries
  either.
- **Coded components** are the one exception, said so plainly: what the
  catalog can't draw (a game on a canvas) can be the spec's own code, run in a
  sandboxed frame with a kit, given only the inputs it declares and sending
  only the events it declares. See [`fixtures/snake`](fixtures/snake/spec.json).
- **`provenance.json`** stays with you. It points every part of the spec at the
  lines of your code it came from, so `blackbox diff` can tell which parts a
  change touched.
- **The compiler** turns a spec into one HTML page, byte for byte the same for
  the same spec and runtime version. It writes no code and uses no AI. CloudCrane builds published specs with this same compiler, so
  what you preview is what people will install.

## Packages

| Package                                           | What it is                                                 |
| ------------------------------------------------- | ---------------------------------------------------------- |
| [`@cloudcrane/blackbox`](packages/blackbox)       | The CLI: `extract`, `diff`, `validate`, `build`, `preview` |
| [`@cloudcrane/app-spec`](packages/app-spec)       | The spec's schema, its checks and its rule language        |
| [`@cloudcrane/app-runtime`](packages/app-runtime) | The compiler, and the runtime it puts in every page        |

## Built on standards

Blackbox copies what already exists rather than inventing formats:
[A2UI](https://a2ui.org) v0.9.1 for screens, [CEL](https://cel.dev) for rules,
[DTCG](https://www.designtokens.org) 2025.10 for design tokens, RFC 8785 for
canonical JSON, RFC 6901 for pointers, and [Veridic](https://www.npmjs.com/package/veridic)
for reading code and tracking what a change touched.

## What it reads today

- Flutter themes (colours, by role)
- Pure TypeScript functions, translated to CEL, and the literal examples in their tests
- Everything else (screens, saved data, journeys) from your `blackbox.hints.json`

## Develop

```
pnpm install
pnpm test        # every package, including the compiled page in a real browser (Chrome)
pnpm run build   # dist/ for each package
pnpm run pack:check   # pack, install and run the packages as a user would
```

Node 22.5 or later. MIT licensed.
