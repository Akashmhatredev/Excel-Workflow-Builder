import JSZip from "jszip";
import * as XLSX from "xlsx";
import { describe, expect, it } from "vitest";
import { highlightCells, resolveConditionalFormats } from "@/lib/conditional";
import { buildOutputFile, buildTable, readWorkbook, writeStyledXlsx, writeXlsx, writeXlsxBook } from "@/lib/excel";
import { runPipeline } from "@/lib/pipeline";
import { createConditionalFormat, createDefinition, createField, createOutput, createTransform } from "@/lib/schema";
import { validateDefinition } from "@/lib/validate";
import { cellIsRule, columnLetter, conditionalFormattingXml } from "@/lib/xlsxStyle";

const day = (y, m, d, h = 0) => new Date(Date.UTC(y, m - 1, d, h));
const rule = (columnKey, operator, value = "", extra = {}) => createConditionalFormat({ columnKey, operator, value, ...extra });

const WORKSHEET_ORDER = [
  "sheetPr", "dimension", "sheetViews", "sheetFormatPr", "cols", "sheetData", "sheetCalcPr", "sheetProtection",
  "protectedRanges", "scenarios", "autoFilter", "sortState", "dataConsolidate", "customSheetViews", "mergeCells",
  "phoneticPr", "conditionalFormatting", "dataValidations", "hyperlinks", "printOptions", "pageMargins", "pageSetup",
  "headerFooter", "rowBreaks", "colBreaks", "customProperties", "cellWatches", "ignoredErrors", "smartTags", "drawing",
];
const STYLESHEET_ORDER = ["numFmts", "fonts", "fills", "borders", "cellStyleXfs", "cellXfs", "cellStyles", "dxfs", "tableStyles", "colors", "extLst"];
const WORKBOOK_ORDER = ["fileVersion", "workbookPr", "bookViews", "sheets", "definedNames", "calcPr"];

/** Tags balance and the root's children follow `order`. Returns the child names. */
function checkXml(xml, root, order) {
  const stack = [];
  const children = [];
  for (const match of xml.matchAll(/<(\/?)([A-Za-z_][\w:.-]*)[^>]*?(\/?)>/g)) {
    const [, closing, name, selfClosing] = match;
    if (closing) {
      expect(stack.pop()).toBe(name);
      continue;
    }
    if (stack.length === 1 && stack[0] === root) children.push(name);
    if (!selfClosing) stack.push(name);
  }
  expect(stack).toEqual([]);
  const positions = children.map((name) => order.indexOf(name));
  expect(positions.every((position) => position >= 0)).toBe(true);
  for (let i = 1; i < positions.length; i += 1) expect(positions[i]).toBeGreaterThanOrEqual(positions[i - 1]);
  return children;
}

async function unzip(bytes) {
  const zip = await JSZip.loadAsync(bytes);
  const read = (name) => zip.file(name).async("string");
  return { sheet: await read("xl/worksheets/sheet1.xml"), styles: await read("xl/styles.xml"), workbook: await read("xl/workbook.xml"), zip };
}

const money = { type: "numberFormat", decimals: 2, thousands: true, prefix: "", suffix: "" };
const RESULT = {
  columns: [
    { key: "item", name: "Item", type: "text", format: null },
    { key: "amount", name: "Amount", type: "number", format: money },
    { key: "when", name: "When", type: "date", format: { type: "dateFormat", pattern: "DD/MM/YYYY" } },
  ],
  rows: [
    ["Pen *", 150, day(2024, 1, 5, 14)],
    ["Ink", 20, day(2024, 2, 1)],
    [null, null, null],
    ["Pad", 75.5, day(2023, 12, 31)],
  ],
};

