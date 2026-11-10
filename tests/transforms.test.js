import { describe, expect, it } from "vitest";
import { createTransform } from "@/lib/schema";
import {
  applyTransform,
  applyTransforms,
  cleanNumber,
  coerceForFormat,
  compileTransforms,
  dateToExcelSerial,
  excelNumberFormat,
  excelSerialToDate,
  formatDate,
  formatDisplay,
  formatNumber,
  isEmpty,
  isStrictNumeric,
  roundNumber,
  splitTrailingFormat,
  titleCase,
  toDate,
  toNumber,
  toText,
  trimText,
} from "@/lib/transforms";

const day = (y, m, d, h = 0, min = 0, s = 0) => new Date(Date.UTC(y, m - 1, d, h, min, s));
const iso = (value) => (value instanceof Date ? toText(value) : value);
const tr = (type, params = {}) => createTransform(type, params);

describe("isEmpty", () => {
  it("treats null, undefined, blank text, NaN and invalid dates as empty", () => {
    for (const value of [null, undefined, "", "   ", "\t\n", NaN, new Date("nope")]) expect(isEmpty(value)).toBe(true);
  });

  it("keeps zero, false and real values", () => {
    for (const value of [0, false, "0", " x ", day(2024, 1, 5)]) expect(isEmpty(value)).toBe(false);
  });
});

describe("toNumber", () => {
  it.each([
    ["1,234.50", 1234.5],
    ["₹ 1,200", 1200],
    ["(45)", -45],
    ["12%", 12],
    [" 7 ", 7],
    ["-3.5", -3.5],
    ["+3", 3],
    ["3-", -3],
    ["−8", -8],
    ["$1,000,000.25", 1000000.25],
    ["Rs. 500", 500],
    ["INR 2,500", 2500],
    ["12,34,567", 1234567],
    ["1e3", 1000],
    [".5", 0.5],
    ["5.", 5],
    ["(₹ 1,200.50)", -1200.5],
    ["-0", 0],
    ["1 234", 1234],
  ])("reads %j as %j", (input, expected) => {
    expect(toNumber(input)).toBe(expected);
  });

  it.each(["", "  ", "abc", "12 kg", "1,2", "1,23", "1.2.3", "--5", "2024-01-05", "%", "()", "N/A", "12a"])(
    "rejects %j",
    (input) => {
      expect(toNumber(input)).toBeNull();
    },
  );

  it("passes finite numbers through and rejects everything else", () => {
    expect(toNumber(42.5)).toBe(42.5);
    expect(toNumber(Infinity)).toBeNull();
    expect(toNumber(NaN)).toBeNull();
    expect(toNumber(null)).toBeNull();
    expect(toNumber(true)).toBeNull();
    expect(toNumber(day(2024, 1, 5))).toBeNull();
  });
});

describe("isStrictNumeric", () => {
  it("accepts plain numbers only", () => {
    for (const text of ["0", "12", "-12", "12.50", " 7 ", "0.5"]) expect(isStrictNumeric(text)).toBe(true);
    for (const text of ["00123", "0123", "+12", "1,200", "12%", "1e5", ".5", "", "12345678901234567", "abc"]) {
      expect(isStrictNumeric(text)).toBe(false);
    }
    expect(isStrictNumeric(12)).toBe(false);
  });
});

describe("number helpers", () => {
  it("removes float noise", () => {
    expect(cleanNumber(0.1 + 0.2)).toBe(0.3);
    expect(cleanNumber(1.1 * 3)).toBe(3.3);
    expect(cleanNumber(5)).toBe(5);
    expect(cleanNumber("x")).toBe("x");
  });

  it("rounds half away from zero, also for values stored just below the half", () => {
    expect(roundNumber(2.675, 2)).toBe(2.68);
    expect(roundNumber(1.005, 2)).toBe(1.01);
    expect(roundNumber(-1.005, 2)).toBe(-1.01);
    expect(roundNumber(2.5)).toBe(3);
    expect(roundNumber(-2.5)).toBe(-3);
    expect(roundNumber(1234.5, -2)).toBe(1200);
    expect(roundNumber(-0.001, 2)).toBe(0);
    expect(Object.is(roundNumber(-0.001, 2), -0)).toBe(false);
  });
});

