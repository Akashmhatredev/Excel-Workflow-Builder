/**
 * lib/lookup.js: the lookup / merge of a second file into the source table (a left join).
 *
 * The lookup table is the one loaded in the worker's "lookup" dataset. Keys match after trimming,
 * collapsing inner spaces and ignoring case; numbers (and unambiguously numeric text) match by value,
 * so 101, "101" and "101.0" are the same key while the code "00101" is not. Dates match their
 * YYYY-MM-DD text. Empty keys never match.
 *
 * For a key that appears more than once in the lookup table the first row wins; `duplicateKeys`
 * counts the distinct keys that repeat. The chosen columns ([] = every column except the key) are
 * appended to the main table as ordinary source columns with `origin: 'lookup'`; a name that is
 * already taken gets the suffix " (lookup)".
 */

import { normalizeName, uniqueName } from "./schema.js";
import { cleanNumber, isNumericText, toText } from "./transforms.js";
import { createColumnLookup } from "./validate.js";

/** The value a key is matched by, or null for an empty key. */
export function lookupKey(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return Number.isFinite(value) ? `\u0000${cleanNumber(value) || 0}` : null;
  const text = toText(value).replace(/\s+/g, " ").trim();
  if (text === "") return null;
  if (isNumericText(text)) return `\u0000${cleanNumber(Number(text.replace(/,/g, ""))) || 0}`;
  return text.toLowerCase();
}

const notApplied = () => ({ applied: false, matched: 0, unmatched: 0, addedColumns: [], duplicateKeys: 0 });

/**
 * Left-join `lookupTable` onto `table` in place (new columns are appended to every row).
 *
 * @param {{ columns: object[], rows: any[][] }} table        the main table (from buildTable)
 * @param {{ columns: object[], rows: any[][] } | null} lookupTable  the table of the "lookup" dataset
 * @param {object} lookup  a configured Lookup (lib/schema.js)
 * @returns {{ info: { applied: boolean, matched: number, unmatched: number, addedColumns: string[], duplicateKeys: number },
 *             warnings: string[] }}
 */
export function joinLookup(table, lookupTable, lookup) {
  const warnings = [];
  const info = notApplied();
  if (!lookupTable) {
    warnings.push("The lookup file is not loaded, so its columns were not added.");
    return { info, warnings };
  }
  const matchColumn = createColumnLookup(table.columns).find(lookup.matchColumn);
  if (!matchColumn) {
    warnings.push(`The match column "${lookup.matchColumn}" was not found in this file, so the lookup was not applied.`);
    return { info, warnings };
  }
  const lookupColumns = createColumnLookup(lookupTable.columns);
  const keyColumn = lookupColumns.find(lookup.lookupColumn);
  if (!keyColumn) {
    warnings.push(`The key column "${lookup.lookupColumn}" was not found in the lookup file, so the lookup was not applied.`);
    return { info, warnings };
  }

  let chosen;
  const wanted = Array.isArray(lookup.columns) ? lookup.columns.filter(Boolean) : [];
  if (wanted.length) {
    chosen = [];
    for (const name of wanted) {
      const column = lookupColumns.find(name);
      if (!column) warnings.push(`The lookup column "${name}" was not found in the lookup file.`);
      else if (!chosen.some((other) => other.index === column.index)) chosen.push(column);
    }
  } else {
    chosen = lookupTable.columns
      .map((column) => lookupColumns.find(column.name))
      .filter((column) => column && column.index !== keyColumn.index);
  }

  // Index the lookup rows by key: the first row wins.
  const index = new Map();
  const repeated = new Set();
  const keyAt = keyColumn.index;
  for (const row of lookupTable.rows) {
    const key = lookupKey(row[keyAt]);
    if (key === null) continue;
    if (index.has(key)) repeated.add(key);
    else index.set(key, row);
  }

  const taken = table.columns.map((column) => column.name);
  const base = table.columns.length;
  const sources = [];
  chosen.forEach((column, i) => {
    const clash = taken.some((name) => normalizeName(name) === normalizeName(column.name));
    const name = clash ? uniqueName(`${column.name} (lookup)`, taken) : column.name;
    taken.push(name);
    sources.push(column.index);
    table.columns.push({ name, type: column.type || "text", index: base + i, origin: "lookup" });
    info.addedColumns.push(name);
  });

  const width = sources.length;
  const matchAt = matchColumn.index;
  let matched = 0;
  for (const row of table.rows) {
    for (let c = row.length; c < base; c += 1) row[c] = null;
    const key = lookupKey(row[matchAt]);
    const hit = key === null ? undefined : index.get(key);
    if (hit) {
      matched += 1;
      for (let i = 0; i < width; i += 1) {
        const value = hit[sources[i]];
        row[base + i] = value === undefined ? null : value;
      }
    } else {
      for (let i = 0; i < width; i += 1) row[base + i] = null;
    }
  }

  info.applied = true;
  info.matched = matched;
  info.unmatched = table.rows.length - matched;
  info.duplicateKeys = repeated.size;
  return { info, warnings };
}
