# @cloudcrane/app-spec

The CloudCrane app spec: its schema, the checks a spec must pass, and the
rule language its logic is written in.

```js
import { validateSpec, deriveBlueprint } from "@cloudcrane/app-spec";

const { spec, problems } = validateSpec(JSON.parse(text));
if (!spec) for (const p of problems) console.log(`${p.at}: ${p.problem}`);
```

- `validateSpec(input)`: the schema, the A2UI surface against its catalog, every
  rule parses and reproduces its examples, and the leak scan (paths, code,
  secrets, personal details). Each problem names its JSON Pointer.
- `deriveBlueprint(spec)`: the blueprint CloudCrane shows for an app (its purpose, screens, data,
  journeys and promises), from the spec.
- `Rules` (`@cloudcrane/app-spec/logic`): evaluates a spec's CEL rules, with
  date functions and a bounded `fold`.
- `@cloudcrane/app-spec/schema.json`: the spec as JSON Schema (2020-12).

`zod` 3.25 is a peer dependency. Includes A2UI v0.9.1's schemas, unchanged,
under the Apache License 2.0 (`vendor/a2ui`). MIT licensed.
