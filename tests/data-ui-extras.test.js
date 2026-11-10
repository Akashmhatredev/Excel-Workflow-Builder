import { describe, expect, it } from "vitest";
import { describeCleaningStats } from "@/components/mapping/cleaning";
import { csvCell, describePivot, resolvePivot, summaryFileName, toCsv } from "@/components/summary/pivot";
import { columnSelection, describeLookupInfo, suggestKeyPair, toggleColumn } from "@/components/upload/lookup";

const fields = [
  { id: "f1", name: "Region" },
  { id: "f2", name: "Amount" },
  { id: "f3", name: "Category" },
];

describe("summary CSV", () => {
  it("quotes only what needs quoting and adds a BOM and CRLF line ends", () => {
    expect(csvCell("plain")).toBe("plain");
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell("a,b")).toBe('"a,b"');
    expect(csvCell(" padded")).toBe('" padded"');
    expect(csvCell(null)).toBe("");
    const text = toCsv([{ name: "Region" }, "Total"], [["North", "1,200"], ["Total", "1,200"]]);
    expect(text).toBe('﻿Region,Total\r\nNorth,"1,200"\r\nTotal,"1,200"\r\n');
  });
});

describe("pivot settings", () => {
  it("falls back to a text field for rows and never pivots a field against itself", () => {
    const types = { f1: "text", f2: "number", f3: "text" };
    expect(resolvePivot({ rowKey: "gone", columnKey: "", valueKey: "", fn: "count" }, fields, types)).toEqual({
      rowKey: "f1",
      columnKey: "",
      valueKey: "",
      fn: "count",
      ready: true,
    });
    expect(resolvePivot({ rowKey: "f3", columnKey: "f3", valueKey: "", fn: "sum" }, fields, types)).toMatchObject({
      columnKey: "",
      ready: false,
    });
    expect(resolvePivot({ rowKey: "f1", columnKey: "f3", valueKey: "f2", fn: "bogus" }, fields, types)).toMatchObject({
      fn: "count",
      ready: true,
    });
    expect(resolvePivot({ rowKey: "", columnKey: "", valueKey: "", fn: "count" }, [], {}).ready).toBe(false);
  });

  it("describes the pivot and names the download", () => {
    const title = describePivot({ rowKey: "f1", columnKey: "f3", valueKey: "f2", fn: "sum" }, fields);
    expect(title).toBe("Sum of Amount by Region and Category");
    expect(describePivot({ rowKey: "f1", columnKey: "", valueKey: "", fn: "count" }, fields)).toBe("Count of rows by Region");
    expect(summaryFileName("Sum of a/b")).toBe("Summary - Sum of a b.csv");
  });
});

describe("cleaning stats", () => {
  it("lists only what changed", () => {
    expect(describeCleaningStats({ duplicatesRemoved: 12, emptyRowsRemoved: 0, blanksFilled: 4 })).toBe(
      "12 duplicates removed, 4 blanks filled",
    );
    expect(describeCleaningStats({ duplicatesRemoved: 0, emptyRowsRemoved: 1, blanksFilled: 0 })).toBe("1 empty row removed");
    expect(describeCleaningStats(null)).toBe("");
  });
});

describe("lookup helpers", () => {
  const main = [{ name: "Region" }, { name: "order id" }, { name: "Qty" }];
  const lookup = [{ name: "Return ID" }, { name: "Order ID" }, { name: "Region" }, { name: "Reason" }];

  it("suggests a shared, identifier-like key column", () => {
    expect(suggestKeyPair(main, lookup)).toEqual({ matchColumn: "order id", lookupColumn: "Order ID" });
    expect(suggestKeyPair([{ name: "Region" }], lookup)).toEqual({ matchColumn: "Region", lookupColumn: "Region" });
    expect(suggestKeyPair([{ name: "Qty" }], lookup)).toBeNull();
  });

  it("treats [] as every column except the key and never leaves none chosen", () => {
    const all = columnSelection(lookup, "Order ID", []);
    expect(all.candidates).toEqual(["Return ID", "Region", "Reason"]);
    expect(all.all).toBe(true);
    expect(toggleColumn(all, "Region", false)).toEqual(["Return ID", "Reason"]);
    const one = columnSelection(lookup, "Order ID", ["Reason", "Missing"]);
    expect([...one.selected]).toEqual(["Reason"]);
    expect(toggleColumn(one, "Reason", false)).toBeNull();
    expect(toggleColumn(columnSelection(lookup, "Order ID", ["Return ID", "Region"]), "Reason", true)).toEqual([]);
  });

  it("summarises lookupInfo", () => {
    expect(describeLookupInfo(null)).toBeNull();
    expect(describeLookupInfo({ applied: false })).toBeNull();
    const info = describeLookupInfo({ applied: true, matched: 280, unmatched: 20, duplicateKeys: 3, addedColumns: ["Reason"] });
    expect(info.headline).toBe("Matched 280 of 300 rows");
    expect(info.details).toEqual([
      "20 rows without a match (their new cells stay empty)",
      "3 duplicate keys in the second file (the first matching row is used)",
    ]);
    expect(info.added).toEqual(["Reason"]);
  });
});
