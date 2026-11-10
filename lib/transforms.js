/**
 * lib/transforms.js (owner: Agent A). STUB: see CONTRACTS.md for the contract.
 * Pure value transforms. No DOM, no worker, no SheetJS imports.
 */

export function isEmpty(value) {
  return value === null || value === undefined || (typeof value === "string" && value.trim() === "");
}

export function toNumber(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const n = Number(String(value ?? "").replace(/,/g, ""));
  return Number.isFinite(n) && String(value ?? "").trim() !== "" ? n : null;
}

export function toDate(value) {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  return null;
}

export function toText(value) {
  return value == null ? "" : String(value);
}

export function formatNumber(value) {
  return toText(value);
}

export function formatDate(value) {
  return toText(value);
}

export function applyTransform(value) {
  return value;
}

export function applyTransforms(value) {
  return value;
}

export function formatDisplay(value) {
  return toText(value);
}
