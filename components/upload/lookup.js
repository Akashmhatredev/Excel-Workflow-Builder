/**
 * Pure helpers for the "Merge columns from a second file" card (lookup / left join).
 * Lookup shape: lib/schema.js; lookupInfo: CONTRACTS.md section 12.
 */

import { normalizeName } from "@/lib/schema";
import { formatCount, plural } from "./format";

const KEY_HINT = /(^|[^a-z])(id|code|key|no|number|ref|sku)([^a-z]|$)/i;

/**
 * A key pair worth suggesting: a column whose name appears in both files, preferring
 * names that look like identifiers ("Order ID", "SKU", "Customer No").
 * @returns {{ matchColumn: string, lookupColumn: string } | null}
 */
export function suggestKeyPair(mainColumns, lookupColumns) {
  const byName = new Map();
  for (const column of lookupColumns || []) {
    const key = normalizeName(column.name);
    if (key && !byName.has(key)) byName.set(key, column.name);
  }
  let fallback = null;
  for (const column of mainColumns || []) {
    const match = byName.get(normalizeName(column.name));
    if (!match) continue;
    const pair = { matchColumn: column.name, lookupColumn: match };
    if (KEY_HINT.test(column.name)) return pair;
    if (!fallback) fallback = pair;
  }
  return fallback;
}

/**
 * Which lookup columns can be brought in and which are chosen.
 * `chosen` is Lookup.columns, where [] means every column except the key.
 * @returns {{ candidates: string[], selected: Set<string>, all: boolean }}
 */
export function columnSelection(lookupColumns, keyName, chosen) {
  const candidates = (lookupColumns || []).map((column) => column.name).filter((name) => name !== keyName);
  const valid = (chosen || []).filter((name) => candidates.includes(name));
  const all = valid.length === 0 || valid.length === candidates.length;
  return { candidates, selected: new Set(all ? candidates : valid), all };
}

/**
 * The next Lookup.columns after ticking or unticking one column, in file order.
 * Returns [] when every column is chosen, and null when the change would leave none.
 */
export function toggleColumn(selection, name, checked) {
  const next = new Set(selection.selected);
  if (checked) next.add(name);
  else next.delete(name);
  const ordered = selection.candidates.filter((candidate) => next.has(candidate));
  if (!ordered.length) return null;
  return ordered.length === selection.candidates.length ? [] : ordered;
}

/**
 * Human summary of lookupInfo, or null when nothing was merged.
 * @returns {{ headline: string, details: string[], added: string[] } | null}
 */
export function describeLookupInfo(info) {
  if (!info || !info.applied) return null;
  const matched = Number(info.matched) || 0;
  const unmatched = Number(info.unmatched) || 0;
  const duplicates = Number(info.duplicateKeys) || 0;
  const total = matched + unmatched;
  const added = Array.isArray(info.addedColumns) ? info.addedColumns : [];
  const details = [];
  if (unmatched) details.push(`${plural(unmatched, "row")} without a match (their new cells stay empty)`);
  if (duplicates) {
    details.push(`${plural(duplicates, "duplicate key")} in the second file (the first matching row is used)`);
  }
  return { headline: `Matched ${formatCount(matched)} of ${plural(total, "row")}`, details, added };
}
