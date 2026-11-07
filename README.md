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
  A whole HTML app can be one too, with the page kit: it runs full screen and
  its `localStorage` works, kept by the page. See
  [`fixtures/notes`](fixtures/notes/spec.json).
- **An HTML app is a spec too.** `wrapPage` makes one whose `page` names its
  one page-kit component; the compiler gives back that page exactly as
  written, with no runtime, so the app runs, saves and is tested as it would
  on its own.
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

## What a spec records, and what's checked

A spec says everything about the app in four parts, and `blackbox validate`
checks each. **Problems** stop it building; **warnings** say what would make it
better.

| Part                  | What the spec records                                                                                                                        | Problems                                                                                                                                                                                                                          | Warnings                                                                                                                                                  |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **How it looks**      | Design tokens by role, light and dark (`tokens.dark`); orientation and full screen (`screen`)                                                |                                                                                                                                                                                                                                   | A core colour role missing; text that doesn't read on what it sits on (WCAG 4.5:1), in light or dark; no dark colours; token types the runtime can't draw |
| **What it does**      | Screens with their empty, loading, offline and error states (`screens`); rules (CEL) with their own test cases; journeys, promises and tests | A rule that doesn't give its own examples; an id used twice                                                                                                                                                                       | No empty state for a list; no offline or error state when it talks to a site                                                                              |
| **What it keeps**     | The saved data's JSON Schema, starting data and version; migrations; the fields that are personal (`data.personal`)                          | A schema that isn't one; starting data that doesn't fit it; a migration missing between any two versions; a personal field the data doesn't have                                                                                  |                                                                                                                                                           |
| **What it can reach** | Each site, why, and what it's sent (`network[].sends`, required); the phone features it uses (`uses`)                                        | A coded or page component naming a site, or using a feature, the spec doesn't list; an address built while it runs; Bluetooth, direct connections, USB or payments; secrets, paths, code or personal details anywhere in the spec |                                                                                                                                                           |

`blackbox preview` serves the app as CloudCrane does: its content security
policy, and a Permissions-Policy allowing only the features it declares.

## What it reads today

- Flutter themes (colours by role, light and dark)
- Pure TypeScript functions, translated to CEL, and the literal examples in their tests
- Everything else from your `blackbox.hints.json`: the screens and their states, saved data, the sites with what each is sent, the phone features it uses, the orientation, journeys and promises

## Develop

```
pnpm install
pnpm test        # every package, including the compiled page in a real browser (Chrome)
pnpm run build   # dist/ for each package
pnpm run pack:check   # pack, install and run the packages as a user would
```

Node 22.5 or later. MIT licensed.
