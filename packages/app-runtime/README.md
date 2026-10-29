# @cloudcrane/app-runtime

Builds a CloudCrane app spec into one HTML page: the same bytes for the same
spec and runtime version, every time. It writes no code and uses no AI: it
checks the spec, turns its tokens into CSS, puts the spec in the page as data,
and inlines the runtime that draws it with A2UI's renderer.

```js
import { compile } from "@cloudcrane/app-runtime";

const { html, sha256, runtime } = compile(spec);
```

- `compile(spec)` returns the page, its sha256 and the runtime it was built
  with (`@cloudcrane/app-runtime@0.3.0+<hash>`); it throws `CompileError`
  listing every problem when the spec doesn't validate.
- `compile(spec, { runtime: "shared" })` links the runtime instead of inlining
  it: the page names `runtimeFile().path` (`/_cc/runtime/<version>-<hash>.js`)
  with an integrity hash, so a host serves one copy to every spec app and a
  browser runs nothing but those bytes. The page is then a few KB. Inline is
  the default, for a page that stands alone.
- Each runtime version is locked to one bundle hash (`runtime-lock.json`), so a
  version always draws apps the same way. The runtime's version
  (`runtimeVersion` in package.json) moves only when the bundle does; the
  package can release without it.
- A coded component runs in a frame that's sandboxed (scripts only, so it has
  no storage and nothing of the page's), in a closed shadow root, reached only
  through a `MessagePort`. Under CloudCrane's lockdown the lockdown makes the
  frame (`window.__ccFrame`); elsewhere the runtime makes the same kind. The
  page drives it: a seed and the inputs, then its clock each frame, paused
  while hidden. The game kit turns that clock into fixed steps, so a game moves
  the same way for the same time and seed:

  ```js
  game.start({ rate: 6, setup() {}, step() {}, draw(g, width, height) {} });
  game.on("swipe", (dir) => {}); // also "tap" and "input"
  game.state = { score }; // shown at /ui/coded/<id>/state
  game.emit("over", { score }); // the screen's action for "over" runs
  game.random(); // seeded by the page
  ```

  The page kit runs an HTML page as it is, full screen. Its `localStorage`
  works: what it holds is written into the frame when it opens, and each
  change goes to the page, which keeps it under `<data.key>.coded.<id>` (at
  most 4 MB), so it survives a reload and an update and the frame sees only
  its own. Both kits reach the page through `window.__ccBus`.

- `@cloudcrane/app-runtime/host`: what a host publishing spec apps needs in one
  import (validate, compile, derive the blueprint).

The runtime inlined in every page includes code from other open-source
packages; their licences are in `THIRD_PARTY_LICENSES.txt`. `zod` 3.25 is a
peer dependency. MIT licensed.
