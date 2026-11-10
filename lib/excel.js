/**
 * lib/excel.js (owner: Agent A): reading and writing spreadsheet files.
 * Imported by the worker, by scripts and by tests. Never import it from UI components
 * (it pulls in SheetJS and JSZip).
 *
 * Reading
 *   readWorkbook(bytes, fileName) -> workbook   (an internal, already converted structure)
 *   listSheets(workbook)          -> [{ name, rowCount, colCount }]
 *   buildTable(workbook, { sheetNames, headerRow }) -> { columns, rows, sheetNames, headerRow, warnings }
 *
 * Writing
 *   writeXlsx(result, { sheetName }) -> Uint8Array
 *   writeCsv(result)                 -> Uint8Array
 *   buildOutputFile(table, definition, outputId) -> { fileName, mime, bytes, rowCount }
 *   uniqueFileNames(names), zipFiles(files)
 *
 * Dates never touch the local time zone. Excel stores a date as a serial number, and
 * the reader turns a date-formatted serial straight into a wall-clock Date (UTC fields
 * hold the calendar values, see lib/transforms.js). The writer does the reverse. SheetJS
 * is told to hand over raw serials (`cellDates: false`) so its own Date handling is not involved.
 *
 * Text files (.csv / .tsv) are decoded and parsed here, not by SheetJS, so "05/01/2024"
 * is never guessed to be a US date. Column types are inferred per column for every format.
 */

import JSZip from "jszip";
import * as XLSX from "xlsx";
import { runPipeline } from "./pipeline.js";
import { FILE_TYPES, outputFileName, sanitizeFileName, sanitizeSheetName, uniqueName } from "./schema.js";
import {
  dateToExcelSerial,
  excelNumberFormat,
  excelSerialToDate,
  formatDisplay,
  isStrictNumeric,
  toDate,
  toText,
} from "./transforms.js";

const SUPPORTED_EXTENSIONS = new Set(["xlsx", "xlsm", "xls", "csv", "tsv"]);
const MAX_XLSX_ROWS = 1048576;
const MAX_XLSX_COLUMNS = 16384;
const MAX_CELL_TEXT = 32767;
const SOURCE_SHEET = "Source Sheet";

function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

const plural = (count, one, many) => `${count.toLocaleString("en-US")} ${count === 1 ? one : many}`;

/* ------------------------------------------------------------------ */
/* reading: bytes -> workbook                                           */
/* ------------------------------------------------------------------ */

function toBytes(data) {
  if (data instanceof Uint8Array) return data;
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  throw fail("CORRUPT_FILE", "This file could not be read.");
}

function extensionOf(fileName) {
  const name = String(fileName || "");
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1).trim().toLowerCase() : "";
}

function signatureOf(bytes) {
  if (bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && (bytes[2] === 0x03 || bytes[2] === 0x05)) return "zip";
  if (bytes.length >= 8 && bytes[0] === 0xd0 && bytes[1] === 0xcf && bytes[2] === 0x11 && bytes[3] === 0xe0) return "cfb";
  // BIFF2-5 workbook streams that are not wrapped in a compound file start with a BOF record.
  if (bytes.length >= 4 && bytes[0] === 0x09 && (bytes[1] === 0x00 || bytes[1] === 0x02 || bytes[1] === 0x04 || bytes[1] === 0x08)) {
    return "biff";
  }
  return "other";
}

/** NUL bytes or a lot of control characters mean this is not a text file. */
function looksBinary(bytes) {
  const limit = Math.min(bytes.length, 65536);
  let control = 0;
  for (let i = 0; i < limit; i += 1) {
    const byte = bytes[i];
    if (byte === 0) return true;
    if (byte < 9 || (byte > 13 && byte < 32 && byte !== 27)) control += 1;
  }
  return limit > 0 && control / limit > 0.02;
}

/** UTF-8 (BOM stripped), UTF-16 with a BOM, otherwise windows-1252. */
function decodeText(bytes) {
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder("utf-16le").decode(bytes);
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder("utf-16be").decode(bytes);
  let text;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    text = new TextDecoder("windows-1252").decode(bytes);
  }
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

const DELIMITERS = [",", ";", "\t", "|"];

function countOutsideQuotes(line, delimiter) {
  let count = 0;
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') quoted = !quoted;
    else if (!quoted && ch === delimiter) count += 1;
  }
  return count;
}

