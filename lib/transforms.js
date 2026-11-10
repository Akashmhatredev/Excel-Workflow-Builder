/**
 * lib/transforms.js (owner: Agent A): pure value helpers and the transform chain.
 * No DOM, no worker, no SheetJS. Loads in the worker, in the UI thread and in Vitest.
 *
 * Values that flow through the engine are `string | number | boolean | Date | null`.
 *
 * Dates are "wall-clock" dates: the UTC fields of the Date object hold the calendar
 * values the user sees (2024-01-05 is `new Date(Date.UTC(2024, 0, 5))`). Nothing in
 * the engine reads the local time zone, so a date is the same calendar day everywhere.
 */

const DAY_MS = 86400000;
const EXCEL_EPOCH_MS = Date.UTC(1899, 11, 30);

/* ------------------------------------------------------------------ */
/* emptiness                                                            */
/* ------------------------------------------------------------------ */

export function isEmpty(value) {
  if (value === null || value === undefined) return true;
  if (typeof value === "string") return value === "" || value.trim() === "";
  if (typeof value === "number") return Number.isNaN(value);
  if (value instanceof Date) return Number.isNaN(value.getTime());
  return false;
}

/* ------------------------------------------------------------------ */
/* numbers                                                              */
/* ------------------------------------------------------------------ */

const PLAIN_NUMBER = /^-?\d+(?:\.\d+)?$/;
const STRICT_NUMBER = /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/;
const LENIENT_BODY = /^(?:\d+|\d{1,3}(?:,\d{2,3})*,\d{3})?(?:\.\d*)?(?:[eE][+-]?\d+)?$/;
const CURRENCY = /\p{Sc}|\b(?:rs\.?|inr|usd|eur|gbp)(?![a-z])/giu;

/**
 * Lenient number parsing: "1,234.50", "₹ 1,200", "(45)" -> -45, "12%" -> 12, " 7 ".
 * Returns null for anything that is not clearly a number (dates, booleans, "12 kg", "1,2").
 */
export function toNumber(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;
  let s = value.trim();
  if (s === "") return null;
  if (PLAIN_NUMBER.test(s)) {
    const plain = Number(s);
    return plain === 0 ? 0 : plain;
  }
  let negative = false;
  if (s.charCodeAt(0) === 40 && s.charCodeAt(s.length - 1) === 41) {
    negative = true;
    s = s.slice(1, -1);
  }
  s = s.replace(/−/g, "-").replace(CURRENCY, "").replace(/[\s ]+/g, "");
  if (s.endsWith("%")) s = s.slice(0, -1);
  if (s.startsWith("-")) {
    negative = !negative;
    s = s.slice(1);
  } else if (s.startsWith("+")) {
    s = s.slice(1);
  } else if (s.endsWith("-")) {
    negative = !negative;
    s = s.slice(0, -1);
  }
  if (!/\d/.test(s) || !LENIENT_BODY.test(s)) return null;
  const n = Number(s.replace(/,/g, ""));
  if (!Number.isFinite(n)) return null;
  if (n === 0) return 0;
  return negative ? -n : n;
}

/**
 * Strict check used for column type inference: digits with an optional sign and
 * decimals only. "00123", "+91...", "1,234" and 16+ digit ids are not numbers.
 */
export function isStrictNumeric(text) {
  if (typeof text !== "string") return false;
  const s = text.trim();
  if (s === "" || s.length > 17 || !STRICT_NUMBER.test(s)) return false;
  return s.replace(/[-.]/g, "").length <= 15;
}

// "1,200", "12,34,567.50": thousands-grouped amounts (western or Indian grouping), no leading zero.
const GROUPED_NUMBER = /^-?[1-9]\d{0,2}(?:,\d{3})+(?:\.\d+)?$|^-?[1-9]\d?(?:,\d{2})+,\d{3}(?:\.\d+)?$/;

/** Text that is unambiguously a number. Codes such as "00123", "+9198..." or "1,2" stay text. */
export function isNumericText(text) {
  if (isStrictNumeric(text)) return true;
  if (typeof text !== "string") return false;
  const s = text.trim();
  return s.length <= 24 && GROUPED_NUMBER.test(s);
}

