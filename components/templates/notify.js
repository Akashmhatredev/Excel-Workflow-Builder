import { KEYS } from "@/lib/storage";
import { toast } from "@/lib/toast";

/**
 * Toasts for storage problems, shared by StorageBridge (background failures such
 * as the draft autosave) and by the template UI (a failed save, rename, import).
 *
 * The same failure is usually reported twice: once by the storage layer's
 * onStorageError listener and once by the action that returns { ok: false }.
 * Everything goes through notifyStorageError so the user sees one toast:
 *  - background reports are shown at most once every 30 s per kind of failure
 *    (the autosave retries on every edit and must not spam)
 *  - a report caused by something the user just did is always shown, unless
 *    the very same failure was announced a moment ago
 */

const STORAGE_CODES = new Set(["quota", "unavailable", "unknown"]);
const BACKGROUND_QUIET_MS = 30_000;
const ACTION_QUIET_MS = 1_500;

const lastShown = new Map(); // code -> time of the last toast

export function isStorageFailure(code) {
  return STORAGE_CODES.has(code);
}

function describe(code, key, detail) {
  if (code === "quota") {
    const advice = "Delete some templates (or export them as JSON first) to make room.";
    if (key === KEYS.draft) {
      return { title: "Browser storage is full", description: `Your work in progress is no longer being autosaved. ${advice}` };
    }
    if (key === KEYS.templates) {
      return { title: "Browser storage is full", description: `Your templates were not changed. ${advice}` };
    }
    if (key === KEYS.aliases) {
      return { title: "Browser storage is full", description: `Your column aliases were not changed. ${advice}` };
    }
    return { title: "Browser storage is full", description: advice };
  }
  if (code === "unavailable") {
    return {
      title: "Browser storage is not available",
      description:
        "This looks like a private window, or site data is blocked. Templates and drafts cannot be saved here, but you can still build a workflow and export files.",
    };
  }
  const reason = detail && detail.error && typeof detail.error.message === "string" ? detail.error.message : "";
  return { title: "Could not save to browser storage", description: reason || "Please try again." };
}

/**
 * Show a toast for a storage failure. detail = { code, key?, message?, error? } (the onStorageError payload).
 * Pass { userAction: true } when the user is waiting for the result of something they just did.
 * Returns true when a toast was shown.
 */
export function notifyStorageError(detail, { userAction = false } = {}) {
  const code = detail && STORAGE_CODES.has(detail.code) ? detail.code : "unknown";
  const now = Date.now();
  const last = lastShown.get(code);
  const quiet = userAction ? ACTION_QUIET_MS : BACKGROUND_QUIET_MS;
  if (last !== undefined && now - last < quiet) return false;
  lastShown.set(code, now);
  const { title, description } = describe(code, detail && detail.key, detail);
  toast.error(title, { description });
  return true;
}

/**
 * Report a failed template-store action ({ ok: false, error, code }).
 * Storage failures share the de-duplicated storage toast; anything else gets `title` + the error text.
 */
export function reportFailure(result, title) {
  if (result && isStorageFailure(result.code)) {
    notifyStorageError({ code: result.code, key: KEYS.templates, message: result.error }, { userAction: true });
    return;
  }
  toast.error(title, { description: (result && result.error) || undefined });
}

/**
 * Ref callback for the control a <Modal> should focus when it opens. The native
 * <dialog> looks for the `autofocus` attribute, which React's autoFocus prop does
 * not render on the client.
 */
export function focusOnOpen(node) {
  if (node) node.setAttribute("autofocus", "");
}
