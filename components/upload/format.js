/** Small display formatters shared by the Upload and Mapping steps. */

const COUNT = new Intl.NumberFormat("en-US");

/** 12345 -> "12,345" */
export function formatCount(value) {
  const number = Number(value);
  return Number.isFinite(number) ? COUNT.format(number) : "0";
}

/** plural(1, "row") -> "1 row"; plural(1234, "row") -> "1,234 rows" */
export function plural(count, singular, pluralForm = `${singular}s`) {
  return `${formatCount(count)} ${Number(count) === 1 ? singular : pluralForm}`;
}

/** 1536 -> "1.5 KB" */
export function formatBytes(bytes) {
  const size = Number(bytes);
  if (!Number.isFinite(size) || size < 0) return "";
  if (size < 1024) return `${size} B`;
  const units = ["KB", "MB", "GB"];
  let value = size / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value >= 100 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`;
}
