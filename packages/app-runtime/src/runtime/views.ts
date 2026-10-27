import type { Model } from "./actions.js";

// A spec's two-way views (data.views): `path` shows the data at `source`, a
// pointer with A2UI's ${/path} interpolation (/saved/days/${/ui/selected}).
// After any change, each view compares itself with what it last synced: if the
// view changed (the person ticked or added something through it) the edit goes
// back to its source; otherwise the view is refreshed from the source (the
// selection moved, or the saved data changed). So the order changes arrive in
// can never overwrite an edit. A view of nothing yet shows an empty list, and
// stays nothing until something is added through it.

export type View = { path: string; source: string };

const escapePointer = (s: string) => s.replace(/~/g, "~0").replace(/\//g, "~1");
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const copy = <T>(v: T): T => (v === undefined ? v : (structuredClone(v) as T));

export function resolveSource(source: string, model: Model): string {
  return source.replace(/\$\{(\/[^}]*)\}/g, (_, p: string) => escapePointer(String(model.get(p) ?? "")));
}

export class ViewSync {
  private last = new Map<string, { source: string; value: unknown }>();
  constructor(private readonly views: View[]) {}

  /** Brings every view and its source into step; returns whether anything was written. */
  sync(model: Model): boolean {
    let wrote = false;
    for (const view of this.views) {
      const source = resolveSource(view.source, model);
      const shown = model.get(view.path);
      const before = this.last.get(view.path);
      const editedHere = before !== undefined && before.source === source && !same(shown, before.value);
      if (editedHere) {
        const stored = model.get(source);
        const emptyOverNothing = stored === undefined && Array.isArray(shown) && shown.length === 0;
        if (!emptyOverNothing && !same(stored, shown)) {
          model.set(source, copy(shown));
          wrote = true;
        }
        this.last.set(view.path, { source, value: copy(shown) });
      } else {
        const stored = model.get(source);
        const value = stored === undefined ? [] : stored;
        if (!same(shown, value)) {
          model.set(view.path, copy(value));
          wrote = true;
        }
        this.last.set(view.path, { source, value: copy(value) });
      }
    }
    return wrote;
  }
}
