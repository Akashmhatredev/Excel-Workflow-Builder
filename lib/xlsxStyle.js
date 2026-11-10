/**
 * lib/xlsxStyle.js: styling that SheetJS community edition cannot write, added to the .xlsx
 * bytes afterwards with JSZip.
 *
 *   sheetStyle.boldHeader   a bold font (a new cellXfs entry) on the header cells
 *   sheetStyle.freezeHeader a frozen first row (a sheetView pane)
 *   sheetStyle.autoFilter   an auto filter over the header and data (plus its _xlnm._FilterDatabase name)
 *   conditionalFormats      real Excel conditional formatting (<dxfs> in styles.xml, <conditionalFormatting>
 *                           in the sheet), evaluated like lib/conditional.js so Excel shows what the preview shows
 *
 * Mapping of the rule operators (first matching rule wins, through stopIfTrue):
 *   gt gte lt lte equals notEquals between -> cellIs (a date without a time compares whole days, so
 *                                             "equals 2024-01-05" becomes "between 45296 and 45296.99999")
 *   contains                               -> containsText (SEARCH with Excel wildcards escaped)
 *   isEmpty / notEmpty                     -> containsBlanks / notContainsBlanks
 * Excel compares a blank cell as 0 or "", the app never lets a blank match a comparison. So each column
 * with rules starts with one containsBlanks rule (stopIfTrue): it carries the style of the first
 * "is empty" / "does not equal" rule, or no format at all, and stops blanks from reaching the comparisons.
 *
 * Elements are inserted where the SpreadsheetML schema puts them (Excel refuses misordered files).
 * The sheet XML is spliced as bytes: only the part up to the header row and the part after
 * </sheetData> are decoded, so a 100k-row sheet is not turned into one giant string.
 */

import JSZip from "jszip";
import { resolveConditionalFormats } from "./conditional.js";
import { compareValues } from "./filters.js";
import { HIGHLIGHT_STYLES } from "./schema.js";
import { cleanNumber, dateToExcelSerial, toDate, toNumber, toText } from "./transforms.js";

const DAY_MS = 86400000;
const DAY_END = 86399 / 86400; // 23:59:59 as a fraction of a day
const DEFLATE_LEVEL = 3; // faster than the default 6, and still about half the size SheetJS writes
const MAX_FORMULA_TEXT = 255; // Excel's limit for a text literal in a formula

/** CT_Worksheet children, in schema order. */
const WORKSHEET_CHILDREN = [
  "sheetPr", "dimension", "sheetViews", "sheetFormatPr", "cols", "sheetData", "sheetCalcPr", "sheetProtection",
  "protectedRanges", "scenarios", "autoFilter", "sortState", "dataConsolidate", "customSheetViews", "mergeCells",
  "phoneticPr", "conditionalFormatting", "dataValidations", "hyperlinks", "printOptions", "pageMargins", "pageSetup",
  "headerFooter", "rowBreaks", "colBreaks", "customProperties", "cellWatches", "ignoredErrors", "smartTags", "drawing",
  "legacyDrawing", "legacyDrawingHF", "drawingHF", "picture", "oleObjects", "controls", "webPublishItems", "tableParts",
  "extLst",
];
/** CT_Workbook children, in schema order. */
const WORKBOOK_CHILDREN = [
  "fileVersion", "fileSharing", "workbookPr", "workbookProtection", "bookViews", "sheets", "functionGroups",
  "externalReferences", "definedNames", "calcPr", "oleSize", "customWorkbookViews", "pivotCaches", "smartTagPr",
  "smartTagTypes", "webPublishing", "fileRecoveryPr", "webPublishObjects", "extLst",
];
/** CT_Stylesheet children, in schema order. */
const STYLESHEET_CHILDREN = [
  "numFmts", "fonts", "fills", "borders", "cellStyleXfs", "cellXfs", "cellStyles", "dxfs", "tableStyles", "colors", "extLst",
];

const CELL_IS = {
  gt: "greaterThan",
  gte: "greaterThanOrEqual",
  lt: "lessThan",
  lte: "lessThanOrEqual",
  equals: "equal",
  notEquals: "notEqual",
  between: "between",
};
/** Comparisons Excel would let a blank cell match (as 0 or "") while the app does not. */
const BLANK_RISK = new Set(["gt", "gte", "lt", "lte", "equals", "between"]);

const FROZEN_PANE =
  '<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>' +
  '<selection pane="bottomLeft" activeCell="A2" sqref="A2"/>';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/* ------------------------------------------------------------------ */