/** Remove binary floating point noise (0.1 + 0.2 -> 0.3). */
export function cleanNumber(n) {
  if (typeof n !== "number" || !Number.isFinite(n) || Number.isInteger(n)) return n;
  return Number(n.toPrecision(15));
}

/** Round half away from zero to `digits` decimals (negative digits round to tens, hundreds...). */
export function roundNumber(n, digits = 0) {
  if (typeof n !== "number" || !Number.isFinite(n)) return n;
  const d = Math.max(-15, Math.min(15, Math.trunc(Number(digits) || 0)));
  const factor = 10 ** Math.abs(d);
  const abs = Math.abs(n);
  const shifted = d >= 0 ? abs * factor : abs / factor;
  if (shifted >= 1e15) return n;
  const rounded = Math.round(Number(shifted.toPrecision(15)));
  const result = d >= 0 ? rounded / factor : rounded * factor;
  if (result === 0) return 0;
  return n < 0 ? -result : result;
}

function numberToText(n) {
  if (!Number.isFinite(n)) return "";
  if (Number.isInteger(n)) return String(n === 0 ? 0 : n);
  let s = String(n);
  if (s.length > 15) s = String(Number(n.toPrecision(15)));
  if (s.includes("e-")) {
    const fixed = Number(s).toFixed(20).replace(/0+$/, "").replace(/\.$/, "");
    return fixed === "-0" ? "0" : fixed;
  }
  return s;
}

function clampDecimals(decimals) {
  if (decimals === null || decimals === undefined) return 2;
  const n = Number(decimals);
  if (!Number.isFinite(n)) return 2;
  return Math.max(0, Math.min(10, Math.round(n)));
}

function groupThousands(digits) {
  if (digits.length <= 3) return digits;
  const first = digits.length % 3 || 3;
  let out = digits.slice(0, first);
  for (let i = first; i < digits.length; i += 3) out += `,${digits.slice(i, i + 3)}`;
  return out;
}

/**
 * formatNumber(1234.5, { decimals: 2, thousands: true, prefix: "₹" }) -> "₹1,234.50".
 * Values that are not numbers are returned as their plain text.
 */
export function formatNumber(value, options = {}) {
  const n = toNumber(value);
  if (n === null) return toText(value);
  const opts = options || {};
  const decimals = clampDecimals(opts.decimals);
  const rounded = roundNumber(Math.abs(n), decimals);
  let body = rounded < 1e21 ? rounded.toFixed(decimals) : String(rounded);
  if (opts.thousands && rounded < 1e21) {
    const dot = body.indexOf(".");
    body = dot === -1 ? groupThousands(body) : groupThousands(body.slice(0, dot)) + body.slice(dot);
  }
  const sign = n < 0 && rounded !== 0 ? "-" : "";
  return `${sign}${opts.prefix ?? ""}${body}${opts.suffix ?? ""}`;
}

/* ------------------------------------------------------------------ */
/* dates                                                                */
/* ------------------------------------------------------------------ */

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

const MONTH_LOOKUP = (() => {
  const map = new Map();
  MONTH_NAMES.forEach((name, index) => {
    map.set(name.toLowerCase(), index);
    map.set(name.slice(0, 3).toLowerCase(), index);
  });
  map.set("sept", 8);
  return map;
})();

// Optional time part: " 10:30", "T10:30:15.250", ", 4:05 PM". Groups: hours, minutes, seconds, a/p.
const TIME = "(?:(?:[T ]|,\\s*)\\s*(\\d{1,2}):(\\d{2})(?::(\\d{2})(?:\\.\\d+)?)?(?:\\s*([AaPp])\\.?[Mm]\\.?)?)?";
const ISO_DATE = new RegExp(`^(\\d{4})-(\\d{1,2})-(\\d{1,2})${TIME}\\s*(?:Z|[+-]\\d{2}(?::?\\d{2})?)?$`);
const YMD_DATE = new RegExp(`^(\\d{4})([/.])(\\d{1,2})\\2(\\d{1,2})${TIME}$`);
const DMY_DATE = new RegExp(`^(\\d{1,2})([/.-])(\\d{1,2})\\2(\\d{4})${TIME}$`);
const D_MON_Y_DATE = new RegExp(
  `^(\\d{1,2})(?:st|nd|rd|th)?(?:\\s+|[-/])([A-Za-z]{3,9})\\.?(?:,?\\s+|[-/])(\\d{4}|\\d{2})${TIME}$`,
);
const MON_D_Y_DATE = new RegExp(`^([A-Za-z]{3,9})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?,?\\s+(\\d{4})${TIME}$`);