/** Pick the delimiter that splits the first lines most consistently. */
function sniffDelimiter(text) {
  const lines = [];
  let start = 0;
  while (lines.length < 25 && start < text.length) {
    let end = text.indexOf("\n", start);
    if (end === -1) end = text.length;
    const line = text.slice(start, end).replace(/\r$/, "");
    if (line.trim() !== "") lines.push(line);
    start = end + 1;
  }
  if (!lines.length) return ",";
  let best = ",";
  let bestScore = 0;
  for (const delimiter of DELIMITERS) {
    const counts = lines.map((line) => countOutsideQuotes(line, delimiter));
    if (counts[0] === 0) continue;
    const consistent = counts.filter((count) => count === counts[0]).length / counts.length;
    const score = consistent * 1000 + Math.min(counts[0], 999) / 1000;
    if (score > bestScore) {
      best = delimiter;
      bestScore = score;
    }
  }
  return best;
}

/**
 * RFC 4180 parser: quoted fields, doubled quotes, line breaks inside quotes, CRLF / LF / CR.
 * Empty fields become null. Returns one array per physical record (blank lines included,
 * so "header row 3" means the third line of the file).
 */
export function parseDelimited(text, delimiter = ",") {
  const rows = [];
  const length = text.length;
  const separator = delimiter.charCodeAt(0);
  let row = [];
  let i = 0;
  while (i < length) {
    let value;
    if (text.charCodeAt(i) === 34) {
      let j = i + 1;
      value = "";
      for (;;) {
        const quote = text.indexOf('"', j);
        if (quote === -1) {
          value += text.slice(j);
          j = length;
          break;
        }
        if (text.charCodeAt(quote + 1) === 34) {
          value += text.slice(j, quote + 1);
          j = quote + 2;
          continue;
        }
        value += text.slice(j, quote);
        j = quote + 1;
        break;
      }
      let k = j;
      while (k < length) {
        const code = text.charCodeAt(k);
        if (code === separator || code === 10 || code === 13) break;
        k += 1;
      }
      if (k > j) value += text.slice(j, k);
      i = k;
    } else {
      let k = i;
      while (k < length) {
        const code = text.charCodeAt(k);
        if (code === separator || code === 10 || code === 13) break;
        k += 1;
      }
      value = text.slice(i, k);
      i = k;
    }
    row.push(value === "" ? null : value);
    if (i >= length) break;
    const code = text.charCodeAt(i);
    if (code === separator) {
      i += 1;
      if (i >= length) row.push(null);
      continue;
    }
    i += code === 13 && text.charCodeAt(i + 1) === 10 ? 2 : 1;
    rows.push(row);
    row = [];
  }
  if (row.length) rows.push(row);
  return rows;
}

const isBlankCell = (value) =>
  value === null || value === undefined || (typeof value === "string" && (value === "" || value.trim() === ""));

/** Trim trailing empty cells and rows; measure the used range. */
function finishSheet(name, grid, extra = {}) {
  let lastRow = -1;
  let colCount = 0;
  for (let r = 0; r < grid.length; r += 1) {
    const row = grid[r];
    let last = row.length - 1;
    while (last >= 0 && isBlankCell(row[last])) last -= 1;
    if (last + 1 !== row.length) row.length = last + 1;
    if (last >= 0) {
      lastRow = r;
      if (last + 1 > colCount) colCount = last + 1;
    }
  }
  grid.length = lastRow + 1;
  return { name, grid, rowCount: grid.length, colCount, errorCells: 0, ...extra };
}

function readTextWorkbook(bytes, fileName, extension) {
  if (looksBinary(bytes) && !(bytes[0] === 0xff && bytes[1] === 0xfe) && !(bytes[0] === 0xfe && bytes[1] === 0xff)) {
    throw fail(
      "CORRUPT_FILE",
      `"${fileName}" does not look like a text file. It may be damaged, or it is not really a ${extension.toUpperCase()} file.`,
    );
  }
  let text = decodeText(bytes);
  let delimiter = extension === "tsv" ? "\t" : null;
  const hint = /^sep=(.)\r?\n/i.exec(text);
  if (hint) {
    delimiter = hint[1];
    text = text.slice(hint[0].length);
  }
  if (!delimiter) delimiter = sniffDelimiter(text);
  const baseName = String(fileName || "").replace(/\.[^.]*$/, "");
  const sheet = finishSheet(sanitizeSheetName(baseName, "Sheet1"), parseDelimited(text, delimiter));
  return { fileName, format: extension, sheets: [sheet] };
}