describe("cellIsRule", () => {
  it("maps comparisons to cellIs operators with typed operands", () => {
    expect(cellIsRule("gt", "1,200")).toEqual({ operator: "greaterThan", formulas: ["1200"] });
    expect(cellIsRule("lte", " -5 ")).toEqual({ operator: "lessThanOrEqual", formulas: ["-5"] });
    expect(cellIsRule("equals", 'Say "hi"')).toEqual({ operator: "equal", formulas: ['"Say ""hi"""'] });
    expect(cellIsRule("notEquals", "north")).toEqual({ operator: "notEqual", formulas: ['"north"'] });
    expect(cellIsRule("between", "100", "10")).toEqual({ operator: "between", formulas: ["10", "100"] });
  });

  it("compares whole days for dates without a time", () => {
    const end = "45296.9999884259";
    expect(cellIsRule("equals", "05/01/2024")).toEqual({ operator: "between", formulas: ["45296", end] });
    expect(cellIsRule("notEquals", "2024-01-05")).toEqual({ operator: "notBetween", formulas: ["45296", end] });
    expect(cellIsRule("gt", "2024-01-05")).toEqual({ operator: "greaterThanOrEqual", formulas: ["45297"] });
    expect(cellIsRule("gte", "2024-01-05")).toEqual({ operator: "greaterThanOrEqual", formulas: ["45296"] });
    expect(cellIsRule("lt", "2024-01-05")).toEqual({ operator: "lessThan", formulas: ["45296"] });
    expect(cellIsRule("lte", "2024-01-05")).toEqual({ operator: "lessThan", formulas: ["45297"] });
    expect(cellIsRule("between", "2024-01-31", "2024-01-01")).toEqual({ operator: "between", formulas: ["45292", "45322.9999884259"] });
    expect(cellIsRule("gt", "2024-01-05 12:00")).toEqual({ operator: "greaterThan", formulas: ["45296.5"] });
  });

  it("names columns like Excel", () => {
    expect([0, 25, 26, 701, 702].map(columnLetter)).toEqual(["A", "Z", "AA", "ZZ", "AAA"]);
  });
});

describe("conditional format rules", () => {
  it("puts a blank rule first so blanks behave like the preview", () => {
    const entries = resolveConditionalFormats(
      [rule("amount", "lt", "50"), rule("amount", "notEquals", "0", { style: "grey" }), rule("amount", "isEmpty", "", { style: "blue" })],
      RESULT.columns,
    );
    const xml = conditionalFormattingXml(entries, 4, (key) => ({ "red|0": 0, "grey|0": 1, "blue|0": 2 })[key]);
    expect(xml).toBe(
      '<conditionalFormatting sqref="B2:B5">' +
        '<cfRule type="containsBlanks" dxfId="1" priority="1" stopIfTrue="1"><formula>LEN(TRIM(B2))=0</formula></cfRule>' +
        '<cfRule type="cellIs" dxfId="0" priority="2" stopIfTrue="1" operator="lessThan"><formula>50</formula></cfRule>' +
        '<cfRule type="cellIs" dxfId="1" priority="3" stopIfTrue="1" operator="notEqual"><formula>0</formula></cfRule>' +
        "</conditionalFormatting>",
    );
    const guard = conditionalFormattingXml(resolveConditionalFormats([rule("item", "gte", "a")], RESULT.columns), 2, () => 0);
    expect(guard).toContain('<cfRule type="containsBlanks" priority="1" stopIfTrue="1">');
    const text = conditionalFormattingXml(resolveConditionalFormats([rule("item", "contains", 'a*"?~'), rule("item", "notEmpty")], RESULT.columns), 2, () => 4);
    expect(text).toBe(
      '<conditionalFormatting sqref="A2:A3">' +
        '<cfRule type="containsText" dxfId="4" priority="1" stopIfTrue="1" operator="containsText" text="a*&quot;?~">' +
        "<formula>NOT(ISERROR(SEARCH(&quot;a~*&quot;&quot;~?~~&quot;,A2)))</formula></cfRule>" +
        '<cfRule type="notContainsBlanks" dxfId="4" priority="2" stopIfTrue="1"><formula>LEN(TRIM(A2))&gt;0</formula></cfRule>' +
        "</conditionalFormatting>",
    );
    expect(conditionalFormattingXml(entries, 0, () => 0)).toBe("");
  });

  it("ignores incomplete rules and columns that are not in the result", () => {
    const entries = resolveConditionalFormats(
      [rule("gone", "gt", "1"), rule("amount", "gt", ""), rule("amount", "between", "1"), rule("", "isEmpty"), { columnKey: "amount", operator: "startsWith", value: "1" }],
      RESULT.columns,
    );
    expect(entries).toEqual([]);
  });

  it("highlights the first matching rule per cell, like Excel with stop-if-true", () => {
    const rules = [
      rule("amount", "gt", "100", { style: "green", bold: true }),
      rule("amount", "gt", "50", { style: "amber" }),
      rule("amount", "isEmpty", "", { style: "grey" }),
      rule("when", "equals", "2024-01-05", { style: "blue" }),
      rule("item", "contains", "*"),
    ];
    expect(highlightCells(RESULT, rules, 10)).toEqual([
      [0, 0, "red", false],
      [0, 1, "green", true],
      [0, 2, "blue", false], // 14:00 on that day still equals the whole day
      [2, 1, "grey", false],
      [3, 1, "amber", false],
    ]);
    expect(highlightCells(RESULT, rules, 1)).toHaveLength(3);
    expect(highlightCells(RESULT, [], 10)).toEqual([]);
  });
});