describe("toDate", () => {
  it.each([
    ["2024-01-05", "2024-01-05"],
    ["2024-1-5", "2024-01-05"],
    ["2024-01-05T10:30:00", "2024-01-05 10:30"],
    ["2024-01-05T10:30:00Z", "2024-01-05 10:30"],
    ["2024-01-05T10:30:00+05:30", "2024-01-05 10:30"],
    ["2024-01-05 10:30:15.250", "2024-01-05 10:30:15"],
    ["05/01/2024", "2024-01-05"],
    ["5/1/2024", "2024-01-05"],
    ["05-01-2024", "2024-01-05"],
    ["05.01.2024", "2024-01-05"],
    ["2024/01/05", "2024-01-05"],
    ["2024.01.05", "2024-01-05"],
    ["5 Jan 2024", "2024-01-05"],
    ["05 January 2024", "2024-01-05"],
    ["5-Jan-24", "2024-01-05"],
    ["5-Jan-99", "1999-01-05"],
    ["5th Sept 2024", "2024-09-05"],
    ["Jan 5, 2024", "2024-01-05"],
    ["January 5 2024", "2024-01-05"],
    ["Jan 5, 2024, 4:05 PM", "2024-01-05 16:05"],
    ["05/01/2024 12:00 am", "2024-01-05"],
    ["05/01/2024 12:30 PM", "2024-01-05 12:30"],
    ["05/01/2024 23:59", "2024-01-05 23:59"],
  ])("reads %j", (input, expected) => {
    expect(toText(toDate(input))).toBe(expected);
  });

  it("is day-first when ambiguous and month-first only when it must be", () => {
    expect(iso(toDate("03/04/2024"))).toBe("2024-04-03");
    expect(iso(toDate("12/25/2024"))).toBe("2024-12-25");
    expect(iso(toDate("25/12/2024"))).toBe("2024-12-25");
  });

  it.each([
    "31/02/2024",
    "29/02/2023",
    "2024-13-01",
    "2024-00-10",
    "32/01/2024",
    "05/01/2024 25:00",
    "05/01/2024 13:00 PM",
    "5 Foo 2024",
    "hello",
    "2024",
    "12345",
    "1/2",
    "",
    "05/01/24",
  ])("rejects %j", (input) => {
    expect(toDate(input)).toBeNull();
  });

  it("accepts leap days and passes Date objects through", () => {
    expect(iso(toDate("29/02/2024"))).toBe("2024-02-29");
    const date = day(2024, 1, 5);
    expect(toDate(date)).toBe(date);
    expect(toDate(new Date("nope"))).toBeNull();
  });

  it("never treats numbers as dates", () => {
    expect(toDate(45296)).toBeNull();
    expect(toDate(null)).toBeNull();
    expect(toDate(true)).toBeNull();
  });
});

describe("toText", () => {
  it("prints numbers without float noise", () => {
    expect(toText(0.1 + 0.2)).toBe("0.3");
    expect(toText(1234567.891)).toBe("1234567.891");
    expect(toText(1e-7)).toBe("0.0000001");
    expect(toText(-0)).toBe("0");
    expect(toText(42)).toBe("42");
    expect(toText(NaN)).toBe("");
    expect(toText(Infinity)).toBe("");
  });

  it("prints dates as YYYY-MM-DD plus a time when there is one", () => {
    expect(toText(day(2024, 1, 5))).toBe("2024-01-05");
    expect(toText(day(2024, 1, 5, 9, 7))).toBe("2024-01-05 09:07");
    expect(toText(day(2024, 1, 5, 9, 7, 30))).toBe("2024-01-05 09:07:30");
    expect(toText(new Date("nope"))).toBe("");
  });

  it("handles empties, booleans and text", () => {
    expect(toText(null)).toBe("");
    expect(toText(undefined)).toBe("");
    expect(toText(true)).toBe("TRUE");
    expect(toText(false)).toBe("FALSE");
    expect(toText("  as is ")).toBe("  as is ");
  });
});

describe("text helpers", () => {
  it("trims the ends and collapses inner runs of spaces", () => {
    expect(trimText("  Rahul   Sharma \t")).toBe("Rahul Sharma");
    expect(trimText("a  b")).toBe("a b");
    expect(trimText("line 1\nline 2")).toBe("line 1\nline 2");
  });

  it("title-cases words, including after hyphens, slashes and brackets", () => {
    expect(titleCase("rahul SHARMA")).toBe("Rahul Sharma");
    expect(titleCase("mary-jane o'neil")).toBe("Mary-Jane O'neil");
    expect(titleCase("north/east (zone a)")).toBe("North/East (Zone A)");
    expect(titleCase("élodie ünal")).toBe("Élodie Ünal");
  });
});

