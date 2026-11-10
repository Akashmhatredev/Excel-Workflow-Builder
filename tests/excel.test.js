import JSZip from "jszip";
import * as XLSX from "xlsx";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildOutputFile,
  buildTable,
  isNumericText,
  listSheets,
  parseDelimited,
  readWorkbook,
  uniqueFileNames,
  writeCsv,
  writeXlsx,
  writeXlsxBook,
  zipFileName,
  zipFiles,
} from "@/lib/excel";
import { createDefinition, createField, createOutput, createTransform } from "@/lib/schema";
import { toText } from "@/lib/transforms";

const day = (y, m, d, h = 0, min = 0) => new Date(Date.UTC(y, m - 1, d, h, min));
const encode = (text) => new TextEncoder().encode(text);
const texts = (rows) => rows.map((row) => row.map(toText));

/** Build an .xlsx in memory with SheetJS (cells may be { t, v, z } objects). */
function xlsxFrom(sheets, bookType = "xlsx") {
  const book = XLSX.utils.book_new();
  for (const [name, aoa] of Object.entries(sheets)) XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(aoa), name);
  return new Uint8Array(XLSX.write(book, { type: "array", bookType }));
}

function codeOf(fn) {
  try {
    fn();
  } catch (error) {
    return error.code;
  }
  return null;
}

const tableOf = (bytes, name, options = {}) => buildTable(readWorkbook(bytes, name), options);

describe("readWorkbook: errors", () => {
  it("rejects unsupported file types", () => {
    expect(codeOf(() => readWorkbook(encode("x"), "report.pdf"))).toBe("UNSUPPORTED_FORMAT");
    expect(codeOf(() => readWorkbook(encode("x"), "noextension"))).toBe("UNSUPPORTED_FORMAT");
    expect(codeOf(() => readWorkbook(encode("x"), "data.ods"))).toBe("UNSUPPORTED_FORMAT");
  });

  it("rejects empty files", () => {
    expect(codeOf(() => readWorkbook(new Uint8Array(), "a.xlsx"))).toBe("EMPTY_FILE");
    expect(codeOf(() => readWorkbook(encode("\r\n\r\n  \n"), "a.csv"))).toBe("EMPTY_FILE");
    expect(codeOf(() => readWorkbook(xlsxFrom({ Blank: [] }), "a.xlsx"))).toBe("EMPTY_FILE");
  });

  it("rejects damaged workbooks and binary data posing as CSV", () => {
    expect(codeOf(() => readWorkbook(encode("name,qty\nA,1"), "a.xlsx"))).toBe("CORRUPT_FILE");
    expect(codeOf(() => readWorkbook(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 9, 9, 9, 9]), "a.xlsx"))).toBe("CORRUPT_FILE");
    expect(codeOf(() => readWorkbook(xlsxFrom({ S: [["a"], [1]] }).slice(0, 200), "a.xlsx"))).toBe("CORRUPT_FILE");
    expect(codeOf(() => readWorkbook(new Uint8Array([0, 1, 2, 3, 255, 0, 7]), "a.csv"))).toBe("CORRUPT_FILE");
    expect(codeOf(() => readWorkbook(new Uint8Array([0, 1, 2, 3, 255, 0, 7]), "a.xls"))).toBe("CORRUPT_FILE");
  });

  it("recognises password-protected workbooks", () => {
    const cfb = XLSX.CFB.utils.cfb_new();
    XLSX.CFB.utils.cfb_add(cfb, "/EncryptionInfo", new Uint8Array([4, 0, 4, 0, 0x40, 0, 0, 0]));
    XLSX.CFB.utils.cfb_add(cfb, "/EncryptedPackage", new Uint8Array(64));
    const bytes = new Uint8Array(XLSX.CFB.write(cfb, { type: "array" }));
    let error = null;
    try {
      readWorkbook(bytes, "secret.xlsx");
    } catch (caught) {
      error = caught;
    }
    expect(error.code).toBe("PASSWORD_PROTECTED");
    expect(error.message).toMatch(/password-protected/);
  });

  it("gives friendly messages that name the file", () => {
    try {
      readWorkbook(encode("x"), "Q3 report.pdf");
    } catch (error) {
      expect(error.message).toBe('"Q3 report.pdf" is not a supported file type. Upload an Excel workbook (.xlsx, .xls) or a CSV file.');
    }
  });
});

