# Roadmap

Planned, none of it built yet. Ranked by least effort for the most impact
(S, M, L, XL), as agreed on 8 Nov 2026. What's built is in the
[README](../README.md).

Already built: gaps, coverage, catalog fallbacks and examples recorded from the
running app (0.7); platform detection (`blackbox init`), the assistant's to-do
list (`blackbox plan`), phone features and capabilities from iOS and Android
manifests, colours from platform resources, and string files (0.8).

## Reading more of the app

| Idea                                                                                                                                                              | Effort   | Impact    | Notes                                                                                                                                                                           |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Sites from network config**: base URLs in Retrofit, Ktor, Dio and axios config; iOS App Transport Security exceptions                                           | M        | High      | Fills `network`, which `sends` hangs off                                                                                                                                        |
| **Saved data from data models**: Room entities, Core Data models (XML), SwiftData `@Model`, Hive adapters, `CREATE TABLE`                                         | M        | High      | Structured; gives "What it keeps" real types, so migrations and personal fields can be checked. Bringing a person's existing data across through a hand-over is the harder half |
| **Journeys from existing UI tests**: Maestro YAML first (one format for iOS, Android, Flutter and React Native), then Espresso, XCUITest and Detox                | M        | Very high | They become journeys and CloudCrane tests, proving behaviour matches                                                                                                            |
| **One widget map across frameworks**: SwiftUI, Compose, Flutter and React are all declarative trees; one table maps each framework's basics onto the A2UI catalog | M        | Very high | Makes each new framework a table plus a parser                                                                                                                                  |
| **Navigation from routers**: Android nav graph XML, GoRouter routes, React Navigation config, SwiftUI `NavigationStack`                                           | M        | High      | The screens and how they connect, read rather than guessed. Needs navigation in the spec too (below)                                                                            |
| **UI-code readers** for Compose, SwiftUI and JSX, on top of the widget map                                                                                        | L each   | High      | In order of partner demand                                                                                                                                                      |
| **Rules in Kotlin, Swift and Dart into CEL**, like the TypeScript reader                                                                                          | M–L each | High      | Dart first: closest to TypeScript                                                                                                                                               |
| **Only re-read what changed** (`extract --changed`), with provenance as the cache                                                                                 | S–M      | Medium    | `diff` already knows what changed                                                                                                                                               |
| **React Native and web theme files** (TypeScript theme objects), beyond CSS variables                                                                             | M        | Medium    | Code, not data, so it needs a reader like Flutter's                                                                                                                             |

## Proving the copy matches

| Idea                                                                                                                                                    | Effort           | Impact      | Notes                                                          |
| ------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- | ----------- | -------------------------------------------------------------- |
| **Screen walk on a real device**: the accessibility tree from Android's `uiautomator`, the iOS simulator or Flutter's semantics tree, into A2UI layouts | L                | Very high   | Works with no source code; the base of the match score         |
| **Match score**: screenshots of the original and the copy compared per screen (`blackbox preview --against <url or apk>`)                               | M after the walk | Very high   | Turns "looks right?" into a number the assistant can work down |
| **Recorded journeys**: someone uses the original while Blackbox records each tap and what appears; they become journeys and tests                       | M–L              | Very high   | Android first (`uiautomator`)                                  |
| **The look from screenshots**: palette, type sizes, spacing, light and dark                                                                             | M                | Medium-High | Shares the match score's screenshots                           |
| **Twin mode**: original and copy side by side in preview, taps mirrored, divergences highlighted                                                        | L                | Medium      | A demo; the match score gives most of the value                |

## Making the copy feel native

| Idea                                                                                           | Effort | Impact      | Notes                        |
| ---------------------------------------------------------------------------------------------- | ------ | ----------- | ---------------------------- |
| **Motion drawn**: the `transition` and `cubicBezier` token types, with reduced-motion versions | M      | Medium-High | Needs a runtime bump         |
| **Navigation in the spec**: tabs, stacks, sheets and back behaviour; deep links as shortcuts   | M–L    | High        | Schema, compiler and runtime |
| **Each phone's own style**: small iOS and Android differences chosen by tokens                 | M–L    | Medium      | After motion and navigation  |
| **Smaller pages**: only the runtime components a spec uses                                     | M      | Medium      | Mind the runtime lock        |

## Keeping ports current

| Idea                                                                                                 | Effort | Impact        | Notes                                 |
| ---------------------------------------------------------------------------------------------------- | ------ | ------------- | ------------------------------------- |
| **`blackbox sync`**: re-extract when the original changes and open a pull request with the spec diff | M–L    | Medium        | Matters once partners have many ports |
| **Shared mappings**: partners contribute widget mappings and coded components, with tests            | L      | Medium, later | Needs vetting and partners first      |

## Further out

- **Cloud device crawls**: Firebase Test Lab or AWS Device Farm robo crawlers walk every screen of an APK and save layout dumps for the screen walk, in one run.
- **A quick start from a store listing**: an App Store or Play Store link gives screenshots, a description and a category, enough to draft a spec for the owner to refine.
- **Deterministic first, AI for the gaps**: readers produce what can be proven, and an assistant fills only what `blackbox plan` lists, each part cited.
- **A spec from a screen recording**: frames into screens, taps into journeys. Research, not a feature yet.
- **One spec, two outputs**: the same spec driving a native shell (Capacitor) for store distribution. A strategic call, not a plan.