describe("formatNumber", () => {
  it("applies decimals, thousands separators, prefix and suffix", () => {
    expect(formatNumber(1234.5, { decimals: 2, thousands: true, prefix: "₹" })).toBe("₹1,234.50");
    expect(formatNumber(1234567, { decimals: 0, thousands: true, suffix: " kg" })).toBe("1,234,567 kg");
    expect(formatNumber(1234567, { decimals: 0, thousands: false })).toBe("1234567");
    expect(formatNumber(999.999, { decimals: 2, thousands: true })).toBe("1,000.00");
    expect(formatNumber(12.5, { decimals: 0, suffix: "%" })).toBe("13%");
  });

  it("puts the minus sign before the prefix and drops it when the value rounds to zero", () => {
    expect(formatNumber(-1234.5, { decimals: 1, thousands: true, prefix: "$" })).toBe("-$1,234.5");
    expect(formatNumber(-0.001, { decimals: 2 })).toBe("0.00");
  });

  it("reads numeric text and leaves other values alone", () => {
    expect(formatNumber("1,234.5", { decimals: 2, thousands: true })).toBe("1,234.50");
    expect(formatNumber("N/A", { decimals: 2 })).toBe("N/A");
    expect(formatNumber(null, { decimals: 2 })).toBe("");
  });

  it("defaults to 2 decimals and clamps silly values", () => {
    expect(formatNumber(1.234)).toBe("1.23");
    expect(formatNumber(1.5, { decimals: -3 })).toBe("2");
    expect(formatNumber(1, { decimals: 99 })).toBe("1.0000000000");
    expect(formatNumber(1, { decimals: "x" })).toBe("1.00");
  });
});

describe("formatDate", () => {
  const date = day(2024, 1, 5, 16, 7, 9);

  it.each([
    ["DD/MM/YYYY", "05/01/2024"],
    ["MM/DD/YYYY", "01/05/2024"],
    ["YYYY-MM-DD", "2024-01-05"],
    ["DD-MMM-YYYY", "05-Jan-2024"],
    ["DD MMM YYYY", "05 Jan 2024"],
    ["MMM D, YYYY", "Jan 5, 2024"],
    ["MMMM YYYY", "January 2024"],
    ["DD/MM/YYYY HH:mm", "05/01/2024 16:07"],
    ["D/M/YY H:mm:ss", "5/1/24 16:07:09"],
    ["hh:mm A", "04:07 PM"],
    ["h A", "4 PM"],
    ["[Week of] D MMM", "Week of 5 Jan"],
  ])("formats %j", (pattern, expected) => {
    expect(formatDate(date, pattern)).toBe(expected);
  });

  it("handles midnight and noon in 12-hour patterns", () => {
    expect(formatDate(day(2024, 1, 5, 0, 15), "h:mm A")).toBe("12:15 AM");
    expect(formatDate(day(2024, 1, 5, 12, 0), "h:mm A")).toBe("12:00 PM");
  });

  it("reads date text and leaves other values alone", () => {
    expect(formatDate("05/01/2024", "DD MMM YYYY")).toBe("05 Jan 2024");
    expect(formatDate("soon", "DD MMM YYYY")).toBe("soon");
    expect(formatDate(45296, "DD MMM YYYY")).toBe("45296");
    expect(formatDate(day(2024, 1, 5), "")).toBe("2024-01-05");
  });
});

describe("Excel serial numbers", () => {
  it("converts both ways in the 1900 date system", () => {
    expect(toText(excelSerialToDate(45296))).toBe("2024-01-05");
    expect(dateToExcelSerial(day(2024, 1, 5))).toBe(45296);
    expect(toText(excelSerialToDate(45296.5))).toBe("2024-01-05 12:00");
    expect(dateToExcelSerial(day(2024, 1, 5, 12))).toBe(45296.5);
  });

  it("keeps Excel's fictional 29 Feb 1900 out of real dates", () => {
    expect(toText(excelSerialToDate(1))).toBe("1900-01-01");
    expect(toText(excelSerialToDate(59))).toBe("1900-02-28");
    expect(toText(excelSerialToDate(61))).toBe("1900-03-01");
    expect(dateToExcelSerial(day(1900, 1, 1))).toBe(1);
    expect(dateToExcelSerial(day(1900, 3, 1))).toBe(61);
    expect(excelSerialToDate("x")).toBeNull();
  });
});