function buildDate(year, month, day, hours, minutes, seconds, meridiem) {
  if (year < 1000 || year > 9999 || month < 0 || month > 11 || day < 1 || day > 31) return null;
  let h = hours === undefined ? 0 : Number(hours);
  const m = minutes === undefined ? 0 : Number(minutes);
  const s = seconds === undefined ? 0 : Number(seconds);
  if (meridiem) {
    if (h < 1 || h > 12) return null;
    const pm = meridiem === "p" || meridiem === "P";
    h = pm ? (h % 12) + 12 : h % 12;
  }
  if (h > 23 || m > 59 || s > 59) return null;
  const date = new Date(Date.UTC(year, month, day, h, m, s));
  if (date.getUTCMonth() !== month || date.getUTCDate() !== day) return null;
  return date;
}

function expandYear(text) {
  const year = Number(text);
  if (text.length === 4) return year;
  return year < 50 ? 2000 + year : 1900 + year;
}

/**
 * Parse a date. Accepts Date objects, ISO ("2024-01-05", "2024-01-05T10:30:00Z"),
 * DD/MM/YYYY, DD-MM-YYYY, DD.MM.YYYY, YYYY/MM/DD, "5 Jan 2024", "5-Jan-24",
 * "Jan 5, 2024", each with an optional time. An ambiguous a/b/yyyy is day-first;
 * 12/25/2024 can only be month-first and is read that way. Numbers are not dates.
 * A time zone suffix is ignored: the date and time are kept exactly as written.
 */
export function toDate(value) {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value !== "string") return null;
  const s = value.trim();
  if (s.length < 6 || s.length > 40) return null;
  const first = s.charCodeAt(0);
  let m;
  if (first >= 48 && first <= 57) {
    if (s.charCodeAt(4) === 45 && (m = ISO_DATE.exec(s))) {
      return buildDate(Number(m[1]), Number(m[2]) - 1, Number(m[3]), m[4], m[5], m[6], m[7]);
    }
    if ((m = DMY_DATE.exec(s))) {
      let day = Number(m[1]);
      let month = Number(m[3]);
      if (month > 12 && day <= 12) [day, month] = [month, day];
      return buildDate(Number(m[4]), month - 1, day, m[5], m[6], m[7], m[8]);
    }
    if ((m = YMD_DATE.exec(s))) {
      return buildDate(Number(m[1]), Number(m[3]) - 1, Number(m[4]), m[5], m[6], m[7], m[8]);
    }
    if ((m = D_MON_Y_DATE.exec(s))) {
      const month = MONTH_LOOKUP.get(m[2].toLowerCase());
      if (month === undefined) return null;
      return buildDate(expandYear(m[3]), month, Number(m[1]), m[4], m[5], m[6], m[7]);
    }
    return null;
  }
  if ((first >= 65 && first <= 90) || (first >= 97 && first <= 122)) {
    if ((m = MON_D_Y_DATE.exec(s))) {
      const month = MONTH_LOOKUP.get(m[1].toLowerCase());
      if (month === undefined) return null;
      return buildDate(Number(m[3]), month, Number(m[2]), m[4], m[5], m[6], m[7]);
    }
  }
  return null;
}

const pad2 = (n) => (n < 10 ? `0${n}` : String(n));