const dateFormatCache = new Map();

function isDateFormat(format) {
  let known = dateFormatCache.get(format);
  if (known === undefined) {
    const text = String(format);
    try {
      known = text !== "General" && XLSX.SSF.is_date(text);
    } catch {
      known = false;
    }
    if (dateFormatCache.size > 500) dateFormatCache.clear();
    dateFormatCache.set(format, known);
  }
  return known;
}

const ELAPSED_TIME = /\[(?:h+|m+|s+)\]/i;
const pad2 = (n) => (n < 10 ? `0${n}` : String(n));

/** A date-formatted number -> Date, a time of day -> "HH:mm[:ss]", a duration -> its Excel text. */
function dateCellValue(serial, format, date1904) {
  if (ELAPSED_TIME.test(String(format))) {
    try {
      return XLSX.SSF.format(String(format), serial);
    } catch {
      return serial;
    }
  }
  const value = date1904 ? serial + 1462 : serial;
  if (value < 0) return serial;
  if (value < 1) {
    const seconds = Math.round(value * 86400);
    const text = `${pad2(Math.floor(seconds / 3600) % 24)}:${pad2(Math.floor(seconds / 60) % 60)}`;
    return seconds % 60 ? `${text}:${pad2(seconds % 60)}` : text;
  }
  return excelSerialToDate(value) || serial;
}

function sheetToGrid(name, worksheet, date1904) {
  const data = (worksheet && worksheet["!data"]) || [];
  const grid = new Array(data.length);
  let errorCells = 0;
  for (let r = 0; r < data.length; r += 1) {
    const cells = data[r];
    if (!cells) {
      grid[r] = [];
      continue;
    }
    const width = cells.length;
    const row = new Array(width);
    for (let c = 0; c < width; c += 1) {
      const cell = cells[c];
      let value = null;
      if (cell) {
        switch (cell.t) {
          case "n":
            value = cell.v;
            if (typeof value !== "number" || Number.isNaN(value)) value = null;
            else if (cell.z !== undefined && isDateFormat(cell.z)) value = dateCellValue(value, cell.z, date1904);
            break;
          case "s":
            value = cell.v === "" || cell.v === undefined || cell.v === null ? null : String(cell.v);
            break;
          case "b":
            value = cell.v ? "TRUE" : "FALSE";
            break;
          case "d":
            value = cell.v instanceof Date && !Number.isNaN(cell.v.getTime()) ? cell.v : null;
            break;
          case "e":
            errorCells += 1;
            break;
          default:
            break;
        }
      }
      row[c] = value;
    }
    grid[r] = row;
  }
  return finishSheet(name, grid, { errorCells });
}

const READ_OPTIONS = {
  type: "array",
  dense: true,
  cellDates: false, // keep raw serial numbers: no time-zone-dependent Date construction
  cellNF: true, // the number format tells us which numbers are dates
  cellText: false,
  cellFormula: false,
  cellHTML: false,
  cellStyles: false,
};

function readSpreadsheet(bytes, fileName, extension, extraOptions) {
  let book;
  try {
    book = XLSX.read(bytes, { ...READ_OPTIONS, ...extraOptions });
  } catch (error) {
    const message = String((error && error.message) || error || "");
    if (/password|encrypt/i.test(message)) {
      throw fail(
        "PASSWORD_PROTECTED",
        `"${fileName}" is password-protected. Remove the password in Excel (File > Info > Protect Workbook), save it and upload it again.`,
      );
    }
    throw fail("CORRUPT_FILE", `"${fileName}" could not be read. The file may be damaged or is not a real Excel file.`);
  }
  const date1904 = Boolean(book && book.Workbook && book.Workbook.WBProps && book.Workbook.WBProps.date1904);
  const names = (book && book.SheetNames) || [];
  const sheets = [];
  for (const name of names) {
    sheets.push(sheetToGrid(name, book.Sheets[name], date1904));
    book.Sheets[name] = null; // release SheetJS's cell objects as we go
  }
  return { fileName, format: extension, sheets };
}

