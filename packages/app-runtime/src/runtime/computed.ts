import type { Rules } from "@cloudcrane/app-spec/logic";

// A spec's computed values: each a data-model pointer and the CEL that works it
// out from what's saved, the screen's state and today. Worked out again after
// every change; a value only written when it changed, so screens don't redraw
// for nothing.

export type Env = { saved: unknown; ui: unknown; today: string };

export function computeAll(rules: Rules, computed: Record<string, string>, env: Env): [string, unknown][] {
  return Object.keys(computed)
    .sort()
    .map((pointer): [string, unknown] => [pointer, rules.evaluate(computed[pointer]!, env)]);
}

/** Today on this phone, as YYYY-MM-DD in its own time zone. */
export function localToday(now: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}
