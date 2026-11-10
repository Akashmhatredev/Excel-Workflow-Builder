import { FileArchive, FileImage, FileSpreadsheet, FileText, Files } from "lucide-react";

/**
 * Display helpers for run history entries (lib/history.js). Pure functions: the current
 * time is always passed in (see useNow in ./hooks.js), never read during render.
 */

export const RUN_KINDS = {
  file: { label: "File", icon: FileSpreadsheet },
  zip: { label: "ZIP", icon: FileArchive },
  image: { label: "Report image", icon: FileImage },
  pdf: { label: "PDF", icon: FileText },
  batch: { label: "Batch", icon: Files },
};

export function runKind(kind) {
  if (RUN_KINDS[kind]) return RUN_KINDS[kind];
  const text = String(kind || "").trim();
  return { label: text ? text.charAt(0).toUpperCase() + text.slice(1) : "Export", icon: FileSpreadsheet };
}

export function runTitle(entry) {
  return (entry.templateName || "").trim() || "Untitled workflow";
}

export function runTime(entry) {
  const time = Date.parse(entry.at);
  return Number.isFinite(time) ? time : null;
}

const numberFormat = new Intl.NumberFormat();

export function formatRows(count) {
  if (!Number.isFinite(count)) return "";
  return `${numberFormat.format(count)} ${count === 1 ? "row" : "rows"}`;
}

/** "Orders" + "xlsx" -> "Orders.xlsx", unless the name already ends with the extension. */
export function outputLabel(output) {
  const name = (output.name || "").trim() || "Output";
  const type = (output.fileType || "").trim().toLowerCase();
  if (!type || name.toLowerCase().endsWith(`.${type}`)) return name;
  return `${name}.${type}`;
}

export function totalRows(entry) {
  let total = 0;
  let known = false;
  for (const output of entry.outputs || []) {
    if (Number.isFinite(output.rowCount)) {
      total += output.rowCount;
      known = true;
    }
  }
  return known ? total : null;
}

const relativeFormat = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
const UNITS = [
  ["year", 365 * 24 * 3600],
  ["month", 30 * 24 * 3600],
  ["week", 7 * 24 * 3600],
  ["day", 24 * 3600],
  ["hour", 3600],
  ["minute", 60],
];

/** "just now", "5 minutes ago", "yesterday", "3 weeks ago". */
export function relativeTime(time, now) {
  if (time === null || !now) return "";
  const seconds = Math.round((time - now) / 1000);
  if (Math.abs(seconds) < 45) return "just now";
  for (const [unit, size] of UNITS) {
    if (Math.abs(seconds) >= size || unit === "minute") {
      return relativeFormat.format(Math.round(seconds / size), unit);
    }
  }
  return "";
}

const fullFormat = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });
const clockFormat = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });

export function formatFull(time) {
  return time === null ? "Unknown time" : fullFormat.format(new Date(time));
}

export function formatClock(time) {
  return time === null ? "Unknown time" : clockFormat.format(new Date(time));
}

/** Local calendar day "YYYY-MM-DD" (entries are grouped by the viewer's own days). */
export function dayKey(time) {
  if (time === null) return "unknown";
  const date = new Date(time);
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

const dayFormat = new Intl.DateTimeFormat(undefined, { weekday: "long", day: "numeric", month: "long" });
const dayYearFormat = new Intl.DateTimeFormat(undefined, { weekday: "long", day: "numeric", month: "long", year: "numeric" });

export function dayLabel(time, now) {
  if (time === null) return "Unknown date";
  const key = dayKey(time);
  if (now) {
    if (key === dayKey(now)) return "Today";
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    if (key === dayKey(yesterday.getTime())) return "Yesterday";
    if (new Date(time).getFullYear() === new Date(now).getFullYear()) return dayFormat.format(new Date(time));
  }
  return dayYearFormat.format(new Date(time));
}

/** Entries (already newest first) -> [{ key, time, entries }] in the same order. */
export function groupByDay(entries) {
  const groups = [];
  const index = new Map();
  for (const entry of entries) {
    const time = runTime(entry);
    const key = dayKey(time);
    let group = index.get(key);
    if (!group) {
      group = { key, time, entries: [] };
      index.set(key, group);
      groups.push(group);
    }
    group.entries.push(entry);
  }
  return groups;
}

export function plural(count, word) {
  return `${numberFormat.format(count)} ${word}${count === 1 ? "" : "s"}`;
}