/**
 * Parse a file into the engine's workbook structure.
 *
 * @param {ArrayBuffer | Uint8Array} data
 * @param {string} fileName  decides the format: .xlsx .xlsm .xls .csv .tsv
 * @returns {{ fileName: string, format: string,
 *   sheets: { name: string, grid: any[][], rowCount: number, colCount: number, errorCells: number }[] }}
 * @throws Error with `.code`: UNSUPPORTED_FORMAT | EMPTY_FILE | CORRUPT_FILE | PASSWORD_PROTECTED
 */
export function readWorkbook(data, fileName) {
  const name = String(fileName || "file");
  const extension = extensionOf(name);
  if (!SUPPORTED_EXTENSIONS.has(extension)) {
    throw fail(
      "UNSUPPORTED_FORMAT",
      `"${name}" is not a supported file type. Upload an Excel workbook (.xlsx, .xls) or a CSV file.`,
    );
  }
  const bytes = toBytes(data);
  if (bytes.length === 0) throw fail("EMPTY_FILE", `"${name}" is empty (0 bytes).`);

  const signature = signatureOf(bytes);
  let workbook;
  if (signature === "zip" || signature === "cfb" || (signature === "biff" && extension === "xls")) {
    // Real workbooks, whatever the extension says (an .xlsx renamed to .csv still opens).
    workbook = readSpreadsheet(bytes, name, extension);
  } else if (extension === "xlsx" || extension === "xlsm") {
    throw fail("CORRUPT_FILE", `"${name}" is not a valid Excel workbook. The file may be damaged or was renamed from another format.`);
  } else if (extension === "xls") {
    if (looksBinary(bytes)) {
      throw fail("CORRUPT_FILE", `"${name}" is not a valid Excel workbook. The file may be damaged.`);
    }
    // ".xls" exports from web systems are often HTML or XML tables, or plain tab-separated text.
    const head = decodeText(bytes.subarray(0, 512)).trimStart();
    workbook = head.startsWith("<") ? readSpreadsheet(bytes, name, extension, { raw: true }) : readTextWorkbook(bytes, name, "tsv");
  } else {
    workbook = readTextWorkbook(bytes, name, extension);
  }

  if (!workbook.sheets.length || workbook.sheets.every((sheet) => sheet.rowCount === 0)) {
    throw fail("EMPTY_FILE", `"${name}" has no data in it.`);
  }
  return workbook;
}

/** @returns {{ name: string, rowCount: number, colCount: number }[]} rows and columns of each sheet's used range */
export function listSheets(workbook) {
  return ((workbook && workbook.sheets) || []).map((sheet) => ({
    name: sheet.name,
    rowCount: sheet.rowCount,
    colCount: sheet.colCount,
  }));
}

/* ------------------------------------------------------------------ */
/* reading: workbook -> table                                           */
/* ------------------------------------------------------------------ */

