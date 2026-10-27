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
  with (`@cloudcrane/app-runtime@0.1.0+<hash>`); it throws `CompileError`
  listing every problem when the spec doesn't validate.
- Each runtime version is locked to one bundle hash (`runtime-lock.json`), so a
  version always draws apps the same way.
- `@cloudcrane/app-runtime/host`: what a host publishing spec apps needs in one
  import (validate, compile, derive the blueprint).

The runtime inlined in every page includes code from other open-source
packages; their licences are in `THIRD_PARTY_LICENSES.txt`. `zod` 3.25 is a
peer dependency. MIT licensed.
