import { basicCatalog } from "@a2ui/web_core/v0_9/basic_catalog";
import { createComponentImplementation } from "@a2ui/react/v0_9";

// A2UI's TextField, with its label tied to its input. A2UI's basic text field
// (web_core 0.14) puts <label> beside <input> without linking them, so screen
// readers announce an unnamed field (axe: "label"). This keeps A2UI's own API
// (its name and schema from the basic catalog: label, value, variant, checks)
// and renders the input inside its label, the plain HTML way to name it.
// Drop it once A2UI's own field links them.

const api = basicCatalog.components.get("TextField")!;

type Props = {
  label?: string;
  value?: string;
  setValue?: (v: string) => void;
  variant?: "shortText" | "longText" | "number" | "obscured";
  isValid?: boolean;
  validationErrors?: string[];
};

export const TextField = createComponentImplementation(api as never, ({ props }: { props: unknown }) => {
  const p = props as Props;
  const type = p.variant === "number" ? "number" : p.variant === "obscured" ? "password" : "text";
  const invalid = p.isValid === false;
  const onInput = (e: Event) => p.setValue?.((e.target as HTMLInputElement).value);
  return (
    <label class={`cc-field${invalid ? " cc-invalid" : ""}`}>
      {p.label ? <span class="cc-field-label">{p.label}</span> : null}
      {p.variant === "longText" ? (
        <textarea value={p.value ?? ""} onInput={onInput} aria-invalid={invalid || undefined} />
      ) : (
        <input type={type} inputMode={type === "number" ? "numeric" : undefined} value={p.value ?? ""} onInput={onInput} aria-invalid={invalid || undefined} />
      )}
      {invalid && p.validationErrors?.length ? <span class="cc-field-error">{p.validationErrors[0]}</span> : null}
    </label>
  );
});