describe("applyTransform", () => {
  it("changes the case of text and leaves other values alone", () => {
    expect(applyTransform("  Mixed  Case ", tr("trim"))).toBe("Mixed Case");
    expect(applyTransform("abc", tr("upper"))).toBe("ABC");
    expect(applyTransform("ABC", tr("lower"))).toBe("abc");
    expect(applyTransform("NEW delhi", tr("title"))).toBe("New Delhi");
    for (const type of ["trim", "upper", "lower", "title"]) {
      expect(applyTransform(12, tr(type))).toBe(12);
      expect(applyTransform(null, tr(type))).toBeNull();
    }
  });

  it("number and date formats produce strings", () => {
    expect(applyTransform(1234.5, tr("numberFormat", { decimals: 1, thousands: true }))).toBe("1,234.5");
    expect(applyTransform(day(2024, 1, 5), tr("dateFormat", { pattern: "DD MMM YYYY" }))).toBe("05 Jan 2024");
    expect(applyTransform(null, tr("numberFormat"))).toBeNull();
    expect(applyTransform("", tr("dateFormat"))).toBe("");
  });

  it("fills empty values only, keeping numeric defaults numeric", () => {
    expect(applyTransform("", tr("default", { value: "N/A" }))).toBe("N/A");
    expect(applyTransform(null, tr("default", { value: "0" }))).toBe(0);
    expect(applyTransform("  ", tr("default", { value: "007" }))).toBe("007");
    expect(applyTransform("kept", tr("default", { value: "N/A" }))).toBe("kept");
    expect(applyTransform(0, tr("default", { value: "N/A" }))).toBe(0);
  });

  it("splits by a delimiter and picks a 1-based part (negative counts from the end)", () => {
    expect(applyTransform("a, b, c", tr("split", { delimiter: ",", index: 2 }))).toBe(" b");
    expect(applyTransform("a,b,c", tr("split", { delimiter: ",", index: -1 }))).toBe("c");
    expect(applyTransform("a,b", tr("split", { delimiter: ",", index: 5 }))).toBe("");
    expect(applyTransform("a\tb", tr("split", { delimiter: "\\t", index: 2 }))).toBe("b");
    expect(applyTransform("a,b", tr("split", { delimiter: "", index: 2 }))).toBe("a,b");
    expect(applyTransform(null, tr("split"))).toBeNull();
    expect(applyTransform(12.5, tr("split", { delimiter: ".", index: 2 }))).toBe("5");
  });

  it("finds and replaces literally by default, ignoring case", () => {
    expect(applyTransform("Foo.bar.FOO", tr("replace", { find: "foo", replaceWith: "x" }))).toBe("x.bar.x");
    expect(applyTransform("a.b", tr("replace", { find: ".", replaceWith: "-" }))).toBe("a-b");
    expect(applyTransform("Cost $5", tr("replace", { find: "$5", replaceWith: "$$6" }))).toBe("Cost $$6");
    expect(applyTransform("Foo foo", tr("replace", { find: "foo", replaceWith: "x", matchCase: true }))).toBe("Foo x");
  });

  it("supports regular expressions with groups", () => {
    const swap = tr("replace", { find: "(\\w+) (\\w+)", replaceWith: "$2, $1", useRegex: true });
    expect(applyTransform("Asha Rao", swap)).toBe("Rao, Asha");
    expect(applyTransform("ph: 98-76", tr("replace", { find: "\\D", replaceWith: "", useRegex: true }))).toBe("9876");
  });

  it("ignores invalid patterns and empty searches, and keeps the type when nothing changed", () => {
    expect(applyTransform("a(b", tr("replace", { find: "(", replaceWith: "x", useRegex: true }))).toBe("a(b");
    expect(applyTransform("abc", tr("replace", { find: "", replaceWith: "x" }))).toBe("abc");
    expect(applyTransform(1234, tr("replace", { find: "9", replaceWith: "0" }))).toBe(1234);
    expect(applyTransform(1234, tr("replace", { find: "4", replaceWith: "0" }))).toBe("1230");
    expect(applyTransform(null, tr("replace", { find: "a", replaceWith: "b" }))).toBeNull();
  });

  it("does nothing for unknown or missing transforms", () => {
    expect(applyTransform("x", { type: "bogus" })).toBe("x");
    expect(applyTransform("x", null)).toBe("x");
  });
});

