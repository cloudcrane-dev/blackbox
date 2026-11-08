import { USE_NAMES, type Use } from "./uses.js";

// What only a page spec (an HTML app as a spec) can declare: CloudCrane gives it to the app's page, never to its
// screens or a frame. Kept out of uses.ts, which the runtime bundles (and locks by hash): none of these needs a
// browser feature, so the runtime has nothing to do with them.
// - notifications: reminders at a time, through CloudCrane's ccRemind.

export const PAGE_ONLY = ["notifications"] as const;
export type PageOnlyUse = (typeof PAGE_ONLY)[number];

/** Every name `uses` can declare: the device features, then what only a page spec can. */
export const DECLARABLE = [...USE_NAMES, ...PAGE_ONLY] as [Use | PageOnlyUse, ...(Use | PageOnlyUse)[]];
export type Declarable = (typeof DECLARABLE)[number];
