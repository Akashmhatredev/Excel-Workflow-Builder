/**
 * Copy text to the clipboard. Resolves to true when it worked, false otherwise (never rejects).
 *
 * Uses the async Clipboard API when it is there and allowed. Otherwise it selects `fallbackElement`
 * (a textarea or input that shows the same text: inside a modal <dialog> anything outside the dialog
 * is inert, so a temporary element appended to <body> cannot be selected) and runs the old
 * execCommand("copy").
 */
export async function copyText(text, { fallbackElement = null } = {}) {
  const value = String(text ?? "");
  try {
    if (typeof navigator !== "undefined" && navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
      await navigator.clipboard.writeText(value);
      return true;
    }
  } catch {
    // permission refused or no user activation left: try the fallback
  }
  if (typeof document === "undefined") return false;
  let element = fallbackElement;
  let temporary = false;
  try {
    if (!element) {
      element = document.createElement("textarea");
      element.value = value;
      element.setAttribute("readonly", "");
      element.style.position = "fixed";
      element.style.opacity = "0";
      element.style.pointerEvents = "none";
      document.body.appendChild(element);
      temporary = true;
    }
    element.focus();
    element.select();
    return Boolean(document.execCommand && document.execCommand("copy"));
  } catch {
    return false;
  } finally {
    if (temporary && element) element.remove();
  }
}
