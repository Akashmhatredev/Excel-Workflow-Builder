import { normalizeName } from "./schema";
import { KEYS, UNKNOWN_MESSAGE, onStorageChange, readJSON, writeJSON } from "./storage";

/**
 * lib/aliases.js: saved column-name aliases, e.g. "Cust Name" = "Customer".
 * Stored as [{ from, to }] under "ewb:v1:aliases". Matching treats a pair as symmetric
 * (see matchColumns in lib/schema.js), so "A = B" and "B = A" are the same alias and only
 * one of them is ever stored. Aliases apply to every template.
 *
 *   loadAliases()                     -> [{ from, to }]   fresh read from storage, cleaned
 *   saveAlias(from, to)               -> { ok, aliases, existed?, code?, error? }
 *   removeAlias(from, to)             -> { ok, aliases, code?, error? }
 *   isSameAlias(alias, from, to)      -> boolean           either direction, case/space-insensitive
 *
 * `code` on a failure: 'invalid' (empty names, the same name twice, too many aliases) or the
 * storage code 'quota' | 'unavailable' | 'unknown'. A failed write changes nothing.
 *
 * React usage (re-renders after a save or remove here, and after a change in another tab):
 *   const aliases = useSyncExternalStore(subscribeAliases, getAliasesSnapshot, getServerAliasesSnapshot);
 */

export const ALIAS_MAX_LENGTH = 120;
export const MAX_ALIASES = 500;

const EMPTY = Object.freeze([]);
const listeners = new Set();
let snapshot = null;
let stopWatchingOtherTabs = null;

const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

/** One line, trimmed, length-capped column name. */
function cleanName(value) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, ALIAS_MAX_LENGTH)
    .trim();
}

/** True when `alias` pairs the same two names as from/to, in either direction. */
export function isSameAlias(alias, from, to) {
  if (!isObject(alias)) return false;
  const a = normalizeName(alias.from);
  const b = normalizeName(alias.to);
  const x = normalizeName(from);
  const y = normalizeName(to);
  return (a === x && b === y) || (a === y && b === x);
}

/** Stored value -> clean list: valid pairs only, no pair twice (in either direction), capped. */
function sanitize(value) {
  const out = [];
  for (const entry of Array.isArray(value) ? value : []) {
    if (!isObject(entry) || typeof entry.from !== "string" || typeof entry.to !== "string") continue;
    const from = cleanName(entry.from);
    const to = cleanName(entry.to);
    if (!from || !to || normalizeName(from) === normalizeName(to)) continue;
    if (out.some((alias) => isSameAlias(alias, from, to))) continue;
    out.push({ from, to });
    if (out.length >= MAX_ALIASES) break;
  }
  return out;
}

function emit() {
  for (const listener of [...listeners]) {
    try {
      listener();
    } catch {
      // a broken listener must not break the others
    }
  }
}

function publish(next) {
  snapshot = next;
  emit();
}

const failure = (result, aliases) => ({
  ok: false,
  code: (result && result.code) || "unknown",
  error: (result && result.message) || UNKNOWN_MESSAGE,
  aliases,
});

export function loadAliases() {
  return sanitize(readJSON(KEYS.aliases, []));
}

/**
 * Add an alias. Saving a pair that already exists (in either direction) changes nothing and
 * returns { ok: true, existed: true }.
 */
export function saveAlias(from, to) {
  const a = cleanName(from);
  const b = cleanName(to);
  const current = loadAliases();
  if (!a || !b) return { ok: false, code: "invalid", error: "Enter both column names.", aliases: current };
  if (normalizeName(a) === normalizeName(b)) {
    return {
      ok: false,
      code: "invalid",
      error: "The two names are the same. Columns already match when only upper/lower case or spaces differ.",
      aliases: current,
    };
  }
  if (current.some((alias) => isSameAlias(alias, a, b))) return { ok: true, existed: true, aliases: current };
  if (current.length >= MAX_ALIASES) {
    return { ok: false, code: "invalid", error: `You can keep at most ${MAX_ALIASES} aliases. Remove some first.`, aliases: current };
  }
  const next = [...current, { from: a, to: b }];
  const result = writeJSON(KEYS.aliases, next);
  if (!result.ok) return failure(result, current);
  publish(next);
  return { ok: true, aliases: next };
}

export function removeAlias(from, to) {
  const current = loadAliases();
  const next = current.filter((alias) => !isSameAlias(alias, from, to));
  if (next.length === current.length) return { ok: true, aliases: current };
  const result = writeJSON(KEYS.aliases, next);
  if (!result.ok) return failure(result, current);
  publish(next);
  return { ok: true, aliases: next };
}

/* ------------------------------------------------------------------ */
/* useSyncExternalStore glue                                            */
/* ------------------------------------------------------------------ */

/** Stable snapshot (re-read only after a change). */
export function getAliasesSnapshot() {
  if (snapshot === null) snapshot = loadAliases();
  return snapshot;
}

export function getServerAliasesSnapshot() {
  return EMPTY;
}

export function subscribeAliases(listener) {
  listeners.add(listener);
  if (!stopWatchingOtherTabs) {
    stopWatchingOtherTabs = onStorageChange(({ name }) => {
      if (name !== KEYS.aliases && name !== null) return;
      snapshot = null;
      emit();
    });
  }
  return () => {
    listeners.delete(listener);
    if (!listeners.size && stopWatchingOtherTabs) {
      stopWatchingOtherTabs();
      stopWatchingOtherTabs = null;
    }
  };
}