describe("readWorkbook: formats", () => {
  const aoa = [
    ["Name", "Qty"],
    ["Asha", 2],
  ];

  it("reads .xlsx, .xlsm, .xls and accepts any byte container", () => {
    const xlsx = xlsxFrom({ Orders: aoa });
    for (const data of [xlsx, xlsx.buffer, new Uint8Array([0, ...xlsx]).subarray(1)]) {
      expect(texts(tableOf(data, "a.xlsx").rows)).toEqual([["Asha", "2"]]);
    }
    expect(texts(tableOf(xlsx, "a.xlsm").rows)).toEqual([["Asha", "2"]]);
    expect(texts(tableOf(xlsxFrom({ Orders: aoa }, "biff8"), "a.xls").rows)).toEqual([["Asha", "2"]]);
    expect(texts(tableOf(xlsxFrom({ Orders: aoa }, "biff5"), "a.xls").rows)).toEqual([["Asha", "2"]]);
  });

  it("opens a real workbook even when its extension says CSV", () => {
    expect(texts(tableOf(xlsxFrom({ Orders: aoa }), "export.csv").rows)).toEqual([["Asha", "2"]]);
  });

  it("reads HTML and tab-separated text saved as .xls", () => {
    const html = "<table><tr><td>Name</td><td>Code</td></tr><tr><td>Asha</td><td>007</td></tr></table>";
    const fromHtml = tableOf(encode(html), "export.xls");
    expect(fromHtml.columns.map((c) => c.name)).toEqual(["Name", "Code"]);
    expect(texts(fromHtml.rows)).toEqual([["Asha", "007"]]);
    expect(texts(tableOf(encode("Name\tQty\nAsha\t2\n"), "export.xls").rows)).toEqual([["Asha", "2"]]);
  });

  it("lists sheets with the size of their used range", () => {
    const workbook = readWorkbook(xlsxFrom({ Orders: [["a", "b", "c"], [1, 2, 3], [4]], Empty: [], Notes: [["x"]] }), "a.xlsx");
    expect(listSheets(workbook)).toEqual([
      { name: "Orders", rowCount: 3, colCount: 3 },
      { name: "Empty", rowCount: 0, colCount: 0 },
      { name: "Notes", rowCount: 1, colCount: 1 },
    ]);
    expect(listSheets(null)).toEqual([]);
  });
});

