// The CloudCrane catalog widgets' CSS, apart from their components so the compiler
// (in Node) never loads the renderer. Styled from A2UI's theme variables.

export const DATESTRIP_CSS = `.cc-datestrip{display:flex;gap:8px;overflow-x:auto;padding:2px 0 6px;scrollbar-width:none}.cc-datestrip::-webkit-scrollbar{display:none}
.cc-day{flex:0 0 48px;height:64px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:3px;border-radius:var(--a2ui-border-radius,12px);border:1px solid var(--a2ui-color-border);background:var(--a2ui-color-surface);color:var(--a2ui-color-on-surface);font:inherit;cursor:pointer;padding:0}
.cc-day .cc-wd{font-size:9.5px;font-weight:700;opacity:.65}.cc-day.cc-today .cc-wd{font-size:8.5px}.cc-day .cc-n{font-size:15px;font-weight:800}.cc-day .cc-dot{width:5px;height:5px;border-radius:50%}
.cc-day.cc-today{border:1.5px solid color-mix(in srgb,var(--a2ui-color-primary) 50%,transparent)}.cc-day.cc-on{background:var(--a2ui-color-primary);border-color:var(--a2ui-color-primary);color:var(--a2ui-color-on-primary,#fff)}.cc-day.cc-on .cc-wd{opacity:1}
.cc-day:focus-visible{outline:2px solid var(--a2ui-color-primary);outline-offset:2px}
.cc-field{display:flex;flex-direction:column;gap:4px;margin:var(--a2ui-spacing-s,6px) 0;font-size:var(--a2ui-label-font-size,13px);font-weight:var(--a2ui-label-font-weight,600);color:var(--a2ui-color-on-surface)}
.cc-field input,.cc-field textarea{font:inherit;font-weight:400;font-size:16px;min-height:44px;padding:var(--a2ui-textfield-padding,10px 12px);color:var(--a2ui-color-on-input);background:var(--a2ui-color-input);border:var(--a2ui-textfield-border,1px solid var(--a2ui-color-border));border-radius:var(--a2ui-textfield-border-radius,10px);width:100%}
.cc-field input:focus-visible,.cc-field textarea:focus-visible{outline:2px solid var(--a2ui-textfield-color-border-focus,var(--a2ui-color-primary));outline-offset:1px}
.cc-field.cc-invalid input,.cc-field.cc-invalid textarea{border-color:var(--a2ui-textfield-color-error,var(--a2ui-color-error))}.cc-field-error{font-weight:400;color:var(--a2ui-textfield-color-error,var(--a2ui-color-error))}`;

export const CODED_CSS = `.cc-coded{display:block;width:100%;overflow:hidden;border-radius:var(--a2ui-border-radius,12px);background:var(--a2ui-color-surface);border:1px solid var(--a2ui-color-border)}
.cc-coded.cc-page{position:fixed;inset:0;z-index:1;border:0;border-radius:0;background:transparent}`;
