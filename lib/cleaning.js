/**
 * lib/cleaning.js: the data-cleaning step of the pipeline.
 *
 * Order inside the pipeline: map fields -> filter -> clean -> group -> sort -> project.
 * Cleaning works on the mapped field values of each row that passed the filter, in this order:
 *
 *   1. trimText         trim and collapse spaces in every text value (a value that ends up empty becomes null)
 *   2. removeEmptyRows  drop rows whose mapped fields are all empty
 *   3. fillBlanks       fill empty values with a fixed value, or with the last non-empty value above
 *   4. removeDuplicates drop rows whose key fields (every field when `keys` is []) repeat an earlier row;
 *                       text compares ignoring case (like Excel's Remove Duplicates), the first row wins
 *
 * Fills run before duplicates are removed, so rows that only differ by a blank that was filled count
 * as duplicates. Fills made on a row that is then removed as a duplicate are not counted.
 *
 * "Every field" always means every field of the definition, not only the ones an output keeps,
 * so all outputs of a workflow see the same cleaned rows.
 */

import { coerceDefault, coerceForFormat, isEmpty, toDate, toNumber, trimText } from "./transforms.js";

/** { emptyRowsRemoved, duplicatesRemoved, blanksFilled }, all zero. */
export function emptyCleaningStats() {
  return { emptyRowsRemoved: 0, duplicatesRemoved: 0, blanksFilled: 0 };
}

/** Field ids a cleaning option refers to that are not in `fieldIds` (a Set). */
export function missingCleaningRefs(ids, fieldIds) {
  return (Array.isArray(ids) ? ids : []).filter((id) => id && !fieldIds.has(id));
}

/** Part of a duplicate key: empty values are equal to each other, text ignores case. */
function duplicatePart(value) {
  if (value === null || value === undefined) return "\u0000";
  if (typeof value === "string") return value === "" || value.trim() === "" ? "\u0000" : value.toLowerCase();
  if (typeof value === "number") return Number.isNaN(value) ? "\u0000" : `\u0000n${value}`;
  if (value instanceof Date) {
    const time = value.getTime();
    return Number.isNaN(time) ? "\u0000" : `\u0000d${time}`;
  }
  return `\u0000b${String(value)}`;
}

/** The value that fills a blank of one slot: typed like the slot's column format or source type. */
function fillValueFor(raw, slot) {
  const value = coerceDefault(raw);
  if (value === "" || value === null || value === undefined) return null;
  if (slot && slot.format) return coerceForFormat(value, slot.format);
  if (slot && slot.fallbackType === "number" && typeof value === "string") {
    const n = toNumber(value);
    return n === null ? value : n;
  }
  if (slot && slot.fallbackType === "date" && typeof value === "string") return toDate(value) || value;
  return value;
}

/**
 * Compile the cleaning settings for one pipeline run.
 *
 * Call it after every other slot has been reserved: `trimText` applies to every slot that exists then.
 *
 * @param {object} cleaning   a normalised Cleaning (lib/schema.js)
 * @param {object[]} fields   the definition's fields
 * @param {(fieldId: string) => number} need  reserves (or finds) the slot of a field; -1 when it does not exist
 * @param {{ format: object|null, fallbackType: string }[]} slots  the run's compiled slots
 * @returns {{ stats: object, apply: ((mapped: any[]) => boolean) | null }}  apply is null when cleaning
 *   does nothing; otherwise it cleans the row in place and returns false when the row must be dropped
 */
export function compileCleaning(cleaning, fields, need, slots) {
  const stats = emptyCleaningStats();
  const c = cleaning || {};
  const duplicates = c.removeDuplicates || {};
  const fill = c.fillBlanks || {};
  const allFields = () => fields.map((field) => need(field.id)).filter((slot) => slot >= 0);
  const chosen = (ids) => (Array.isArray(ids) ? ids : []).map((id) => need(id)).filter((slot) => slot >= 0);
  const unique = (list) => [...new Set(list)];

  const emptySlots = c.removeEmptyRows ? allFields() : null;

  let dedupeSlots = null;
  if (duplicates.enabled) {
    const keys = Array.isArray(duplicates.keys) ? duplicates.keys.filter(Boolean) : [];
    // Keys that were all deleted switch the option off rather than collapsing every row into one.
    dedupeSlots = unique(keys.length ? chosen(keys) : allFields());
    if (!dedupeSlots.length) dedupeSlots = null;
  }

  let fillSlots = null;
  let fillValues = null;
  const previous = fill.mode === "previous";
  if (fill.enabled) {
    const ids = Array.isArray(fill.fieldIds) ? fill.fieldIds.filter(Boolean) : [];
    fillSlots = unique(ids.length ? chosen(ids) : allFields());
    if (!previous) {
      fillValues = fillSlots.map((slot) => fillValueFor(fill.value, slots[slot]));
      if (fillValues.every((value) => value === null)) fillSlots = [];
    }
    if (!fillSlots.length) fillSlots = null;
  }

  // Every slot exists by now (the calls above were the last to reserve any).
  const trimCount = c.trimText ? slots.length : 0;
  if (!trimCount && !emptySlots && !fillSlots && !dedupeSlots) return { stats, apply: null };

  const last = fillSlots && previous ? new Array(fillSlots.length).fill(null) : null;
  const seen = dedupeSlots ? new Set() : null;

  const apply = (mapped) => {
    for (let s = 0; s < trimCount; s += 1) {
      const value = mapped[s];
      if (typeof value === "string") {
        const trimmed = trimText(value);
        mapped[s] = trimmed === "" ? null : trimmed;
      }
    }
    if (emptySlots) {
      let empty = true;
      for (let i = 0; i < emptySlots.length; i += 1) {
        if (!isEmpty(mapped[emptySlots[i]])) {
          empty = false;
          break;
        }
      }
      if (empty) {
        stats.emptyRowsRemoved += 1;
        return false;
      }
    }
    let filled = 0;
    if (fillSlots) {
      for (let i = 0; i < fillSlots.length; i += 1) {
        const slot = fillSlots[i];
        if (isEmpty(mapped[slot])) {
          const value = last ? last[i] : fillValues[i];
          if (value !== null) {
            mapped[slot] = value;
            filled += 1;
          }
        } else if (last) {
          last[i] = mapped[slot];
        }
      }
    }
    if (seen) {
      let key = duplicatePart(mapped[dedupeSlots[0]]);
      for (let i = 1; i < dedupeSlots.length; i += 1) key += `\u0001${duplicatePart(mapped[dedupeSlots[i]])}`;
      if (seen.has(key)) {
        stats.duplicatesRemoved += 1;
        return false;
      }
      seen.add(key);
    }
    stats.blanksFilled += filled;
    return true;
  };
  return { stats, apply };
}