function dateToText(date) {
  const time = date.getTime();
  if (Number.isNaN(time)) return "";
  const year = date.getUTCFullYear();
  let out = `${year < 1000 ? String(year).padStart(4, "0") : year}-${pad2(date.getUTCMonth() + 1)}-${pad2(date.getUTCDate())}`;
  const seconds = Math.floor((((time % DAY_MS) + DAY_MS) % DAY_MS) / 1000);
  if (seconds > 0) {
    out += ` ${pad2(Math.floor(seconds / 3600))}:${pad2(Math.floor(seconds / 60) % 60)}`;
    if (seconds % 60) out += `:${pad2(seconds % 60)}`;
  }
  return out;
}

const DATE_TOKEN = /\[([^\]]*)\]|YYYY|YY|MMMM|MMM|MM|M|DD|D|HH|H|hh|h|mm|ss|A/g;
const patternCache = new Map();

function compileDatePattern(pattern) {
  let parts = patternCache.get(pattern);
  if (parts) return parts;
  parts = [];
  let last = 0;
  for (const match of pattern.matchAll(DATE_TOKEN)) {
    if (match.index > last) parts.push({ text: pattern.slice(last, match.index) });
    if (match[1] !== undefined) parts.push({ text: match[1] });
    else parts.push({ token: match[0] });
    last = match.index + match[0].length;
  }
  if (last < pattern.length) parts.push({ text: pattern.slice(last) });
  if (patternCache.size > 200) patternCache.clear();
  patternCache.set(pattern, parts);
  return parts;
}

function dateToken(date, token) {
  switch (token) {
    case "YYYY":
      return String(date.getUTCFullYear()).padStart(4, "0");
    case "YY":
      return pad2(date.getUTCFullYear() % 100);
    case "MMMM":
      return MONTH_NAMES[date.getUTCMonth()];
    case "MMM":
      return MONTH_NAMES[date.getUTCMonth()].slice(0, 3);
    case "MM":
      return pad2(date.getUTCMonth() + 1);
    case "M":
      return String(date.getUTCMonth() + 1);
    case "DD":
      return pad2(date.getUTCDate());
    case "D":
      return String(date.getUTCDate());
    case "HH":
      return pad2(date.getUTCHours());
    case "H":
      return String(date.getUTCHours());
    case "hh":
      return pad2(date.getUTCHours() % 12 || 12);
    case "h":
      return String(date.getUTCHours() % 12 || 12);
    case "mm":
      return pad2(date.getUTCMinutes());
    case "ss":
      return pad2(date.getUTCSeconds());
    case "A":
      return date.getUTCHours() < 12 ? "AM" : "PM";
    default:
      return token;
  }
}

/**
 * formatDate(date, "DD MMM YYYY") -> "05 Jan 2024".
 * Tokens: YYYY YY MMMM MMM MM M DD D HH H hh h mm ss A. Text in [brackets] is kept as is.
 * Values that are not dates are returned as their plain text.
 */
export function formatDate(value, pattern) {
  const date = toDate(value);
  if (!date) return toText(value);
  const text = typeof pattern === "string" ? pattern : "";
  if (text.trim() === "") return dateToText(date);
  const parts = compileDatePattern(text);
  let out = "";
  for (let i = 0; i < parts.length; i += 1) {
    const part = parts[i];
    out += part.token ? dateToken(date, part.token) : part.text;
  }
  return out;
}