describe("applyTransforms", () => {
  it("applies the chain in order", () => {
    expect(applyTransforms("  rahul   SHARMA ", [tr("trim"), tr("title")])).toBe("Rahul Sharma");
    expect(applyTransforms("", [tr("default", { value: "n/a" }), tr("upper")])).toBe("N/A");
    expect(applyTransforms("", [tr("upper"), tr("default", { value: "n/a" })])).toBe("n/a");
    const plainNumber = tr("numberFormat", { decimals: 0, thousands: false });
    expect(applyTransforms(1234.5, [plainNumber, tr("replace", { find: "3", replaceWith: "x" })])).toBe("12x5");
  });

  it("returns the value unchanged for an empty or missing chain", () => {
    expect(applyTransforms(5, [])).toBe(5);
    expect(applyTransforms(5, undefined)).toBe(5);
  });

  it("matches compileTransforms", () => {
    const chain = [tr("trim"), tr("split", { delimiter: " ", index: 1 }), tr("upper")];
    const compiled = compileTransforms(chain);
    for (const value of ["  ada lovelace", "x", "", null]) expect(compiled(value)).toEqual(applyTransforms(value, chain));
    expect(compileTransforms([])("same")).toBe("same");
  });
});

describe("column formats", () => {
  it("splits off a trailing number or date format", () => {
    const numberFormat = tr("numberFormat");
    const trim = tr("trim");
    expect(splitTrailingFormat([trim, numberFormat])).toEqual({ head: [trim], format: numberFormat });
    expect(splitTrailingFormat([numberFormat, trim])).toEqual({ head: [numberFormat, trim], format: null });
    expect(splitTrailingFormat([])).toEqual({ head: [], format: null });
    expect(splitTrailingFormat(undefined)).toEqual({ head: [], format: null });
  });

  it("coerces values to the type a format expects", () => {
    expect(coerceForFormat("1,200", tr("numberFormat"))).toBe(1200);
    expect(coerceForFormat("n/a", tr("numberFormat"))).toBe("n/a");
    expect(iso(coerceForFormat("05/01/2024", tr("dateFormat")))).toBe("2024-01-05");
    expect(coerceForFormat("x", null)).toBe("x");
  });

  it("formats typed values for display", () => {
    expect(formatDisplay(1234.5, tr("numberFormat", { decimals: 2, thousands: true, prefix: "₹" }))).toBe("₹1,234.50");
    expect(formatDisplay(day(2024, 1, 5), tr("dateFormat", { pattern: "DD/MM/YYYY" }))).toBe("05/01/2024");
    expect(formatDisplay(null, tr("numberFormat"))).toBe("");
    expect(formatDisplay("n/a", tr("numberFormat"))).toBe("n/a");
    expect(formatDisplay(0.1 + 0.2, null)).toBe("0.3");
  });

  it("translates formats to Excel number formats", () => {
    expect(excelNumberFormat(tr("numberFormat", { decimals: 2, thousands: true }))).toBe("#,##0.00");
    expect(excelNumberFormat(tr("numberFormat", { decimals: 0, thousands: false }))).toBe("0");
    expect(excelNumberFormat(tr("numberFormat", { decimals: 1, thousands: true, prefix: "₹ ", suffix: " cr" }))).toBe(
      '"₹ "#,##0.0" cr"',
    );
    expect(excelNumberFormat(tr("numberFormat", { decimals: 0, thousands: false, suffix: '"' }))).toBe('0\\"');
    expect(excelNumberFormat(tr("dateFormat", { pattern: "DD/MM/YYYY" }))).toBe("dd/mm/yyyy");
    expect(excelNumberFormat(tr("dateFormat", { pattern: "DD-MMM-YYYY" }))).toBe("dd-mmm-yyyy");
    expect(excelNumberFormat(tr("dateFormat", { pattern: "MMMM YYYY" }))).toBe("mmmm yyyy");
    expect(excelNumberFormat(tr("dateFormat", { pattern: "MMM D, YYYY" }))).toBe("mmm d, yyyy");
    expect(excelNumberFormat(tr("dateFormat", { pattern: "DD/MM/YYYY hh:mm A" }))).toBe("dd/mm/yyyy hh:mm AM/PM");
    expect(excelNumberFormat(tr("dateFormat", { pattern: "[Week] D" }))).toBe('"Week" d');
    expect(excelNumberFormat(tr("dateFormat", { pattern: "" }))).toBe("yyyy-mm-dd");
    expect(excelNumberFormat(null)).toBeNull();
    expect(excelNumberFormat({ type: "trim" })).toBeNull();
  });
});