function columnLetter(index) {
  let n = index;
  let out = "";
  do {
    out = String.fromCharCode(65 + (n % 26)) + out;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return out;
}

const normalize = (name) => String(name).replace(/\s+/g, " ").trim().toLowerCase();

/**
 * Read the header and data rows of one sheet.
 * @returns {{ names: string[], sourceIndexes: number[], rows: any[][], renamed: number, unnamed: number }}
 * @throws EMPTY_SHEET
 */
function readSheet(sheet, headerRow) {
  const grid = sheet.grid;
  if (!grid.length) throw fail("EMPTY_SHEET", `The sheet "${sheet.name}" is empty.`);
  const header = grid[headerRow - 1] || [];
  if (headerRow > grid.length || header.every(isBlankCell)) {
    throw fail(
      "EMPTY_SHEET",
      `Row ${headerRow} of "${sheet.name}" has no column names. Choose the row that holds the headers.`,
    );
  }

  // Columns in use: those with a header, or with at least one value below it.
  let width = header.length;
  for (let r = headerRow; r < grid.length; r += 1) if (grid[r].length > width) width = grid[r].length;
  const used = new Uint8Array(width);
  let pending = 0;
  for (let c = 0; c < width; c += 1) {
    if (!isBlankCell(header[c])) used[c] = 1;
    else pending += 1;
  }
  for (let r = headerRow; r < grid.length && pending > 0; r += 1) {
    const row = grid[r];
    for (let c = 0; c < row.length; c += 1) {
      if (!used[c] && !isBlankCell(row[c])) {
        used[c] = 1;
        pending -= 1;
      }
    }
  }

  const names = [];
  const sourceIndexes = [];
  let renamed = 0;
  let unnamed = 0;
  for (let c = 0; c < width; c += 1) {
    if (!used[c]) continue;
    let base;
    if (isBlankCell(header[c])) {
      base = `Column ${columnLetter(c)}`;
      unnamed += 1;
    } else {
      base = toText(header[c]).replace(/\s+/g, " ").trim();
    }
    const name = uniqueName(base, names);
    if (name !== base && !isBlankCell(header[c])) renamed += 1;
    names.push(name);
    sourceIndexes.push(c);
  }

  const count = names.length;
  const contiguous = sourceIndexes.every((index, position) => index === position);
  const rows = [];
  for (let r = headerRow; r < grid.length; r += 1) {
    const source = grid[r];
    if (source.length === 0) continue;
    let out;
    let empty = true;
    if (contiguous) {
      out = source.length > count ? source.slice(0, count) : source.slice();
      for (let c = 0; c < out.length; c += 1) {
        const value = out[c];
        if (value === null) continue;
        if (typeof value === "string" && isBlankCell(value)) out[c] = null;
        else empty = false;
      }
      for (let c = out.length; c < count; c += 1) out[c] = null;
    } else {
      out = new Array(count);
      for (let c = 0; c < count; c += 1) {
        const value = source[sourceIndexes[c]];
        if (isBlankCell(value)) out[c] = null;
        else {
          out[c] = value;
          empty = false;
        }
      }
    }
    if (!empty) rows.push(out);
  }
  if (!rows.length) {
    throw fail("EMPTY_SHEET", `No data rows were found below row ${headerRow} of "${sheet.name}".`);
  }
  return { names, sourceIndexes, rows, renamed, unnamed };
}

// "1,200", "12,34,567.50": thousands-grouped amounts (western or Indian grouping), no leading zero.
const GROUPED_NUMBER = /^-?[1-9]\d{0,2}(?:,\d{3})+(?:\.\d+)?$|^-?[1-9]\d?(?:,\d{2})+,\d{3}(?:\.\d+)?$/;

/** Text that is unambiguously a number. Codes such as "00123", "+9198..." or "1,2" stay text. */
export function isNumericText(text) {
  if (isStrictNumeric(text)) return true;
  const s = text.trim();
  return s.length <= 24 && GROUPED_NUMBER.test(s);
}

const numericTextValue = (text) => Number(text.trim().replace(/,/g, ""));

/**
 * Decide each column's type and convert text that is really a number or a date.
 * number: every non-empty value is a number or numeric text ("00123" stays text, "1,200" is a number)
 * date:   every non-empty value is a Date or text that `toDate` understands (day-first)
 */
function inferColumns(names, rows, lockedText) {
  const columns = [];
  for (let c = 0; c < names.length; c += 1) {
    let canBeNumber = !lockedText.has(c);
    let canBeDate = canBeNumber;
    let hasText = false;
    let seen = 0;
    for (let r = 0; r < rows.length && (canBeNumber || canBeDate); r += 1) {
      const value = rows[r][c];
      if (value === null) continue;
      seen += 1;
      if (typeof value === "number") canBeDate = false;
      else if (value instanceof Date) canBeNumber = false;
      else if (typeof value === "string") {
        hasText = true;
        if (canBeNumber && !isNumericText(value)) canBeNumber = false;
        if (canBeDate && !toDate(value)) canBeDate = false;
      } else {
        canBeNumber = false;
        canBeDate = false;
      }
    }
    let type = "text";
    if (seen > 0 && canBeNumber) type = "number";
    else if (seen > 0 && canBeDate) type = "date";
    if (type !== "text" && hasText) {
      for (let r = 0; r < rows.length; r += 1) {
        const value = rows[r][c];
        if (typeof value === "string") rows[r][c] = type === "number" ? numericTextValue(value) : toDate(value);
      }
    }
    columns.push({ name: names[c], type, index: c });
  }
  return columns;
}

/**
 * Build the working table from one or more sheets.
 *
 * - `headerRow` is 1-based; rows above it are ignored.
 * - Blank headers become "Column C" (the sheet's column letter); repeated headers get " (2)", " (3)".
 * - Rows with no values are dropped. Columns with no header and no values are dropped.
 * - Several sheets are stacked: columns are matched by header name (ignoring case and extra
 *   spaces), missing ones are left empty, and a "Source Sheet" column is appended.
 *
 * @param {object} workbook  from readWorkbook
 * @param {{ sheetNames?: string[], headerRow?: number }} [options]  no sheet names = the first sheet with data
 * @returns {{ columns: { name: string, type: 'text'|'number'|'date', index: number }[], rows: any[][],
 *             sheetNames: string[], headerRow: number, warnings: string[] }}
 * @throws Error with code EMPTY_SHEET
 */
export function buildTable(workbook, options = {}) {
  const headerRow = Math.max(1, Math.floor(Number(options && options.headerRow) || 1));
  const available = (workbook && workbook.sheets) || [];
  const wanted = Array.isArray(options && options.sheetNames) ? options.sheetNames.filter(Boolean) : [];

  let selected;
  if (wanted.length) {
    selected = [];
    for (const name of wanted) {
      const sheet = available.find((s) => s.name === name) || available.find((s) => normalize(s.name) === normalize(name));
      if (sheet && !selected.includes(sheet)) selected.push(sheet);
    }
    if (!selected.length) throw fail("EMPTY_SHEET", `The sheet "${wanted[0]}" was not found in this file.`);
  } else {
    const first = available.find((sheet) => sheet.rowCount > 0) || available[0];
    if (!first) throw fail("EMPTY_SHEET", "This file has no sheets.");
    selected = [first];
  }

  const warnings = [];
  const parts = [];
  let firstError = null;
  for (const sheet of selected) {
    try {
      parts.push({ sheet, ...readSheet(sheet, headerRow) });
    } catch (error) {
      if (!firstError) firstError = error;
      if (selected.length > 1) warnings.push(`"${sheet.name}" was skipped: ${error.message}`);
    }
  }
  if (!parts.length) throw firstError;

  const renamed = parts.reduce((total, part) => total + part.renamed, 0);
  const unnamed = parts.reduce((total, part) => total + part.unnamed, 0);
  const errorCells = parts.reduce((total, part) => total + (part.sheet.errorCells || 0), 0);
  if (renamed) warnings.push(`${plural(renamed, "duplicate column name was", "duplicate column names were")} renamed.`);
  if (unnamed) {
    warnings.push(`${plural(unnamed, "column had no header and was", "columns had no header and were")} named after the sheet column.`);
  }
  if (errorCells) {
    warnings.push(`${plural(errorCells, "cell with an Excel error (such as #N/A) was", "cells with Excel errors (such as #N/A) were")} read as empty.`);
  }

  let names;
  let rows;
  const lockedText = new Set();
  if (parts.length === 1) {
    names = parts[0].names;
    rows = parts[0].rows;
  } else {
    // Stack the sheets: union of columns by normalised header name, in first-seen order.
    names = [];
    const position = new Map();
    for (const part of parts) {
      part.target = part.names.map((name) => {
        const key = normalize(name);
        let at = position.get(key);
        if (at === undefined) {
          at = names.length;
          position.set(key, at);
          names.push(name);
        }
        return at;
      });
    }
    if (parts.some((part) => part.names.length !== names.length)) {
      warnings.push("The selected sheets do not have the same columns. Values a sheet does not have were left empty.");
    }
    const sourceAt = names.length;
    names.push(uniqueName(SOURCE_SHEET, names));
    lockedText.add(sourceAt);
    const width = names.length;
    rows = [];
    for (const part of parts) {
      const target = part.target;
      for (let r = 0; r < part.rows.length; r += 1) {
        const source = part.rows[r];
        const out = new Array(width).fill(null);
        for (let c = 0; c < target.length; c += 1) out[target[c]] = source[c];
        out[sourceAt] = part.sheet.name;
        rows.push(out);
      }
    }
  }

  return {
    columns: inferColumns(names, rows, lockedText),
    rows,
    sheetNames: parts.map((part) => part.sheet.name),
    headerRow,
    warnings,
  };
}

/* ------------------------------------------------------------------ */
/* writing                                                              */
/* ------------------------------------------------------------------ */

const DAY_MS = 86400000;

/** One result -> a dense SheetJS worksheet (header row + typed cells + column widths). */
function resultToSheet(result) {
  const columns = (result && result.columns) || [];
  const rows = (result && result.rows) || [];
  const width = columns.length;
  if (rows.length + 1 > MAX_XLSX_ROWS) {
    throw fail(
      "INVALID_DEFINITION",
      `An Excel sheet holds at most ${(MAX_XLSX_ROWS - 1).toLocaleString("en-US")} rows. Save this output as CSV or filter it down.`,
    );
  }
  if (width > MAX_XLSX_COLUMNS) throw fail("INVALID_DEFINITION", "An Excel sheet holds at most 16,384 columns.");

  const numberFormats = columns.map((column) =>
    column.format && column.format.type === "numberFormat" ? excelNumberFormat(column.format) : null,
  );
  const dateFormats = columns.map((column) =>
    column.format && column.format.type === "dateFormat" ? excelNumberFormat(column.format) : null,
  );

  const data = new Array(rows.length + 1);
  data[0] = columns.map((column) => ({ t: "s", v: String(column.name ?? "") }));
  for (let r = 0; r < rows.length; r += 1) {
    const row = rows[r];
    const cells = new Array(width);
    for (let c = 0; c < width; c += 1) {
      const value = row[c];
      if (value === null || value === undefined || value === "") continue;
      if (typeof value === "number") {
        if (!Number.isFinite(value)) continue;
        cells[c] = numberFormats[c] ? { t: "n", v: value, z: numberFormats[c] } : { t: "n", v: value };
      } else if (typeof value === "string") {
        cells[c] = { t: "s", v: value.length > MAX_CELL_TEXT ? value.slice(0, MAX_CELL_TEXT) : value };
      } else if (value instanceof Date) {
        const time = value.getTime();
        if (Number.isNaN(time)) continue;
        const hasTime = ((time % DAY_MS) + DAY_MS) % DAY_MS !== 0;
        cells[c] = {
          t: "n",
          v: dateToExcelSerial(value),
          z: dateFormats[c] || (hasTime ? "yyyy-mm-dd hh:mm" : "yyyy-mm-dd"),
        };
      } else if (typeof value === "boolean") {
        cells[c] = { t: "b", v: value };
      } else {
        cells[c] = { t: "s", v: String(value) };
      }
    }
    data[r + 1] = cells;
  }

  // Column widths from the header and a sample of the rows, as the user will see them.
  const sample = Math.min(rows.length, 500);
  const widths = columns.map((column, c) => {
    let longest = String(column.name ?? "").length;
    const format = column.format || null;
    for (let r = 0; r < sample; r += 1) {
      const length = formatDisplay(rows[r][c], format).length;
      if (length > longest) longest = length;
    }
    return { wch: Math.max(8, Math.min(60, longest + 2)) };
  });

  return {
    "!data": data,
    "!ref": XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: rows.length, c: Math.max(width - 1, 0) } }),
    "!cols": widths,
  };
}

