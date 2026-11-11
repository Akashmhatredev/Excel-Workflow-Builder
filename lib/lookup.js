/**
 * lib/lookup.js: the lookup / merge of a second file into the source table (a left join).
 *
 * The lookup table is the one loaded in the worker's "lookup" dataset. Keys match after trimming,
 * collapsing inner spaces and ignoring case; numbers (and unambiguously numeric text) match by value,
 * so 101, "101" and "101.0" are the same key while the code "00101" is not. Dates match their
 * YYYY-MM-DD text. Empty keys never match.
 *
 * A key can be several columns joined with a separator ("Order ID" + "Line" -> "SO-1_2"), on either
 * side, and the two sides may differ: a built key "C001_2024-01-05" matches a lookup column that
 * already holds that text. Each part is trimmed (numbers in plain form, dates as YYYY-MM-DD), the parts
 * are joined, and the joined text is matched like a single key. A key with an empty part never matches.
 *
 * For a key that appears more than once in the lookup table the first row wins; `duplicateKeys`
 * counts the distinct keys that repeat (`mainDuplicateKeys` does the same for the main file, so the
 * UI can say whether the key is unique). The chosen columns ([] = every column except the key
 * columns) are appended to the main table as ordinary source columns with `origin: 'lookup'`; a name
 * that is already taken gets the suffix " (lookup)". With `keyColumnName` set, the main file's built
 * key is also added as a column (`origin: 'key'`), so it can be mapped to outputs.
 */

import { DEFAULT_KEY_SEPARATOR, getLookupKeys, normalizeName, uniqueName } from "./schema.js";
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

const notApplied = () => ({
  applied: false,
  matched: 0,
  unmatched: 0,
  addedColumns: [],
  duplicateKeys: 0,
  mainDuplicateKeys: 0,
  emptyKeys: 0,
  keyColumn: null,
});

/** One part of a multi-column key as display text, or null when it is empty. */
export function keyPartText(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return Number.isFinite(value) ? String(cleanNumber(value) || 0) : null;
  const text = toText(value).replace(/\s+/g, " ").trim();
  if (text === "") return null;
  if (isNumericText(text)) return String(cleanNumber(Number(text.replace(/,/g, ""))) || 0);
  return text;
}

/**
 * Build the key of a row from the values of its key columns.
 * @returns {{ match: string | null, text: string | null }} match = what is compared, text = what is shown
 */
export function buildKey(values, separator = DEFAULT_KEY_SEPARATOR) {
  if (values.length === 1) {
    const match = lookupKey(values[0]);
    return { match, text: match === null ? null : keyPartText(values[0]) };
  }
  const parts = [];
  for (const value of values) {
    const part = keyPartText(value);
    if (part === null) return { match: null, text: null };
    parts.push(part);
  }
  const text = parts.join(separator);
  return { match: lookupKey(text), text };
}

function resolveColumns(finder, names, where, warnings) {
  const out = [];
  for (const name of names) {
    const column = finder.find(name);
    if (!column) {
      warnings.push(`The key column "${name}" was not found in ${where}, so the lookup was not applied.`);
      return null;
    }
    out.push(column);
  }
  return out;
}

/**
 * Left-join `lookupTable` onto `table` in place (new columns are appended to every row).
 *
 * @param {{ columns: object[], rows: any[][] }} table        the main table (from buildTable)
 * @param {{ columns: object[], rows: any[][] } | null} lookupTable  the table of the "lookup" dataset
 * @param {object} lookup  a configured Lookup (lib/schema.js)
 * @returns {{ info: { applied: boolean, matched: number, unmatched: number, addedColumns: string[],
 *             duplicateKeys: number, mainDuplicateKeys: number, emptyKeys: number, keyColumn: string | null },
 *             warnings: string[] }}
 */