describe("CSV", () => {
  it("parses RFC 4180 quoting", () => {
    expect(parseDelimited('a,"b,c","say ""hi""",\r\n"multi\nline",,x\rlast')).toEqual([
      ["a", "b,c", 'say "hi"', null],
      ["multi\nline", null, "x"],
      ["last"],
    ]);
    expect(parseDelimited("a;b\n1;2", ";")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
    expect(parseDelimited('"unterminated')).toEqual([["unterminated"]]);
    expect(parseDelimited("")).toEqual([]);
  });

  it("strips the BOM, sniffs the delimiter and honours a sep= line", () => {
    expect(tableOf(encode("﻿Name,Qty\nAsha,2"), "a.csv").columns[0].name).toBe("Name");
    expect(texts(tableOf(encode("Name;Amount\nAsha;1,5\nRavi;2"), "a.csv").rows)).toEqual([
      ["Asha", "1,5"],
      ["Ravi", "2"],
    ]);
    expect(tableOf(encode("Name\tCity, State\nAsha\tPune, MH"), "a.tsv").columns.map((c) => c.name)).toEqual(["Name", "City, State"]);
    expect(tableOf(encode("sep=|\nA|B\n1|2"), "a.csv").columns.map((c) => c.name)).toEqual(["A", "B"]);
  });

  it("decodes UTF-8 and falls back to windows-1252", () => {
    expect(tableOf(encode("Name\nÜnïcode ✓\n"), "a.csv").rows[0][0]).toBe("Ünïcode ✓");
    const latin = new Uint8Array([0x4e, 0x61, 0x6d, 0x65, 0x0a, 0x43, 0x61, 0x66, 0xe9, 0x20, 0x80, 0x35, 0x0a]);
    expect(tableOf(latin, "a.csv").rows[0][0]).toBe("Café €5");
  });

  it("infers column types without guessing US dates", () => {
    const csv = [
      "Date,Code,Amount,Qty,Mixed,Phone,When",
      '05/01/2024,00123,"1,200.50",3,12,+919876543210,2024-01-05 10:30',
      '13/01/2024,00124,"12,34,567",-4,abc,+919876543211,2024-01-06 11:00',
      ",,,,,,",
      "01/02/2024,,5,0.5,7,,",
    ].join("\n");
    const table = tableOf(encode(csv), "orders.csv");
    expect(table.columns.map((c) => [c.name, c.type])).toEqual([
      ["Date", "date"],
      ["Code", "text"],
      ["Amount", "number"],
      ["Qty", "number"],
      ["Mixed", "text"],
      ["Phone", "text"],
      ["When", "date"],
    ]);
    expect(table.rows).toHaveLength(3);
    expect(texts(table.rows)).toEqual([
      ["2024-01-05", "00123", "1200.5", "3", "12", "+919876543210", "2024-01-05 10:30"],
      ["2024-01-13", "00124", "1234567", "-4", "abc", "+919876543211", "2024-01-06 11:00"],
      ["2024-02-01", "", "5", "0.5", "7", "", ""],
    ]);
    expect(table.rows[0][2]).toBe(1200.5);
    expect(table.rows[0][0]).toEqual(day(2024, 1, 5));
  });

  it("knows which text is unambiguously a number", () => {
    for (const text of ["12", "-3.5", "1,200", "1,234,567.89", "12,34,567"]) expect(isNumericText(text)).toBe(true);
    for (const text of ["00123", "1,2", "1,23", "1,2345", "01,234", "+12", "12%", "₹5"]) expect(isNumericText(text)).toBe(false);
  });
});

describe("buildTable", () => {
  it("uses the chosen header row and skips the rows above it", () => {
    const bytes = xlsxFrom({ S: [["Sales report"], [], ["Name", "Qty"], ["Asha", 2]] });
    const table = tableOf(bytes, "a.xlsx", { headerRow: 3 });
    expect(table.columns).toEqual([
      { name: "Name", type: "text", index: 0 },
      { name: "Qty", type: "number", index: 1 },
    ]);
    expect(table.headerRow).toBe(3);
    expect(table.rows).toEqual([["Asha", 2]]);
  });

  it("names blank headers after the sheet column and renames duplicates", () => {
    const bytes = xlsxFrom({
      S: [
        ["ID", null, "Name", "name ", "Name", null, null],
        [1, "x", "a", "b", "c", null, null],
        [2, null, "d", "e", "f", null, "late"],
      ],
    });
    const table = tableOf(bytes, "a.xlsx");
    expect(table.columns.map((c) => c.name)).toEqual(["ID", "Column B", "Name", "name (2)", "Name (3)", "Column G"]);
    expect(table.rows[1]).toEqual([2, null, "d", "e", "f", "late"]);
    expect(table.warnings).toEqual([
      "2 duplicate column names were renamed.",
      "2 columns had no header and were named after the sheet column.",
    ]);
  });

  it("drops fully empty rows and trims header text", () => {
    const bytes = xlsxFrom({ S: [["  Order   ID "], ["A"], [null], ["   "], ["B"]] });
    const table = tableOf(bytes, "a.xlsx");
    expect(table.columns[0].name).toBe("Order ID");
    expect(table.rows).toEqual([["A"], ["B"]]);
    expect(table.warnings).toEqual([]);
  });

  it("stacks several sheets by header name and adds a Source Sheet column", () => {
    const bytes = xlsxFrom({
      2023: [
        ["Region", "Sales"],
        ["North", 10],
      ],
      2024: [
        ["sales", "REGION", "Rep"],
        [20, "South", "Asha"],
      ],
      Notes: [["just notes"]],
    });
    const table = tableOf(bytes, "a.xlsx", { sheetNames: ["2023", "2024"] });
    expect(table.columns).toEqual([
      { name: "Region", type: "text", index: 0 },
      { name: "Sales", type: "number", index: 1 },
      { name: "Rep", type: "text", index: 2 },
      { name: "Source Sheet", type: "text", index: 3 },
    ]);
    expect(table.rows).toEqual([
      ["North", 10, null, "2023"],
      ["South", 20, "Asha", "2024"],
    ]);
    expect(table.sheetNames).toEqual(["2023", "2024"]);
    expect(table.warnings).toEqual(["The selected sheets do not have the same columns. Values a sheet does not have were left empty."]);
  });

  it("skips sheets that fail when stacking, and fails when every sheet fails", () => {
    const bytes = xlsxFrom({ A: [["X"], [1]], B: [["X"]] });
    const table = tableOf(bytes, "a.xlsx", { sheetNames: ["A", "B"] });
    expect(table.sheetNames).toEqual(["A"]);
    expect(table.warnings[0]).toBe('"B" was skipped: No data rows were found below row 1 of "B".');
    expect(codeOf(() => tableOf(bytes, "a.xlsx", { sheetNames: ["B"] }))).toBe("EMPTY_SHEET");
  });

  it("picks the first sheet with data by default and matches sheet names loosely", () => {
    const bytes = xlsxFrom({ Cover: [], Data: [["A"], [1]] });
    expect(tableOf(bytes, "a.xlsx").sheetNames).toEqual(["Data"]);
    expect(tableOf(bytes, "a.xlsx", { sheetNames: [" data"] }).sheetNames).toEqual(["Data"]);
    expect(codeOf(() => tableOf(bytes, "a.xlsx", { sheetNames: ["Missing"] }))).toBe("EMPTY_SHEET");
  });

  it("explains empty sheets and missing headers", () => {
    const bytes = xlsxFrom({ S: [["Name"]], T: [["A"], [1]] });
    expect(codeOf(() => tableOf(bytes, "a.xlsx", { sheetNames: ["S"] }))).toBe("EMPTY_SHEET");
    try {
      tableOf(bytes, "a.xlsx", { sheetNames: ["T"], headerRow: 5 });
    } catch (error) {
      expect(error.code).toBe("EMPTY_SHEET");
      expect(error.message).toBe('Row 5 of "T" has no column names. Choose the row that holds the headers.');
    }
  });

  it("reads Excel error cells as empty and says so", () => {
    const sheet = XLSX.utils.aoa_to_sheet([["A", "B"], [1, 2]]);
    sheet.B2 = { t: "e", v: 0x2a };
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, sheet, "S");
    const table = tableOf(new Uint8Array(XLSX.write(book, { type: "array", bookType: "xlsx" })), "a.xlsx");
    expect(table.rows).toEqual([[1, null]]);
    expect(table.warnings).toEqual(["1 cell with an Excel error (such as #N/A) was read as empty."]);
  });

  it("reads booleans as text and times of day as HH:mm", () => {
    const sheet = XLSX.utils.aoa_to_sheet([["Flag", "Time"], [true, 0.5]]);
    sheet.B2.z = "hh:mm";
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, sheet, "S");
    const table = tableOf(new Uint8Array(XLSX.write(book, { type: "array", bookType: "xlsx" })), "a.xlsx");
    expect(table.rows).toEqual([["TRUE", "12:00"]]);
  });
});

