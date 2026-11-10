import { normalizeName } from "./schema";
import { KEYS, readJSON, writeJSON } from "./storage";

/**
 * Saved column-name aliases, e.g. "Cust Name" = "Customer".
 * Stored as [{ from, to }]; matching treats a pair as symmetric (see matchColumns in schema.js).
 */

export function loadAliases() {
  const value = readJSON(KEYS.aliases, []);
  return Array.isArray(value)
    ? value.filter((a) => a && typeof a.from === "string" && typeof a.to === "string" && a.from && a.to)
    : [];
}

/** Adds (or replaces) an alias. Returns { ok, aliases } (ok is false when storage rejected the write). */
export function saveAlias(from, to) {
  const a = String(from ?? "").trim();
  const b = String(to ?? "").trim();
  if (!a || !b || normalizeName(a) === normalizeName(b)) return { ok: true, aliases: loadAliases() };
  const aliases = loadAliases().filter(
    (alias) => !(normalizeName(alias.from) === normalizeName(a) && normalizeName(alias.to) === normalizeName(b)),
  );
  aliases.push({ from: a, to: b });
  const result = writeJSON(KEYS.aliases, aliases);
  return { ok: result.ok, aliases };
}

export function removeAlias(from, to) {
  const aliases = loadAliases().filter(
    (alias) => !(normalizeName(alias.from) === normalizeName(from) && normalizeName(alias.to) === normalizeName(to)),
  );
  const result = writeJSON(KEYS.aliases, aliases);
  return { ok: result.ok, aliases };
}