/** Excel serial number (1900 date system) -> wall-clock Date. */
export function excelSerialToDate(serial) {
  if (typeof serial !== "number" || !Number.isFinite(serial)) return null;
  const adjusted = serial < 60 ? serial + 1 : serial;
  const date = new Date(Math.round(adjusted * DAY_MS) + EXCEL_EPOCH_MS);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Wall-clock Date -> Excel serial number (1900 date system). */
export function dateToExcelSerial(date) {
  const serial = (date.getTime() - EXCEL_EPOCH_MS) / DAY_MS;
  return serial < 61 ? serial - 1 : serial;
}

/* ------------------------------------------------------------------ */
/* text                                                                 */
/* ------------------------------------------------------------------ */

/**
 * Raw value -> display string. Numbers without float noise (0.1 + 0.2 -> "0.3"),
 * dates as YYYY-MM-DD (plus " HH:mm", and ":ss" when the seconds are not zero), null -> "".
 */
export function toText(value) {
  if (value === null || value === undefined) return "";
  switch (typeof value) {
    case "string":
      return value;
    case "number":
      return numberToText(value);
    case "boolean":
      return value ? "TRUE" : "FALSE";
    default:
      return value instanceof Date ? dateToText(value) : String(value);
  }
}

const MESSY_SPACE = /[\t ]| {2}/;

/** Trim the ends and collapse runs of spaces inside (like Excel's TRIM). Line breaks are kept. */
export function trimText(text) {
  const s = text.trim();
  return MESSY_SPACE.test(s) ? s.replace(/[ \t ]+/g, " ") : s;
}

const WORD_START = /(^|[\s\-/([{"“.])(\p{L})/gu;

export function titleCase(text) {
  return text.toLowerCase().replace(WORD_START, (whole, before, letter) => before + letter.toUpperCase());
}

/* ------------------------------------------------------------------ */
/* the transform chain                                                  */
/* ------------------------------------------------------------------ */

const identity = (value) => value;

/** The value a "default" transform (or a cleaning fill) inserts: strictly numeric text becomes a number. */
export function coerceDefault(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : "";
  const text = value === null || value === undefined ? "" : String(value);
  return isStrictNumeric(text) ? Number(text.trim()) : text;
}

const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** The RegExp a "replace" transform uses, or null when it has nothing to find. Throws on a bad pattern. */
export function buildReplacePattern(transform) {
  const find = transform && transform.find !== null && transform.find !== undefined ? String(transform.find) : "";
  if (find === "") return null;
  return new RegExp(transform.useRegex ? find : escapeRegExp(find), transform.matchCase ? "g" : "gi");
}

function unescapeDelimiter(delimiter) {
  if (delimiter === "\\t") return "\t";
  if (delimiter === "\\n") return "\n";
  return delimiter;
}

/** Compile one transform into a `(value) => value` function. Unknown types do nothing. */
export function compileTransform(transform) {
  const t = transform || {};
  switch (t.type) {
    case "trim":
      return (value) => (typeof value === "string" ? trimText(value) : value);
    case "upper":
      return (value) => (typeof value === "string" ? value.toUpperCase() : value);
    case "lower":
      return (value) => (typeof value === "string" ? value.toLowerCase() : value);
    case "title":
      return (value) => (typeof value === "string" ? titleCase(value) : value);
    case "numberFormat": {
      const options = { decimals: t.decimals, thousands: Boolean(t.thousands), prefix: t.prefix ?? "", suffix: t.suffix ?? "" };
      return (value) => (isEmpty(value) ? value : formatNumber(value, options));
    }
    case "dateFormat": {
      const pattern = t.pattern;
      return (value) => (isEmpty(value) ? value : formatDate(value, pattern));
    }
    case "default": {
      const fallback = coerceDefault(t.value);
      return (value) => (isEmpty(value) ? fallback : value);
    }
    case "split": {
      const delimiter = unescapeDelimiter(t.delimiter === null || t.delimiter === undefined ? "," : String(t.delimiter));
      const index = Math.trunc(Number(t.index)) || 1;
      if (delimiter === "") return identity;
      return (value) => {
        if (isEmpty(value)) return value;
        const parts = toText(value).split(delimiter);
        const at = index > 0 ? index - 1 : parts.length + index;
        return at >= 0 && at < parts.length ? parts[at] : "";
      };
    }
    case "replace": {
      let pattern = null;
      try {
        pattern = buildReplacePattern(t);
      } catch {
        return identity;
      }
      if (!pattern) return identity;
      const replacement = String(t.replaceWith ?? "");
      const replacer = t.useRegex ? replacement : () => replacement;
      return (value) => {
        if (value === null || value === undefined) return value;
        const text = toText(value);
        const out = text.replace(pattern, replacer);
        return out === text ? value : out;
      };
    }
    default:
      return identity;
  }
}

const compiledCache = new WeakMap();

function compiled(transform) {
  if (transform === null || typeof transform !== "object") return identity;
  let fn = compiledCache.get(transform);
  if (!fn) {
    fn = compileTransform(transform);
    compiledCache.set(transform, fn);
  }
  return fn;
}

/** Apply one transform. `numberFormat` and `dateFormat` return strings here. */
export function applyTransform(value, transform) {
  return compiled(transform)(value);
}

/** Apply the whole chain in order (formats stringify). */
export function applyTransforms(value, transforms) {
  let out = value;
  const list = Array.isArray(transforms) ? transforms : [];
  for (let i = 0; i < list.length; i += 1) out = compiled(list[i])(out);
  return out;
}

/** Compile a chain once: `(value) => value`. */
export function compileTransforms(transforms) {
  const fns = (Array.isArray(transforms) ? transforms : []).map(compileTransform).filter((fn) => fn !== identity);
  if (fns.length === 0) return identity;
  if (fns.length === 1) return fns[0];
  return (value) => {
    let out = value;
    for (let i = 0; i < fns.length; i += 1) out = fns[i](out);
    return out;
  };
}

const isFormat = (transform) =>
  Boolean(transform) && (transform.type === "numberFormat" || transform.type === "dateFormat");

/**
 * Split off a trailing numberFormat / dateFormat. The engine keeps the typed value for
 * such a field and uses that transform as the column format.
 */
export function splitTrailingFormat(transforms) {
  const list = Array.isArray(transforms) ? transforms : [];
  const last = list[list.length - 1];
  if (isFormat(last)) return { head: list.slice(0, -1), format: last };
  return { head: list, format: null };
}

/** The typed value a column format wants: a number for numberFormat, a Date for dateFormat. */
export function coerceForFormat(value, format) {
  if (!format || value === null || value === undefined) return value;
  if (format.type === "numberFormat") {
    if (typeof value === "number") return value;
    const n = toNumber(value);
    return n === null ? value : n;
  }
  if (format.type === "dateFormat") {
    const date = toDate(value);
    return date || value;
  }
  return value;
}

/** Typed value + column format -> display string. */
export function formatDisplay(value, format) {
  if (!format) return toText(value);
  if (isEmpty(value)) return "";
  if (format.type === "numberFormat") return formatNumber(value, format);
  if (format.type === "dateFormat") return formatDate(value, format.pattern);
  return toText(value);
}

function excelLiteral(text) {
  let out = "";
  let run = "";
  for (const ch of String(text)) {
    if (ch === '"') {
      if (run) out += `"${run}"`;
      run = "";
      out += '\\"';
    } else {
      run += ch;
    }
  }
  if (run) out += `"${run}"`;
  return out;
}

const EXCEL_DATE_TOKENS = {
  YYYY: "yyyy",
  YY: "yy",
  MMMM: "mmmm",
  MMM: "mmm",
  MM: "mm",
  M: "m",
  DD: "dd",
  D: "d",
  HH: "hh",
  H: "h",
  hh: "hh",
  h: "h",
  mm: "mm",
  ss: "ss",
  A: "AM/PM",
};

/** Column format -> Excel number format string ("#,##0.00", "dd/mm/yyyy"), or null. */
export function excelNumberFormat(format) {
  if (!format) return null;
  if (format.type === "numberFormat") {
    const decimals = clampDecimals(format.decimals);
    let body = format.thousands ? "#,##0" : "0";
    if (decimals > 0) body += `.${"0".repeat(decimals)}`;
    return `${excelLiteral(format.prefix ?? "")}${body}${excelLiteral(format.suffix ?? "")}`;
  }
  if (format.type === "dateFormat") {
    const pattern = typeof format.pattern === "string" ? format.pattern : "";
    if (pattern.trim() === "") return "yyyy-mm-dd";
    let out = "";
    for (const part of compileDatePattern(pattern)) {
      if (part.token) out += EXCEL_DATE_TOKENS[part.token];
      else if (/^[\s/.,:-]*$/.test(part.text)) out += part.text;
      else out += excelLiteral(part.text);
    }
    return out;
  }
  return null;
}