describe("dates do not depend on the time zone", () => {
  const original = process.env.TZ;
  afterEach(() => {
    process.env.TZ = original;
  });

  it.each([
    ["Asia/Kolkata", -330],
    ["America/New_York", 300],
    ["Pacific/Auckland", -780],
    ["UTC", 0],
  ])("reads and writes the same calendar day in %s", (zone, offset) => {
    process.env.TZ = zone;
    expect(new Date(2024, 0, 5).getTimezoneOffset()).toBe(offset);

    // What Excel stores for 2024-01-05 and 2024-03-31 18:45 (SheetJS models it from local Dates).
    const sheet = XLSX.utils.aoa_to_sheet([["When"], [new Date(2024, 0, 5)], [new Date(2024, 2, 31, 18, 45)]]);
    expect(sheet.A2.v).toBe(45296);
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, sheet, "S");
    const table = tableOf(new Uint8Array(XLSX.write(book, { type: "array", bookType: "xlsx" })), "a.xlsx");
    expect(table.columns[0].type).toBe("date");
    expect(texts(table.rows)).toEqual([["2024-01-05"], ["2024-03-31 18:45"]]);

    const bytes = writeXlsx({ columns: [{ name: "When", format: null }], rows: table.rows });
    const written = XLSX.read(bytes, { type: "array", cellDates: false, cellNF: true });
    expect(written.Sheets.Sheet1.A2).toMatchObject({ t: "n", v: 45296, z: "yyyy-mm-dd" });
    expect(written.Sheets.Sheet1.A3.v).toBeCloseTo(45382.78125, 8);
    expect(texts(tableOf(bytes, "b.xlsx").rows)).toEqual([["2024-01-05"], ["2024-03-31 18:45"]]);

    const csv = tableOf(encode("When\n05/01/2024\n31/03/2024 18:45\n"), "c.csv");
    expect(texts(csv.rows)).toEqual([["2024-01-05"], ["2024-03-31 18:45"]]);
  });

  it("reads workbooks that use the 1904 date system", () => {
    const sheet = XLSX.utils.aoa_to_sheet([["When"], [{ t: "n", v: 43834, z: "yyyy-mm-dd" }]]);
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, sheet, "S");
    book.Workbook = { WBProps: { date1904: true } };
    const table = tableOf(new Uint8Array(XLSX.write(book, { type: "array", bookType: "xlsx" })), "a.xlsx");
    expect(texts(table.rows)).toEqual([["2024-01-05"]]);
  });
});

