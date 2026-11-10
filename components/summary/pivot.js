/**
 * Pure helpers for the Summary (pivot) view: CSV text built in the browser from the
 * display strings, and the settings that are valid for the current fields.
 */

import { AGGREGATIONS, sanitizeFileName } from "@/lib/schema";

const NEEDS_QUOTES = /[",\r\n]|^\s|\s$/;

/** RFC 4180 field: quoted when it holds a comma, quote or line break, or starts/ends with a space. */
export function csvCell(value) {
  const text = value == null ? "" : String(value);
  return NEEDS_QUOTES.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/**
 * CSV text (UTF-8 BOM so Excel reads it as UTF-8, CRLF line ends) from DataTable-style input.
 * @param {({ name: string } | string)[]} columns
 * @param {string[][]} rows
 */
export function toCsv(columns, rows) {
  const header = (columns || []).map((column) => csvCell(column && typeof column === "object" ? column.name : column));
  const lines = [header.join(",")];
  for (const row of rows || []) lines.push((row || []).map(csvCell).join(","));
  return `﻿${lines.join("\r\n")}\r\n`;
}

export const DEFAULT_PIVOT = Object.freeze({ rowKey: "", columnKey: "", valueKey: "", fn: "count" });

/**
 * The pivot settings to use with the current fields: unknown ids are dropped, the row field
 * falls back to the first text field (else the first field) and the column field can never be
 * the row field. `ready` is false while a function other than count has no value field.
 * @param {{ rowKey, columnKey, valueKey, fn }} settings
 * @param {{ id: string, name: string }[]} fields
 * @param {{ [fieldId]: 'text'|'number'|'date' }} types
 */
export function resolvePivot(settings, fields, types = {}) {
  const ids = new Set((fields || []).map((field) => field.id));
  const s = settings || DEFAULT_PIVOT;
  const firstText = (fields || []).find((field) => types[field.id] === "text");
  const fallbackRow = (firstText || (fields || [])[0] || {}).id || "";
  const rowKey = ids.has(s.rowKey) ? s.rowKey : fallbackRow;
  const columnKey = s.columnKey && ids.has(s.columnKey) && s.columnKey !== rowKey ? s.columnKey : "";
  const fn = AGGREGATIONS[s.fn] ? s.fn : "count";
  const valueKey = s.valueKey && ids.has(s.valueKey) ? s.valueKey : "";
  return { rowKey, columnKey, valueKey, fn, ready: Boolean(rowKey) && (fn === "count" || Boolean(valueKey)) };
}

/** "Sum of Amount by Region and Category", or "Count of rows by Region". */
export function describePivot({ rowKey, columnKey, valueKey, fn }, fields) {
  const name = (id) => {
    const field = (fields || []).find((item) => item.id === id);
    return (field && field.name) || "(unnamed field)";
  };
  const label = (AGGREGATIONS[fn] || AGGREGATIONS.count).label;
  const of = valueKey ? name(valueKey) : "rows";
  const by = rowKey ? ` by ${name(rowKey)}${columnKey ? ` and ${name(columnKey)}` : ""}` : "";
  return `${label} of ${of}${by}`;
}

/** File name for the summary download, e.g. "Summary - Sum of Amount by Region.csv". */
export function summaryFileName(description) {
  return `${sanitizeFileName(`Summary - ${description}`, "Summary")}.csv`;
}