describe("styled xlsx", () => {
  const rules = [
    rule("amount", "gt", "100", { style: "green", bold: true }),
    rule("amount", "isEmpty", "", { style: "grey" }),
    rule("when", "lt", "2024-01-01", { style: "amber" }),
  ];

  it("adds a bold header, a frozen row, an auto filter and conditional formatting in schema order", async () => {
    const bytes = await writeStyledXlsx(RESULT, {
      sheetName: "It's Q1",
      sheetStyle: { boldHeader: true, freezeHeader: true, autoFilter: true },
      conditionalFormats: rules,
    });
    const { sheet, styles, workbook } = await unzip(bytes);

    expect(checkXml(sheet, "worksheet", WORKSHEET_ORDER)).toEqual([
      "dimension",
      "sheetViews",
      "cols",
      "sheetData",
      "autoFilter",
      "conditionalFormatting",
      "conditionalFormatting",
      "ignoredErrors",
    ]);
    expect(checkXml(styles, "styleSheet", STYLESHEET_ORDER)).toContain("dxfs");
    checkXml(workbook, "workbook", WORKBOOK_ORDER);

    expect(sheet).toContain(
      '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>' +
        '<selection pane="bottomLeft" activeCell="A2" sqref="A2"/></sheetView></sheetViews>',
    );
    const headerXf = Number(/<c r="A1"[^>]*\bs="(\d+)"/.exec(sheet)[1]);
    expect(/<c r="B1"[^>]*\bs="(\d+)"/.exec(sheet)[1]).toBe(String(headerXf));
    expect(sheet).not.toMatch(/<c r="A2"[^>]*\bs="/);
    const xfs = [.../<cellXfs[^>]*>([\s\S]*?)<\/cellXfs>/.exec(styles)[1].matchAll(/<xf [^>]*>/g)].map((m) => m[0]);
    expect(xfs[headerXf]).toMatch(/fontId="1"/);
    expect(styles).toMatch(/<fonts count="2"><font>[\s\S]*?<\/font><font><b\/><sz val="12"\/>/);
    expect(styles).toContain('<cellXfs count="' + xfs.length + '">');
    expect(sheet).toContain('<autoFilter ref="A1:C5"/>');
    expect(workbook).toContain(
      '<definedNames><definedName name="_xlnm._FilterDatabase" localSheetId="0" hidden="1">&apos;It&apos;&apos;s Q1&apos;!$A$1:$C$5</definedName></definedNames>',
    );
    expect(styles).toMatch(/<dxfs count="3">/);
    expect(styles).toContain('<dxf><font><b/><color rgb="FF05603A"/></font><fill><patternFill patternType="solid"><fgColor rgb="FFD1FADF"/>');
    expect(sheet).toContain(
      '<conditionalFormatting sqref="B2:B5"><cfRule type="containsBlanks" dxfId="1" priority="1" stopIfTrue="1"><formula>LEN(TRIM(B2))=0</formula></cfRule>' +
        '<cfRule type="cellIs" dxfId="0" priority="2" stopIfTrue="1" operator="greaterThan"><formula>100</formula></cfRule></conditionalFormatting>',
    );
    expect(sheet).toContain('<conditionalFormatting sqref="C2:C5"><cfRule type="containsBlanks" priority="3" stopIfTrue="1">');
    expect(sheet).toContain('operator="lessThan"><formula>45292</formula>');
  });

  it("keeps values, number formats and the filter readable by SheetJS and the engine", async () => {
    const bytes = await writeStyledXlsx(RESULT, { sheetName: "Data", sheetStyle: { boldHeader: true, freezeHeader: true, autoFilter: true }, conditionalFormats: rules });
    const book = XLSX.read(bytes, { type: "array", cellNF: true, cellDates: false });
    const sheet = book.Sheets.Data;
    expect(sheet["!autofilter"]).toEqual({ ref: "A1:C5" });
    expect(sheet.A1.v).toBe("Item");
    expect(sheet.B2).toMatchObject({ t: "n", v: 150, z: "#,##0.00" });
    expect(sheet.C3).toMatchObject({ t: "n", v: 45323, z: "dd/mm/yyyy" });
    const table = buildTable(readWorkbook(bytes, "out.xlsx"));
    expect(table.columns.map((c) => [c.name, c.type])).toEqual([
      ["Item", "text"],
      ["Amount", "number"],
      ["When", "date"],
    ]);
    expect(table.rows).toEqual([
      ["Pen *", 150, day(2024, 1, 5, 14)],
      ["Ink", 20, day(2024, 2, 1)],
      ["Pad", 75.5, day(2023, 12, 31)],
    ]);
  });

  it("returns the plain file when there is nothing to style, and skips rules without data rows", async () => {
    const plain = writeXlsx(RESULT, { sheetName: "Data" });
    const off = { boldHeader: false, freezeHeader: false, autoFilter: false };
    expect((await writeStyledXlsx(RESULT, { sheetName: "Data", sheetStyle: off })).length).toBe(plain.length);
    const empty = await writeStyledXlsx({ columns: RESULT.columns, rows: [] }, { sheetStyle: { autoFilter: true }, conditionalFormats: rules });
    const { sheet, styles } = await unzip(empty);
    expect(sheet).toContain('<autoFilter ref="A1:C1"/>');
    expect(sheet).not.toContain("conditionalFormatting");
    expect(styles).toContain('<dxfs count="0"/>');
    expect(sheet).not.toContain("<pane");
  });

  it("styles every sheet of a workbook", async () => {
    const { styleXlsx } = await import("@/lib/xlsxStyle");
    const book = writeXlsxBook([
      { result: RESULT, sheetName: "One" },
      { result: RESULT, sheetName: "Two" },
    ]);
    const bytes = await styleXlsx(book, [
      { columns: RESULT.columns, rowCount: 4, sheetStyle: { autoFilter: true }, conditionalFormats: [rules[0]] },
      { columns: RESULT.columns, rowCount: 4, sheetStyle: { boldHeader: true, autoFilter: true }, conditionalFormats: [rules[2]] },
    ]);
    const zip = await JSZip.loadAsync(bytes);
    const one = await zip.file("xl/worksheets/sheet1.xml").async("string");
    const two = await zip.file("xl/worksheets/sheet2.xml").async("string");
    const workbook = await zip.file("xl/workbook.xml").async("string");
    expect(one).not.toMatch(/<c r="A1"[^>]*\bs="/);
    expect(two).toMatch(/<c r="A1"[^>]*\bs="/);
    expect(one).toContain('dxfId="0"');
    expect(two).toContain('dxfId="1"');
    expect(workbook.match(/_xlnm\._FilterDatabase/g)).toHaveLength(2);
    expect(workbook).toContain('localSheetId="1" hidden="1">&apos;Two&apos;!$A$1:$C$5<');
    checkXml(workbook, "workbook", WORKBOOK_ORDER);
  });

  it("is what buildOutputFile writes for xlsx outputs, with the default sheet style", async () => {
    const table = {
      columns: [
        { name: "Item", type: "text", index: 0 },
        { name: "Qty", type: "number", index: 1 },
      ],
      rows: [
        ["Pen", 2],
        ["Ink", 12],
      ],
    };
    const item = createField({ name: "Item", source: { kind: "column", column: "Item" } });
    const qty = createField({ name: "Qty", source: { kind: "column", column: "Qty" }, transforms: [createTransform("numberFormat", { decimals: 0 })] });
    const xlsx = createOutput({ name: "Stock", conditionalFormats: [rule(qty.id, "lt", "5")] });
    const csv = createOutput({ name: "Stock csv", fileType: "csv", conditionalFormats: [rule(qty.id, "lt", "5")] });
    const legacy = { id: "out_old", name: "Old", fileType: "xlsx", sheetName: "Sheet1", fieldIds: null };
    const definition = createDefinition({ fields: [item, qty], outputs: [xlsx, csv, legacy] });

    const file = await buildOutputFile(table, definition, xlsx.id);
    const { sheet } = await unzip(file.bytes);
    expect(sheet).toContain('state="frozen"');
    expect(sheet).toMatch(/<c r="A1"[^>]*\bs="/);
    expect(sheet).not.toContain("<autoFilter");
    expect(sheet).toContain('<conditionalFormatting sqref="B2:B3">');
    const old = await unzip((await buildOutputFile(table, definition, legacy.id)).bytes);
    expect(old.sheet).toContain('state="frozen"');
    const text = await buildOutputFile(table, definition, csv.id);
    expect(new TextDecoder().decode(text.bytes)).toBe("Item,Qty\r\nPen,2\r\nInk,12\r\n"); // the decoder drops the BOM

    const preview = runPipeline(table, definition, { outputId: csv.id });
    expect(highlightCells(preview, csv.conditionalFormats, 10)).toEqual([[0, 1, "red", false]]);
  });

  it("warns about rules on columns the output does not have", () => {
    const item = createField({ name: "Item", source: { kind: "column", column: "Item" } });
    const lost = rule("fld_gone", "gt", "1");
    const unset = rule("", "gt", "1");
    const output = createOutput({ name: "Out", conditionalFormats: [lost, unset, rule(item.id, "isEmpty")] });
    const issues = validateDefinition(createDefinition({ fields: [item], outputs: [output] }), [{ name: "Item", type: "text" }]);
    expect(issues).toEqual([
      {
        level: "warning",
        scope: "output",
        id: lost.id,
        outputId: output.id,
        code: "missing-field",
        message: "This highlight rule uses a column that is not in this output, so it is ignored.",
      },
    ]);
  });
});

describe("worker previews with highlights", () => {
  it("returns the output's highlights, also for CSV outputs", async () => {
    const { handlers, resetDatasets } = await import("@/workers/parse.worker");
    resetDatasets();
    const csvText = new TextEncoder().encode("Item,Qty\nPen,2\nInk,12\nPad,\n");
    const file = { name: "stock.csv", size: csvText.length, lastModified: 0, arrayBuffer: async () => csvText.slice().buffer };
    const ctx = { progress: () => {} };
    await handlers.parseFile({ file, datasetId: "main" }, ctx);
    await handlers.loadTable({ datasetId: "main", sheetNames: [], headerRow: 1 }, ctx);
    const item = createField({ name: "Item", source: { kind: "column", column: "Item" } });
    const qty = createField({ name: "Qty", source: { kind: "column", column: "Qty" } });
    const output = createOutput({ name: "Stock", fileType: "csv", conditionalFormats: [rule(qty.id, "lt", "5", { bold: true }), rule(qty.id, "isEmpty", "", { style: "grey" })] });
    const definition = createDefinition({ fields: [item, qty], outputs: [output] });
    const preview = await handlers.runPreview({ datasetId: "main", definition, outputId: output.id, limit: 10 }, ctx);
    expect(preview.highlights).toEqual([
      [0, 1, "red", true],
      [2, 1, "grey", false],
    ]);
    expect(preview.cellIssues).toEqual([[2, 1, "blank"]]);
    const workflow = await handlers.runPreview({ datasetId: "main", definition, outputId: null, limit: 10 }, ctx);
    expect(workflow.highlights).toEqual([]);
  });
});
