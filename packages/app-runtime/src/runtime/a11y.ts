// A2UI (web_core 0.14) puts a component's accessibility label on its outer
// custom element, which has no role, so assistive technology never reads it:
// a Button labelled "Remove this exercise" is announced by its text ("×").
// Until A2UI sets it on the control itself, this copies an A2UI element's
// aria-label (and aria-description) onto the first control inside it, if that
// control has no name of its own. Generic: it knows no component by name.

const CONTROL = "button, input, select, textarea, [role=button], [role=checkbox]";

export function bridgeLabels(root: ParentNode): void {
  for (const host of root.querySelectorAll<HTMLElement>("[aria-label]")) {
    if (!host.tagName.startsWith("A2UI-")) continue;
    const control = host.querySelector<HTMLElement>(CONTROL);
    if (!control || control.hasAttribute("aria-label") || control.hasAttribute("aria-labelledby")) continue;
    control.setAttribute("aria-label", host.getAttribute("aria-label")!);
    const description = host.getAttribute("aria-description");
    if (description && !control.hasAttribute("aria-description")) control.setAttribute("aria-description", description);
  }
}

/** Keeps bridging as the surface redraws. */
export function watchLabels(root: HTMLElement): void {
  bridgeLabels(root);
  new MutationObserver(() => bridgeLabels(root)).observe(root, { subtree: true, childList: true, attributes: true, attributeFilter: ["aria-label"] });
}