export function joinLookup(table, lookupTable, lookup) {
  const warnings = [];
  const info = notApplied();
  const keys = getLookupKeys(lookup);
  const separator = typeof lookup.keySeparator === "string" ? lookup.keySeparator : DEFAULT_KEY_SEPARATOR;

  const mainKey = resolveColumns(createColumnLookup(table.columns), keys.main, "this file", warnings);
  if (!mainKey) return { info, warnings };
  const mainAt = mainKey.map((column) => column.index);

  // Pad short rows once so appended columns line up.
  const base = table.columns.length;
  for (const row of table.rows) for (let c = row.length; c < base; c += 1) row[c] = null;

  // The built key, as text, for every main row (also used for the optional key column).
  const values = new Array(mainAt.length);
  const mainKeys = new Array(table.rows.length);
  const seen = new Set();
  const repeatedMain = new Set();
  let emptyKeys = 0;
  table.rows.forEach((row, r) => {
    for (let i = 0; i < mainAt.length; i += 1) values[i] = row[mainAt[i]];
    const key = buildKey(values, separator);
    mainKeys[r] = key;
    if (key.match === null) emptyKeys += 1;
    else if (seen.has(key.match)) repeatedMain.add(key.match);
    else seen.add(key.match);
  });
  info.emptyKeys = emptyKeys;
  info.mainDuplicateKeys = repeatedMain.size;

  const taken = table.columns.map((column) => column.name);
  const keyColumnName = String(lookup.keyColumnName || "").trim();
  if (keyColumnName) {
    const name = uniqueName(keyColumnName, taken);
    taken.push(name);
    table.columns.push({ name, type: "text", index: table.columns.length, origin: "key" });
    table.rows.forEach((row, r) => {
      row[table.columns.length - 1] = mainKeys[r].text;
    });
    info.keyColumn = name;
  }

  if (!lookupTable) {
    warnings.push("The lookup file is not loaded, so its columns were not added.");
    return { info, warnings };
  }
  const lookupFinder = createColumnLookup(lookupTable.columns);
  const lookupKeyColumns = resolveColumns(lookupFinder, keys.lookup, "the lookup file", warnings);
  if (!lookupKeyColumns) return { info, warnings };
  const lookupAt = lookupKeyColumns.map((column) => column.index);
  const keyIndexes = new Set(lookupAt);

  let chosen;
  const wanted = Array.isArray(lookup.columns) ? lookup.columns.filter(Boolean) : [];
  if (wanted.length) {
    chosen = [];
    for (const name of wanted) {
      const column = lookupFinder.find(name);
      if (!column) warnings.push(`The lookup column "${name}" was not found in the lookup file.`);
      else if (!chosen.some((other) => other.index === column.index)) chosen.push(column);
    }
  } else {
    chosen = lookupTable.columns
      .map((column) => lookupFinder.find(column.name))
      .filter((column) => column && !keyIndexes.has(column.index));
  }

  // Index the lookup rows by key: the first row wins.
  const index = new Map();
  const repeated = new Set();
  const lookupValues = new Array(lookupAt.length);
  for (const row of lookupTable.rows) {
    for (let i = 0; i < lookupAt.length; i += 1) lookupValues[i] = row[lookupAt[i]];
    const key = buildKey(lookupValues, separator).match;
    if (key === null) continue;
    if (index.has(key)) repeated.add(key);
    else index.set(key, row);
  }

  const start = table.columns.length;
  const sources = [];
  chosen.forEach((column, i) => {
    const clash = taken.some((name) => normalizeName(name) === normalizeName(column.name));
    const name = clash ? uniqueName(`${column.name} (lookup)`, taken) : column.name;
    taken.push(name);
    sources.push(column.index);
    table.columns.push({ name, type: column.type || "text", index: start + i, origin: "lookup" });
    info.addedColumns.push(name);
  });

  const width = sources.length;
  let matched = 0;
  table.rows.forEach((row, r) => {
    const key = mainKeys[r].match;
    const hit = key === null ? undefined : index.get(key);
    if (hit) {
      matched += 1;
      for (let i = 0; i < width; i += 1) {
        const value = hit[sources[i]];
        row[start + i] = value === undefined ? null : value;
      }
    } else {
      for (let i = 0; i < width; i += 1) row[start + i] = null;
    }
  });

  info.applied = true;
  info.matched = matched;
  info.unmatched = table.rows.length - matched;
  info.duplicateKeys = repeated.size;
  return { info, warnings };
}