/* small helpers                                                        */
/* ------------------------------------------------------------------ */

export function escapeXml(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function unescapeXml(text) {
  return String(text)
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&amp;/g, "&");
}

/** 0 -> "A", 26 -> "AA". */
export function columnLetter(index) {
  let n = index;
  let out = "";
  do {
    out = String.fromCharCode(65 + (n % 26)) + out;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return out;
}

/**
 * Insert `fragment` where the child element `name` belongs: before the first child that comes
 * after it in `order` (or before the closing tag of the parent), searching from `from`.
 */
function insertChild(xml, order, name, fragment, parent, from = 0) {
  const later = order.slice(order.indexOf(name) + 1);
  const pattern = new RegExp(`<(?:${later.join("|")})[\\s/>]|</${parent}>`, "g");
  pattern.lastIndex = from;
  const match = pattern.exec(xml);
  const at = match ? match.index : xml.length;
  return xml.slice(0, at) + fragment + xml.slice(at);
}

function indexOfBytes(bytes, text, from = 0) {
  const needle = encoder.encode(text);
  const last = bytes.length - needle.length;
  for (let i = bytes.indexOf(needle[0], from); i !== -1 && i <= last; i = bytes.indexOf(needle[0], i + 1)) {
    let j = 1;
    while (j < needle.length && bytes[i + j] === needle[j]) j += 1;
    if (j === needle.length) return i;
  }
  return -1;
}

function lastIndexOfBytes(bytes, text) {
  const needle = encoder.encode(text);
  let i = bytes.length - needle.length;
  while (i >= 0) {
    i = bytes.lastIndexOf(needle[0], i);
    if (i === -1) return -1;
    let j = 1;
    while (j < needle.length && bytes[i + j] === needle[j]) j += 1;
    if (j === needle.length) return i;
    i -= 1;
  }
  return -1;
}

const argb = (hex) => `FF${String(hex).replace("#", "").toUpperCase()}`;

/* ------------------------------------------------------------------ */
/* conditional formatting rules                                         */
/* ------------------------------------------------------------------ */

function numberLiteral(n) {
  return toText(cleanNumber(n)).toUpperCase();
}

function textLiteral(text) {
  return `"${String(text).slice(0, MAX_FORMULA_TEXT).replace(/"/g, '""')}"`;
}

/** The typed rule value, decided like lib/filters.js: a number, else a date, else text. */
function excelOperand(value) {
  const text = String(value ?? "").trim();
  const n = toNumber(text);
  if (n !== null) return { kind: "number", value: n };
  const date = toDate(text);
  if (date) {
    const time = date.getTime();
    return { kind: "date", value: dateToExcelSerial(date), wholeDay: ((time % DAY_MS) + DAY_MS) % DAY_MS === 0 };
  }
  return { kind: "text", value: text };
}

const operandLiteral = (operand) => (operand.kind === "text" ? textLiteral(operand.value) : numberLiteral(operand.value));

/** cellIs operator and formulas for a comparison rule. */
export function cellIsRule(operator, value, value2) {
  if (operator === "between") {
    const swap = compareValues(value, value2) > 0;
    const low = excelOperand(swap ? value2 : value);
    const high = excelOperand(swap ? value : value2);
    const top = high.kind === "date" && high.wholeDay ? numberLiteral(high.value + DAY_END) : operandLiteral(high);
    return { operator: "between", formulas: [operandLiteral(low), top] };
  }
  const operand = excelOperand(value);
  if (operand.kind === "date" && operand.wholeDay) {
    const day = operand.value;
    switch (operator) {
      case "gt":
        return { operator: "greaterThanOrEqual", formulas: [numberLiteral(day + 1)] };
      case "gte":
        return { operator: "greaterThanOrEqual", formulas: [numberLiteral(day)] };
      case "lt":
        return { operator: "lessThan", formulas: [numberLiteral(day)] };
      case "lte":
        return { operator: "lessThan", formulas: [numberLiteral(day + 1)] };
      case "equals":
        return { operator: "between", formulas: [numberLiteral(day), numberLiteral(day + DAY_END)] };
      case "notEquals":
        return { operator: "notBetween", formulas: [numberLiteral(day), numberLiteral(day + DAY_END)] };
      default:
        break;
    }
  }
  return { operator: CELL_IS[operator], formulas: [operandLiteral(operand)] };
}

const dxfKey = (entry) => `${entry.style}|${entry.bold ? 1 : 0}`;

function dxfXml(key) {
  const [style, bold] = key.split("|");
  const spec = HIGHLIGHT_STYLES[style] || HIGHLIGHT_STYLES.red;
  const fill = argb(spec.fill);
  return (
    `<dxf><font>${bold === "1" ? "<b/>" : ""}<color rgb="${argb(spec.color)}"/></font>` +
    `<fill><patternFill patternType="solid"><fgColor rgb="${fill}"/><bgColor rgb="${fill}"/></patternFill></fill></dxf>`
  );
}

/**
 * <conditionalFormatting> blocks for one sheet: one block per column, rules in list order.
 * @param {{ rule, column, style, bold }[]} entries  from resolveConditionalFormats
 * @param {number} rowCount  data rows (the header is row 1)
 * @param {(key: string) => number} dxfIdOf
 * @param {{ next: number }} priority  shared counter (priorities are unique per sheet)
 */
export function conditionalFormattingXml(entries, rowCount, dxfIdOf, priority = { next: 1 }) {
  if (!entries.length || rowCount < 1) return "";
  const byColumn = new Map();
  for (const entry of entries) {
    if (!byColumn.has(entry.column)) byColumn.set(entry.column, []);
    byColumn.get(entry.column).push(entry);
  }
  let xml = "";
  for (const column of [...byColumn.keys()].sort((a, b) => a - b)) {
    const list = byColumn.get(column);
    const letter = columnLetter(column);
    const cell = `${letter}2`;
    const rules = [];
    const open = (type, entry, extra = "") => {
      const dxf = entry ? ` dxfId="${dxfIdOf(dxfKey(entry))}"` : "";
      const attrs = `<cfRule type="${type}"${dxf} priority="${priority.next}" stopIfTrue="1"${extra}>`;
      priority.next += 1;
      return attrs;
    };
    const formula = (text) => `<formula>${escapeXml(text)}</formula>`;

    const blank = list.find((entry) => entry.rule.operator === "isEmpty" || entry.rule.operator === "notEquals");
    if (blank || list.some((entry) => BLANK_RISK.has(entry.rule.operator))) {
      rules.push(`${open("containsBlanks", blank)}${formula(`LEN(TRIM(${cell}))=0`)}</cfRule>`);
    }
    for (const entry of list) {
      const { operator, value, value2 } = entry.rule;
      if (operator === "isEmpty") continue; // only blanks match it: the rule above covers them
      if (operator === "notEmpty") {
        rules.push(`${open("notContainsBlanks", entry)}${formula(`LEN(TRIM(${cell}))>0`)}</cfRule>`);
      } else if (operator === "contains") {
        const text = String(value);
        const pattern = textLiteral(text.replace(/[~*?]/g, "~$&"));
        rules.push(
          `${open("containsText", entry, ` operator="containsText" text="${escapeXml(text)}"`)}` +
            `${formula(`NOT(ISERROR(SEARCH(${pattern},${cell})))`)}</cfRule>`,
        );
      } else {
        const spec = cellIsRule(operator, value, value2);
        rules.push(`${open("cellIs", entry, ` operator="${spec.operator}"`)}${spec.formulas.map(formula).join("")}</cfRule>`);
      }
    }
    xml += `<conditionalFormatting sqref="${letter}2:${letter}${rowCount + 1}">${rules.join("")}</conditionalFormatting>`;
  }
  return xml;
}

/* ------------------------------------------------------------------ */
/* styles.xml / workbook.xml / sheet XML                                */
/* ------------------------------------------------------------------ */

/** Append items to a counted list element (<fonts count="n">...), creating it when missing. */
function appendToList(xml, tag, itemPattern, items) {
  const match = new RegExp(`<${tag}\\b([^>]*?)(?:/>|>([\\s\\S]*?)</${tag}>)`).exec(xml);
  if (!match) {
    const fragment = `<${tag} count="${items.length}">${items.join("")}</${tag}>`;
    return { xml: insertChild(xml, STYLESHEET_CHILDREN, tag, fragment, "styleSheet"), start: 0 };
  }
  const inner = match[2] || "";
  const count = (inner.match(itemPattern) || []).length;
  const attrs = match[1].replace(/\s+count="[^"]*"/, "");
  const fragment = `<${tag}${attrs} count="${count + items.length}">${inner}${items.join("")}</${tag}>`;
  return { xml: xml.slice(0, match.index) + fragment + xml.slice(match.index + match[0].length), start: count };
}

/** Adds the bold header style and the dxfs; returns their indexes. */
function editStyles(xml, { boldHeader, dxfKeys }) {
  let out = xml;
  let headerXf = -1;
  if (boldHeader) {
    const fonts = /<fonts\b[^>]*>([\s\S]*?)<\/fonts>/.exec(out);
    const first = fonts && /<font\b[^>]*\/>|<font\b[^>]*>[\s\S]*?<\/font>/.exec(fonts[1]);
    let bold = "<font><b/></font>";
    if (first && !first[0].endsWith("/>")) {
      bold = first[0].replace(/<b\b[^>]*\/>/g, "").replace(/^<font\b([^>]*)>/, "<font$1><b/>");
    }
    const font = appendToList(out, "fonts", /<font[\s>/]/g, [bold]);
    out = font.xml;
    const xf = appendToList(out, "cellXfs", /<xf[\s>/]/g, [
      `<xf numFmtId="0" fontId="${font.start}" fillId="0" borderId="0" xfId="0" applyFont="1"/>`,
    ]);
    out = xf.xml;
    headerXf = xf.start;
  }
  let dxfStart = 0;
  if (dxfKeys.length) {
    const dxfs = appendToList(out, "dxfs", /<dxf[\s>/]/g, dxfKeys.map(dxfXml));
    out = dxfs.xml;
    dxfStart = dxfs.start;
  }
  return { xml: out, headerXf, dxfStart };
}

/** Adds (or replaces) the _xlnm._FilterDatabase name an auto filter needs. */
function addFilterDatabase(xml, sheetIndex, ref) {
  const names = [...xml.matchAll(/<sheet\b[^>]*?\bname="([^"]*)"/g)].map((match) => unescapeXml(match[1]));
  const sheetName = names[sheetIndex];
  if (sheetName === undefined) return xml;
  const absolute = ref.replace(/([A-Z]+)(\d+)/g, "$$$1$$$2");
  const target = `'${sheetName.replace(/'/g, "''")}'!${absolute}`;
  const entry = `<definedName name="_xlnm._FilterDatabase" localSheetId="${sheetIndex}" hidden="1">${escapeXml(target)}</definedName>`;
  const existing = /<definedNames\b[^>]*?(?:\/>|>([\s\S]*?)<\/definedNames>)/.exec(xml);
  if (!existing) {
    const after = xml.indexOf("</sheets>");
    return insertChild(xml, WORKBOOK_CHILDREN, "definedNames", `<definedNames>${entry}</definedNames>`, "workbook", Math.max(after, 0));
  }
  const kept = (existing[1] || "").replace(
    new RegExp(`<definedName\\b(?=[^>]*name="_xlnm\\._FilterDatabase")(?=[^>]*localSheetId="${sheetIndex}")[^>]*>[\\s\\S]*?</definedName>`, "g"),
    "",
  );
  return xml.slice(0, existing.index) + `<definedNames>${kept}${entry}</definedNames>` + xml.slice(existing.index + existing[0].length);
}

/** Edit one worksheet's XML bytes (see the plan built in styleXlsx). */
function editSheet(bytes, plan) {
  const open = indexOfBytes(bytes, "<sheetData");
  if (open === -1) return bytes;
  const gt = bytes.indexOf(62, open); // ">"
  if (gt === -1) return bytes;
  const selfClosing = bytes[gt - 1] === 47; // "/"
  let headEnd = gt + 1;
  let tailStart = headEnd;
  if (!selfClosing) {
    tailStart = lastIndexOfBytes(bytes, "</sheetData>");
    if (tailStart === -1) return bytes;
    const rowEnd = indexOfBytes(bytes, "</row>", gt);
    if (rowEnd !== -1 && rowEnd < tailStart) headEnd = rowEnd + 6;
  }

  let head = decoder.decode(bytes.subarray(0, headEnd));
  let tail = decoder.decode(bytes.subarray(tailStart));

  if (plan.freeze) {
    let attrs = ' workbookViewId="0"';
    const views = /<sheetViews\b[^>]*?(?:\/>|>[\s\S]*?<\/sheetViews>)/.exec(head);
    if (views) {
      const view = /<sheetView\b([^>]*?)\/?>/.exec(views[0]);
      if (view) attrs = view[1];
      head = head.slice(0, views.index) + head.slice(views.index + views[0].length);
    }
    head = insertChild(head, WORKSHEET_CHILDREN, "sheetViews", `<sheetViews><sheetView${attrs}>${FROZEN_PANE}</sheetView></sheetViews>`, "worksheet");
  }

  if (plan.headerXf >= 0) {
    const row = /<row\b[^>]*\br="1"[^>]*>[\s\S]*$/.exec(head);
    if (row) {
      const styled = row[0].replace(/<c\b([^>]*?)(\/?)>/g, (whole, attrs, slash) => `<c${attrs.replace(/\ss="\d*"/, "")} s="${plan.headerXf}"${slash}>`);
      head = head.slice(0, row.index) + styled;
    }
  }

  const tailFrom = selfClosing ? 0 : "</sheetData>".length;
  if (plan.autoFilter) {
    tail = insertChild(tail, WORKSHEET_CHILDREN, "autoFilter", `<autoFilter ref="${plan.filterRef}"/>`, "worksheet", tailFrom);
  }
  if (plan.conditionalXml) {
    tail = insertChild(tail, WORKSHEET_CHILDREN, "conditionalFormatting", plan.conditionalXml, "worksheet", tailFrom);
  }

  const headBytes = encoder.encode(head);
  const tailBytes = encoder.encode(tail);
  const middle = bytes.subarray(headEnd, tailStart);
  const out = new Uint8Array(headBytes.length + middle.length + tailBytes.length);
  out.set(headBytes, 0);
  out.set(middle, headBytes.length);
  out.set(tailBytes, headBytes.length + middle.length);
  return out;
}

/* ------------------------------------------------------------------ */
/* entry point                                                          */
/* ------------------------------------------------------------------ */

function planSheet(sheet, index) {
  const columns = (sheet && sheet.columns) || [];
  if (!columns.length) return null;
  const style = (sheet && sheet.sheetStyle) || {};
  const rowCount = Math.max(0, Math.floor(Number(sheet.rowCount) || 0));
  const entries = rowCount > 0 ? resolveConditionalFormats(sheet.conditionalFormats, columns) : [];
  const plan = {
    index,
    rowCount,
    boldHeader: Boolean(style.boldHeader),
    freeze: Boolean(style.freezeHeader),
    autoFilter: Boolean(style.autoFilter),
    filterRef: `A1:${columnLetter(columns.length - 1)}${rowCount + 1}`,
    entries,
    headerXf: -1,
    conditionalXml: "",
  };
  return plan.boldHeader || plan.freeze || plan.autoFilter || entries.length ? plan : null;
}

/**
 * Style the sheets of an .xlsx written by writeXlsxBook.
 *
 * @param {Uint8Array} bytes
 * @param {{ columns: { key: string }[], rowCount: number,
 *           sheetStyle?: { boldHeader?: boolean, freezeHeader?: boolean, autoFilter?: boolean },
 *           conditionalFormats?: object[] }[]} sheets  one entry per sheet, in workbook order
 *   (a missing sheetStyle means no header styling)
 * @returns {Promise<Uint8Array>}  the same bytes when there is nothing to add
 */
export async function styleXlsx(bytes, sheets) {
  const plans = (sheets || []).map(planSheet).filter(Boolean);
  if (!plans.length) return bytes;
  const zip = await JSZip.loadAsync(bytes);
  const replace = async (path, edit) => {
    const file = zip.file(path);
    if (!file) return false;
    const data = await file.async("uint8array");
    zip.file(path, edit(data), { binary: true, date: file.date });
    return true;
  };

  const dxfKeys = [...new Set(plans.flatMap((plan) => plan.entries.map(dxfKey)))];
  const boldHeader = plans.some((plan) => plan.boldHeader);
  let styles = { headerXf: -1, dxfStart: 0 };
  const stylesEdited = await replace("xl/styles.xml", (data) => {
    styles = editStyles(decoder.decode(data), { boldHeader, dxfKeys });
    return encoder.encode(styles.xml);
  });
  const dxfIndex = new Map(dxfKeys.map((key, i) => [key, styles.dxfStart + i]));

  let workbook = null;
  for (const plan of plans) {
    if (stylesEdited) {
      if (plan.boldHeader) plan.headerXf = styles.headerXf;
      plan.conditionalXml = conditionalFormattingXml(plan.entries, plan.rowCount, (key) => dxfIndex.get(key));
    }
    const edited = await replace(`xl/worksheets/sheet${plan.index + 1}.xml`, (data) => editSheet(data, plan));
    if (edited && plan.autoFilter) {
      if (workbook === null) {
        const file = zip.file("xl/workbook.xml");
        workbook = file ? { file, xml: await file.async("string") } : false;
      }
      if (workbook) workbook.xml = addFilterDatabase(workbook.xml, plan.index, plan.filterRef);
    }
  }
  if (workbook) zip.file("xl/workbook.xml", workbook.xml, { date: workbook.file.date });

  return zip.generateAsync({ type: "uint8array", compression: "DEFLATE", compressionOptions: { level: DEFLATE_LEVEL } });
}
