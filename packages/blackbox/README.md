# @cloudcrane/blackbox

The Blackbox CLI: write a CloudCrane app spec from your app's code, check it,
and build or preview the app it describes. See the
[Blackbox repo](https://github.com/cloudcrane-dev/blackbox) for what a spec is.

```
npx @cloudcrane/blackbox extract . --hints blackbox.hints.json --out blackbox/plans
npx @cloudcrane/blackbox validate blackbox/plans/spec.json
npx @cloudcrane/blackbox build blackbox/plans/spec.json --out app.html
npx @cloudcrane/blackbox preview blackbox/plans/spec.json
npx @cloudcrane/blackbox diff . --range main..HEAD
```

| Command                | What it does                                                                                   |
| ---------------------- | ---------------------------------------------------------------------------------------------- |
| `extract <repo>`       | Writes `spec.json`, `provenance.json` and `report.md` from your code and `blackbox.hints.json` |
| `diff <repo>`          | Lists the parts of the spec whose cited code changed                                           |
| `validate <spec.json>` | Checks the schema, the A2UI screens, the rules against their examples, and for leaked code     |
| `build <spec.json>`    | Builds the app page; the same bytes every time                                                 |
| `preview <spec.json>`  | Serves the app locally under CloudCrane's content security policy                              |

Extraction runs on your machine. It reads your code; it never runs it and sends
nothing anywhere. Keep `provenance.json` and `blackbox.hints.json` to yourself:
they name your files.

Node 22.5 or later. MIT licensed.