describe("writeXlsx", () => {
  const money = { type: "numberFormat", decimals: 2, thousands: true, prefix: "₹", suffix: "" };
  const result = {
    columns: [
      { key: "d", name: "Day", type: "date", format: { type: "dateFormat", pattern: "DD MMM YYYY" } },
      { key: "a", name: "Amount", type: "number", format: money },
      { key: "q", name: "Qty", type: "number", format: null },
      { key: "n", name: "Note", type: "text", format: null },
      { key: "f", name: "Flag", type: "text", format: null },
    ],
    rows: [
      [day(2024, 1, 5), 1234.5, 3, "00123", true],
      [null, null, 0.1 + 0.2, "", false],
    ],
  };

  it("writes real numbers and dates with number formats", () => {
    const workbook = XLSX.read(writeXlsx(result, { sheetName: "Q1/Q2: [draft]" }), {
      type: "array",
      cellNF: true,
      cellDates: false,
      cellStyles: true,
    });
    expect(workbook.SheetNames).toEqual(["Q1 Q2 draft"]);
    const sheet = workbook.Sheets["Q1 Q2 draft"];
    expect(["A1", "B1", "C1", "D1", "E1"].map((ref) => sheet[ref].v)).toEqual(["Day", "Amount", "Qty", "Note", "Flag"]);
    expect(sheet.A2).toMatchObject({ t: "n", v: 45296, z: "dd mmm yyyy" });
    expect(sheet.B2).toMatchObject({ t: "n", v: 1234.5, z: '"₹"#,##0.00' });
    expect(sheet.C2).toMatchObject({ t: "n", v: 3 });
    expect(sheet.D2).toMatchObject({ t: "s", v: "00123" });
    expect(sheet.E2).toMatchObject({ t: "b", v: true });
    expect(sheet.A3).toBeUndefined();
    expect(sheet.C3.v).toBeCloseTo(0.3, 15);
    expect(sheet["!ref"]).toBe("A1:E3");
    expect(sheet["!cols"].map((col) => col.wch)).toEqual([13, 11, 8, 8, 8]);
  });

  it("round-trips through readWorkbook", () => {
    const table = tableOf(writeXlsx(result), "out.xlsx");
    expect(table.columns.map((c) => [c.name, c.type])).toEqual([
      ["Day", "date"],
      ["Amount", "number"],
      ["Qty", "number"],
      ["Note", "text"],
      ["Flag", "text"],
    ]);
    expect(table.rows[0]).toEqual([day(2024, 1, 5), 1234.5, 3, "00123", "TRUE"]);
  });

  it("writes several sheets with unique names", () => {
    const one = { columns: [{ name: "A" }], rows: [[1]] };
    const book = XLSX.read(writeXlsxBook([{ result: one, sheetName: "Data" }, { result: one, sheetName: "data" }, { result: one }]), { type: "array" });
    expect(book.SheetNames).toEqual(["Data", "data (2)", "Sheet1"]);
  });

  it("refuses more rows than a sheet can hold", () => {
    expect(codeOf(() => writeXlsx({ columns: [{ name: "A" }], rows: new Array(1048576) }))).toBe("INVALID_DEFINITION");
  });
});