/**
 * Write several results as the sheets of one .xlsx workbook.
 * Sheet names are sanitised and made unique ("Sheet1", "Sheet1 (2)").
 *
 * @param {{ result: { columns: object[], rows: any[][] }, sheetName?: string }[]} sheets
 * @returns {Uint8Array}
 */
export function writeXlsxBook(sheets) {
  const book = XLSX.utils.book_new();
  const used = [];
  for (const entry of sheets || []) {
    const base = sanitizeSheetName(entry && entry.sheetName);
    let name = uniqueName(base, used);
    if (name.length > 31) name = uniqueName(base.slice(0, 26), used);
    used.push(name);
    XLSX.utils.book_append_sheet(book, resultToSheet(entry && entry.result), name);
  }
  if (!used.length) XLSX.utils.book_append_sheet(book, resultToSheet({ columns: [], rows: [] }), "Sheet1");
  const out = XLSX.write(book, { type: "array", bookType: "xlsx", compression: true });
  return out instanceof Uint8Array ? out : new Uint8Array(out);
}

/**
 * Write a pipeline result as an .xlsx workbook with one sheet.
 * Numbers and dates are real numeric cells; a column format becomes the cell's number
 * format, and dates without one are written as yyyy-mm-dd (with hh:mm when they have a time).
 *
 * @param {{ columns: { name: string, format?: object|null }[], rows: any[][] }} result
 * @param {{ sheetName?: string }} [options]
 * @returns {Uint8Array}
 */
