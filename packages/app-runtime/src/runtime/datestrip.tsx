import { useEffect, useRef } from "preact/hooks";
import { z } from "zod";
import { CommonSchemas } from "@a2ui/web_core/v0_9";
import { createComponentImplementation } from "@a2ui/react/v0_9";

// DateStrip, the CloudCrane catalog's one widget so far: the last `days` days
// as chips, oldest on the left, today on the right (scrolled into view), the
// selected one filled, each with a status dot. Styled from A2UI's theme
// variables, so a spec's tokens restyle it like any basic component. Status
// colours: complete green, partial yellow, incomplete red, active the primary.

export const DateStripApi = {
  name: "DateStrip",
  schema: z.object({
    days: z.number().int().min(2).max(60).optional(),
    today: CommonSchemas.DynamicString,
    value: CommonSchemas.DynamicString,
    statuses: CommonSchemas.DynamicValue.optional(),
  }),
};

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const DOT: Record<string, string> = {
  complete: "var(--a2ui-color-success, #10b981)",
  partial: "var(--a2ui-color-warning, #fbbf24)",
  incomplete: "var(--a2ui-color-error, #ef4444)",
  active: "var(--a2ui-color-primary)",
};

const parse = (s: string) => {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(Date.UTC(y!, m! - 1, d!));
};
const iso = (t: Date) => t.toISOString().slice(0, 10);

export const DateStrip = createComponentImplementation(DateStripApi, ({ props }: { props: unknown }) => {
  const p = props as { days?: number; today?: string; value?: string; setValue?: (v: string) => void; statuses?: unknown };
  const strip = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (strip.current) strip.current.scrollLeft = strip.current.scrollWidth;
  }, []);
  const today = typeof p.today === "string" && /^\d{4}-\d{2}-\d{2}$/.test(p.today) ? p.today : iso(new Date());
  const count = p.days ?? 14;
  const end = parse(today);
  const days = Array.from({ length: count }, (_, i) => iso(new Date(end.getTime() - (count - 1 - i) * 86_400_000)));
  const status = new Map<string, string>();
  if (Array.isArray(p.statuses))
    for (const s of p.statuses as { day?: unknown; status?: unknown }[])
      if (typeof s?.day === "string" && typeof s?.status === "string") status.set(s.day, s.status);

  return (
    <div class="cc-datestrip" ref={strip} role="group" aria-label="Days">
      {days.map((day) => {
        const d = parse(day);
        const on = day === p.value;
        const isToday = day === today;
        const dot = status.get(day);
        return (
          <button
            key={day}
            type="button"
            class={`cc-day${on ? " cc-on" : ""}${isToday ? " cc-today" : ""}`}
            aria-pressed={on}
            aria-label={`${isToday ? "Today, " : ""}${WEEKDAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}${dot ? `, ${dot}` : ""}`}
            onClick={() => p.setValue?.(day)}
          >
            <span class="cc-wd">{isToday ? "Today" : WEEKDAYS[d.getUTCDay()]}</span>
            <span class="cc-n">{d.getUTCDate()}</span>
            <span class="cc-dot" style={{ background: dot ? (on && dot === "active" ? "var(--a2ui-color-on-primary, #fff)" : DOT[dot]) : "transparent" }} />
          </button>
        );
      })}
    </div>
  );
});
