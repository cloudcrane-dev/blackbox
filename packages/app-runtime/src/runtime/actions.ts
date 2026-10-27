// The CloudCrane catalog's local actions (set, push, removeAt, batch), over a
// minimal view of A2UI's data model so they can be tested without a browser.
// Paths are JSON Pointers; a list that isn't there yet is created by push.

export interface Model {
  get(path: string): unknown;
  set(path: string, value: unknown): void;
}

export type Step = { op: "set" | "push" | "removeAt"; path: string; value?: unknown };

const copy = <T>(v: T): T => (v === undefined ? v : (structuredClone(v) as T));

export function runStep(model: Model, step: Step, index: number | undefined): void {
  if (typeof step.path !== "string" || !step.path.startsWith("/")) return;
  if (step.op === "set") model.set(step.path, copy(step.value));
  else if (step.op === "push") {
    const list = model.get(step.path);
    model.set(step.path, [...(Array.isArray(list) ? list : []), copy(step.value)]);
  } else if (step.op === "removeAt") {
    const list = model.get(step.path);
    if (!Array.isArray(list) || index === undefined || index < 0 || index >= list.length) return;
    const next = list.slice();
    next.splice(index, 1);
    model.set(step.path, next);
  }
}

export function runSteps(model: Model, steps: Step[], index: number | undefined): void {
  for (const s of steps) runStep(model, s, index);
}