export function writeXlsx(result, options = {}) {
  return writeXlsxBook([{ result, sheetName: options && options.sheetName }]);
}

const NEEDS_QUOTES = /[",\r\n]|^\s|\s$/;

function csvField(text) {
  if (text === "") return "";
  return NEEDS_QUOTES.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/**
 * Write a pipeline result as CSV: UTF-8 with a BOM (so Excel reads it as UTF-8),
 * comma-separated, CRLF line ends, RFC 4180 quoting. Values are the formatted display strings.
 * @returns {Uint8Array}
 */
export function writeCsv(result) {
  const columns = (result && result.columns) || [];
  const rows = (result && result.rows) || [];
  const width = columns.length;
  const formats = columns.map((column) => column.format || null);
  const lines = new Array(rows.length + 1);
  lines[0] = columns.map((column) => csvField(String(column.name ?? ""))).join(",");
  for (let r = 0; r < rows.length; r += 1) {
    const row = rows[r];
    let line = "";
    for (let c = 0; c < width; c += 1) {
      const format = formats[c];
      const text = format ? formatDisplay(row[c], format) : toText(row[c]);
      line += c === 0 ? csvField(text) : `,${csvField(text)}`;
    }
    lines[r + 1] = line;
  }
  return new TextEncoder().encode(`﻿${lines.join("\r\n")}\r\n`);
}

/**
 * Run one output of a workflow and write its file.
 *
 * @param {{ columns: object[], rows: any[][] }} table
 * @param {object} definition
 * @param {string} outputId
 * @param {{ result?: object }} [options]  pass an existing runPipeline result to skip the run
 * @returns {{ fileName: string, mime: string, bytes: Uint8Array, rowCount: number }}
 * @throws Error with code INVALID_DEFINITION when the output is missing or has no columns
 */
export function buildOutputFile(table, definition, outputId, options = {}) {
  const outputs = (definition && Array.isArray(definition.outputs) && definition.outputs) || [];
  const output = outputs.find((candidate) => candidate && candidate.id === outputId);
  if (!output) throw fail("INVALID_DEFINITION", "That output no longer exists.");
  const result = (options && options.result) || runPipeline(table, definition, { outputId });
  if (!result.columns.length) {
    throw fail("INVALID_DEFINITION", `"${output.name || "This output"}" has no columns to export.`);
  }
  const fileType = output.fileType === "csv" ? "csv" : "xlsx";
  const bytes = fileType === "csv" ? writeCsv(result) : writeXlsx(result, { sheetName: output.sheetName });
  return { fileName: outputFileName(output), mime: FILE_TYPES[fileType].mime, bytes, rowCount: result.totalRows };
}

/** ["a.xlsx", "A.xlsx", "b.csv"] -> ["a.xlsx", "A (2).xlsx", "b.csv"] (comparison ignores case). */
export function uniqueFileNames(names) {
  const taken = new Set();
  return (names || []).map((raw) => {
    const name = String(raw || "file");
    const dot = name.lastIndexOf(".");
    const stem = dot > 0 ? name.slice(0, dot) : name;
    const extension = dot > 0 ? name.slice(dot) : "";
    let candidate = name;
    let n = 2;
    while (taken.has(candidate.toLowerCase())) {
      candidate = `${stem} (${n})${extension}`;
      n += 1;
    }
    taken.add(candidate.toLowerCase());
    return candidate;
  });
}

/** "My export" -> "My export.zip" (unsafe characters removed). */
export function zipFileName(name) {
  const cleaned = sanitizeFileName(String(name ?? "").replace(/\.zip$/i, ""), "outputs");
  return `${cleaned}.zip`;
}

/**
 * Bundle files into one zip. Duplicate names get " (2)", " (3)".
 * @param {{ fileName: string, bytes: Uint8Array }[]} files
 * @returns {Promise<{ bytes: Uint8Array, fileNames: string[] }>}
 */
/**
 * Zip entries store a time without a time zone and JSZip writes it in UTC, so archive tools
 * would show the wrong hour. Shift "now" so the stored wall-clock time is the local one.
 */
export function zipEntryDate(now = new Date()) {
  return new Date(now.getTime() - now.getTimezoneOffset() * 60_000);
}

export async function zipFiles(files) {
  const list = files || [];
  const fileNames = uniqueFileNames(list.map((file) => file.fileName));
  const zip = new JSZip();
  const date = zipEntryDate();
  list.forEach((file, index) => {
    // .xlsx is already a compressed zip; only text files are worth deflating again.
    const compress = !/\.xlsx$/i.test(fileNames[index]);
    zip.file(fileNames[index], file.bytes, { binary: true, date, compression: compress ? "DEFLATE" : "STORE" });
  });
  const bytes = await zip.generateAsync({ type: "uint8array" });
  return { bytes, fileNames };
}