describe("writeCsv", () => {
  it("writes UTF-8 with a BOM, CRLF line ends, RFC 4180 quoting and formatted values", () => {
    const bytes = writeCsv({
      columns: [
        { name: "Name, full", format: null },
        { name: "Amount", format: { type: "numberFormat", decimals: 2, thousands: true, prefix: "", suffix: "" } },
        { name: "Day", format: { type: "dateFormat", pattern: "DD/MM/YYYY" } },
        { name: "Note", format: null },
      ],
      rows: [
        ['Rao, "Asha"', 1234.5, day(2024, 1, 5), "line 1\nline 2"],
        [" padded", null, null, 0.1 + 0.2],
      ],
    });
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    expect(new TextDecoder().decode(bytes.slice(3))).toBe(
      '"Name, full",Amount,Day,Note\r\n"Rao, ""Asha""","1,234.50",05/01/2024,"line 1\nline 2"\r\n" padded",,,0.3\r\n',
    );
  });

  it("round-trips through readWorkbook", () => {
    const bytes = writeCsv({ columns: [{ name: "Code" }, { name: "When" }], rows: [["007", day(2024, 1, 5)]] });
    const table = tableOf(bytes, "out.csv");
    expect(table.columns.map((c) => c.type)).toEqual(["text", "date"]);
    expect(texts(table.rows)).toEqual([["007", "2024-01-05"]]);
  });
});

