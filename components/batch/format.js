/** Small display helpers for the batch page. */

export const plural = (count, word, many = `${word}s`) => `${formatCount(count)} ${count === 1 ? word : many}`;

export function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function formatCount(value) {
  if (!Number.isFinite(value)) return "";
  try {
    return value.toLocaleString();
  } catch {
    return String(value);
  }
}

/** Today's local date as YYYY-MM-DD (call it from an event handler, not during render). */
export function localDate(now = new Date()) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** "a", "b" and "c" (at most `max` names, then "and N more"). */
export function listNames(names, max = 6) {
  const quoted = names.slice(0, max).map((name) => `"${name}"`);
  const more = names.length - quoted.length;
  if (more > 0) return `${quoted.join(", ")} and ${more} more`;
  if (quoted.length <= 1) return quoted.join("");
  return `${quoted.slice(0, -1).join(", ")} and ${quoted[quoted.length - 1]}`;
}
