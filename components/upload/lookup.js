/**
 * Pure helpers for the "Merge columns from a second file" card (lookup / left join).
 * Lookup shape: lib/schema.js; lookupInfo: CONTRACTS.md section 12.
 */

import { normalizeName } from "@/lib/schema";
import { formatCount, plural } from "./format";

const KEY_HINT = /(^|[^a-z])(id|code|key|no|number|ref|sku)([^a-z]|$)/i;

/**
 * A key worth suggesting: a column whose name appears in both files, preferring names that
 * look like identifiers ("Order ID", "SKU", "Customer No"). When one side already has exactly
 * one column and the other none, only the other side is looked up, by the same name.
 * Nothing is suggested once both sides have a column, or for keys of several columns.
 * @param {{ name: string }[]} mainColumns
 * @param {{ name: string }[]} lookupColumns
 * @param {{ main?: string[], lookup?: string[] }} [current]  chosen key columns (empty strings ignored)
 * @returns {{ mainKeyColumns: string[], lookupKeyColumns: string[] } | null}
 */
export function suggestKeyPair(mainColumns, lookupColumns, current = {}) {
  const main = ((current && current.main) || []).filter(Boolean);
  const other = ((current && current.lookup) || []).filter(Boolean);
  if ((main.length && other.length) || main.length > 1 || other.length > 1) return null;
  const pair = (a, b) => ({ mainKeyColumns: [a], lookupKeyColumns: [b] });
  const find = (columns, name) => {
    const wanted = normalizeName(name);
    const hit = (columns || []).find((column) => normalizeName(column.name) === wanted);
    return hit ? hit.name : null;
  };
  if (main.length) {
    const hit = find(lookupColumns, main[0]);
    return hit ? pair(main[0], hit) : null;
  }
  if (other.length) {
    const hit = find(mainColumns, other[0]);
    return hit ? pair(hit, other[0]) : null;
  }
  const byName = new Map();
  for (const column of lookupColumns || []) {
    const key = normalizeName(column.name);
    if (key && !byName.has(key)) byName.set(key, column.name);
  }
  let fallback = null;
  for (const column of mainColumns || []) {
    const match = byName.get(normalizeName(column.name));
    if (!match) continue;
    if (KEY_HINT.test(column.name)) return pair(column.name, match);
    if (!fallback) fallback = pair(column.name, match);
  }
  return fallback;
}

/**
 * An example of the built key, from the first preview row whose key parts are all filled in.
 * Mirrors lib/lookup.js: parts are trimmed and joined with the separator.
 * @param {{ name: string }[]} columns   the loaded table's columns (previewRows follow this order)
 * @param {string[][]} previewRows       display strings
 * @param {string[]} keyColumns
 * @param {string} separator
 * @returns {string | null}
 */
export function exampleKey(columns, previewRows, keyColumns, separator) {
  const names = (keyColumns || []).filter(Boolean);
  if (!names.length) return null;
  const indexes = names.map((name) => (columns || []).findIndex((column) => column.name === name));
  if (indexes.some((index) => index < 0)) return null;
  for (const row of previewRows || []) {
    const parts = indexes.map((index) => String((row && row[index]) ?? "").replace(/\s+/g, " ").trim());
    if (parts.every(Boolean)) return parts.join(separator);
  }
  return null;
}

/**
 * Which lookup columns can be brought in and which are chosen.
 * `chosen` is Lookup.columns, where [] means every column except the key columns.
 * `keyNames` is the lookup file's key column, or a list of them.
 * @returns {{ candidates: string[], selected: Set<string>, all: boolean }}
 */
export function columnSelection(lookupColumns, keyNames, chosen) {
  const keys = new Set((Array.isArray(keyNames) ? keyNames : [keyNames]).filter(Boolean));
  const candidates = (lookupColumns || []).map((column) => column.name).filter((name) => !keys.has(name));
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
  const mainDuplicates = Number(info.mainDuplicateKeys) || 0;
  const empty = Number(info.emptyKeys) || 0;
  const total = matched + unmatched;
  const added = Array.isArray(info.addedColumns) ? info.addedColumns : [];
  const details = [];
  if (unmatched) details.push(`${plural(unmatched, "row")} without a match (their new cells stay empty)`);
  if (empty) details.push(`${plural(empty, "row")} with an empty key part (never matched)`);
  if (duplicates) {
    details.push(`${plural(duplicates, "duplicate key")} in the second file (the first matching row is used)`);
  }
  if (mainDuplicates) {
    details.push(`${plural(mainDuplicates, "key value")} repeat in this file (each of those rows still gets the match)`);
  }
  const unique = {
    lookup: duplicates === 0,
    main: mainDuplicates === 0,
  };
  return {
    headline: `Matched ${formatCount(matched)} of ${plural(total, "row")}`,
    details,
    added,
    unique,
    keyColumn: info.keyColumn || null,
  };
}