describe("output files and zips", () => {
  const table = {
    columns: [
      { name: "Name", type: "text", index: 0 },
      { name: "Qty", type: "number", index: 1 },
    ],
    rows: [
      ["Asha", 2],
      ["Ravi", 5],
    ],
  };
  const name = createField({ name: "Name", source: { kind: "column", column: "Name" }, transforms: [createTransform("upper")] });
  const qty = createField({ name: "Qty", source: { kind: "column", column: "Qty" } });

  it("builds csv and xlsx outputs", () => {
    const csv = createOutput({ name: "Daily: list", fileType: "csv" });
    const xlsx = createOutput({ name: "Daily", fileType: "xlsx", sheetName: "Data" });
    const definition = createDefinition({ fields: [name, qty], outputs: [csv, xlsx] });
    const csvFile = buildOutputFile(table, definition, csv.id);
    expect(csvFile).toMatchObject({ fileName: "Daily list.csv", mime: "text/csv;charset=utf-8", rowCount: 2 });
    expect(new TextDecoder("utf-8", { ignoreBOM: true }).decode(csvFile.bytes)).toBe("﻿Name,Qty\r\nASHA,2\r\nRAVI,5\r\n");
    const xlsxFile = buildOutputFile(table, definition, xlsx.id);
    expect(xlsxFile.fileName).toBe("Daily.xlsx");
    expect(xlsxFile.mime).toBe("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    expect(XLSX.read(xlsxFile.bytes, { type: "array" }).SheetNames).toEqual(["Data"]);
  });

  it("refuses missing outputs and outputs without columns", () => {
    const empty = createOutput({ name: "Empty", fieldIds: [] });
    const definition = createDefinition({ fields: [name], outputs: [empty] });
    expect(codeOf(() => buildOutputFile(table, definition, "out_nope"))).toBe("INVALID_DEFINITION");
    expect(codeOf(() => buildOutputFile(table, definition, empty.id))).toBe("INVALID_DEFINITION");
  });

  it("de-duplicates file names ignoring case", () => {
    expect(uniqueFileNames(["a.xlsx", "A.xlsx", "b.csv", "a.xlsx", "noext"])).toEqual(["a.xlsx", "A (2).xlsx", "b.csv", "a (3).xlsx", "noext"]);
    expect(zipFileName("Monthly: export")).toBe("Monthly export.zip");
    expect(zipFileName("bundle.zip")).toBe("bundle.zip");
    expect(zipFileName("")).toBe("outputs.zip");
  });

  it("zips files under unique names", async () => {
    const { bytes, fileNames } = await zipFiles([
      { fileName: "Report.csv", bytes: encode("a,b") },
      { fileName: "report.csv", bytes: encode("c,d") },
    ]);
    expect(fileNames).toEqual(["Report.csv", "report (2).csv"]);
    const zip = await JSZip.loadAsync(bytes);
    expect(Object.keys(zip.files)).toEqual(["Report.csv", "report (2).csv"]);
    expect(await zip.file("report (2).csv").async("string")).toBe("c,d");
  });
});

describe("worker handlers", () => {
  const fakeFile = (bytes, name) => ({
    name,
    size: bytes.length,
    lastModified: 0,
    arrayBuffer: async () => bytes.slice().buffer,
  });
  const progress = [];
  const ctx = { progress: (p) => progress.push(p) };

  const region = createField({ name: "Region", source: { kind: "column", column: "Region" }, transforms: [createTransform("title")] });
  const sales = createField({ name: "Sales", source: { kind: "column", column: "Sales" } });
  const detail = createOutput({ name: "Detail", fileType: "csv" });
  const summary = createOutput({ name: "Detail", fileType: "csv", fieldIds: [region.id] });
  const definition = createDefinition({ fields: [region, sales], outputs: [detail, summary] });
  const workbookBytes = xlsxFrom({
    Data: [
      ["Region", "Sales", "When"],
      ["north", 10, { t: "n", v: 45296, z: "dd/mm/yyyy" }],
      ["south", 20.5, null],
      [null, null, null],
      ["east", 0.1, null],
    ],
    Other: [["X"], ["y"]],
  });

  async function load() {
    const { handlers, resetDatasets } = await import("@/workers/parse.worker");
    resetDatasets();
    await handlers.parseFile({ file: fakeFile(workbookBytes, "sales.xlsx"), datasetId: "main" }, ctx);
    return handlers;
  }

  it("parses a file and loads a table with display-ready preview rows", async () => {
    const handlers = await load();
    const parsed = await handlers.parseFile({ file: fakeFile(workbookBytes, "sales.xlsx") }, ctx);
    expect(parsed).toEqual({
      datasetId: "main",
      fileName: "sales.xlsx",
      fileSize: workbookBytes.length,
      sheets: [
        { name: "Data", rowCount: 5, colCount: 3 },
        { name: "Other", rowCount: 2, colCount: 1 },
      ],
    });
    expect(progress.map((p) => p.phase)).toContain("reading");
    const loaded = await handlers.loadTable({ datasetId: "main", sheetNames: [], headerRow: 1, previewLimit: 2, lookup: null }, ctx);
    expect(loaded).toEqual({
      columns: [
        { name: "Region", type: "text", index: 0 },
        { name: "Sales", type: "number", index: 1 },
        { name: "When", type: "date", index: 2 },
      ],
      rowCount: 3,
      previewRows: [
        ["north", "10", "2024-01-05"],
        ["south", "20.5", ""],
      ],
      sheetNames: ["Data"],
      headerRow: 1,
      warnings: [],
      lookupInfo: null,
    });
    expect(await handlers.getRows({ datasetId: "main", offset: 1, limit: 5 })).toEqual({
      rows: [
        ["south", "20.5", ""],
        ["east", "0.1", ""],
      ],
      offset: 1,
      total: 3,
    });
  });

  it("previews a workflow with validation and run-time issues", async () => {
    const handlers = await load();
    await handlers.loadTable({ datasetId: "main", sheetNames: ["Data"], headerRow: 1, previewLimit: 5 }, ctx);
    const broken = { ...definition, fields: [...definition.fields, createField({ name: "Ghost", source: { kind: "column", column: "Nope" } })] };
    const preview = await handlers.runPreview({ datasetId: "main", definition: broken, outputId: null, limit: 2 }, ctx);
    expect(preview.columns).toEqual([
      { key: region.id, name: "Region", type: "text" },
      { key: sales.id, name: "Sales", type: "number" },
      { key: broken.fields[2].id, name: "Ghost", type: "text" },
    ]);
    expect(preview.rows).toEqual([
      ["North", "10", ""],
      ["South", "20.5", ""],
    ]);
    expect(preview.totalRows).toBe(3);
    expect(preview.sourceRows).toBe(3);
    expect(preview.issues.map((issue) => issue.code)).toEqual(["missing-column", "duplicate-output-name", "duplicate-output-name"]);
    const projected = await handlers.runPreview({ datasetId: "main", definition, outputId: summary.id, limit: 10 }, ctx);
    expect(projected.rows).toEqual([["North"], ["South"], ["East"]]);
  });

  it("builds one output and a zip of several", async () => {
    const handlers = await load();
    await handlers.loadTable({ datasetId: "main", sheetNames: ["Data"], headerRow: 1 }, ctx);
    const file = await handlers.buildOutput({ datasetId: "main", definition, outputId: detail.id }, ctx);
    expect(file.fileName).toBe("Detail.csv");
    expect(file.rowCount).toBe(3);
    expect(new TextDecoder().decode(file.bytes)).toBe("Region,Sales\r\nNorth,10\r\nSouth,20.5\r\nEast,0.1\r\n");
    const zip = await handlers.buildZip({ datasetId: "main", definition, outputIds: null, zipName: "Export: May" }, ctx);
    expect(zip.fileName).toBe("Export May.zip");
    expect(zip.mime).toBe("application/zip");
    expect(zip.files).toEqual([
      { fileName: "Detail.csv", rowCount: 3 },
      { fileName: "Detail (2).csv", rowCount: 3 },
    ]);
    const entries = await JSZip.loadAsync(zip.bytes);
    expect(await entries.file("Detail (2).csv").async("string")).toBe("﻿Region\r\nNorth\r\nSouth\r\nEast\r\n");
    const only = await handlers.buildZip({ datasetId: "main", definition, outputIds: [summary.id], zipName: "x" }, ctx);
    expect(only.files).toEqual([{ fileName: "Detail.csv", rowCount: 3 }]);
  });

  it("throws coded errors for missing data and bad requests", async () => {
    const handlers = await load();
    const fail = async (promise) => {
      try {
        await promise;
      } catch (error) {
        return error.code;
      }
      return null;
    };
    expect(await fail(handlers.runPreview({ datasetId: "main", definition, outputId: null, limit: 5 }, ctx))).toBe("NO_DATA");
    expect(await fail(handlers.loadTable({ datasetId: "other", sheetNames: [] }, ctx))).toBe("NO_DATA");
    await handlers.loadTable({ datasetId: "main", sheetNames: [], headerRow: 1 }, ctx);
    expect(await fail(handlers.runPreview({ datasetId: "main", definition: null, outputId: null }, ctx))).toBe("INVALID_DEFINITION");
    expect(await fail(handlers.buildOutput({ datasetId: "main", definition, outputId: "out_gone" }, ctx))).toBe("INVALID_DEFINITION");
    expect(await fail(handlers.buildZip({ datasetId: "main", definition, outputIds: [], zipName: "x" }, ctx))).toBe("INVALID_DEFINITION");
    expect(await fail(handlers.loadTable({ datasetId: "main", sheetNames: ["Data"], headerRow: 9 }, ctx))).toBe("EMPTY_SHEET");
    expect(await fail(handlers.runPreview({ datasetId: "main", definition, outputId: null }, ctx))).toBe("NO_DATA");
    expect(await fail(handlers.parseFile({ file: fakeFile(encode("x"), "x.pdf"), datasetId: "main" }, ctx))).toBe("UNSUPPORTED_FORMAT");
    expect(await fail(handlers.getRows({ datasetId: "main" }))).toBe("NO_DATA");
    expect(await handlers.disposeDataset({ datasetId: "main" })).toEqual({ ok: true });
  });

  it("keeps datasets apart", async () => {
    const handlers = await load();
    await handlers.parseFile({ file: fakeFile(encode("Code,Name\nA1,Lookup"), "lookup.csv"), datasetId: "lookup" }, ctx);
    const lookup = await handlers.loadTable({ datasetId: "lookup", sheetNames: [], headerRow: 1 }, ctx);
    const main = await handlers.loadTable({ datasetId: "main", sheetNames: [], headerRow: 1 }, ctx);
    expect(lookup.columns.map((c) => c.name)).toEqual(["Code", "Name"]);
    expect(main.columns.map((c) => c.name)).toEqual(["Region", "Sales", "When"]);
    await handlers.disposeDataset({ datasetId: "lookup" });
    expect((await handlers.getRows({ datasetId: "main", offset: 0, limit: 1 })).total).toBe(3);
  });
});
