import { beforeEach, describe, expect, it } from "vitest";
import { imageToPdf } from "@/lib/pdf";
import { createCleaning, createDefinition, createLookup, collectColumnRefs, normalizeDefinition, normalizeTags, remapColumnRefs } from "@/lib/schema";
import { buildShareUrl, compressToUrl, decompressFromUrl, readSharePayload } from "@/lib/shareLink";

function fakeStorage() {
  const map = new Map();
  return {
    get length() {
      return map.size;
    },
    key: (i) => [...map.keys()][i] ?? null,
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
  };
}

describe("share links", () => {
  it("round-trips text through a URL payload", async () => {
    const text = JSON.stringify({ name: "Ünïcode ✓", list: Array.from({ length: 200 }, (_, i) => `field ${i}`) });
    const payload = await compressToUrl(text);
    expect(payload).toMatch(/^[cu]\.[A-Za-z0-9_-]+$/);
    expect(payload.length).toBeLessThan(text.length);
    const url = buildShareUrl("https://example.com/", payload);
    expect(url.startsWith("https://example.com/templates#template=")).toBe(true);
    expect(await decompressFromUrl(readSharePayload(new URL(url).hash))).toBe(text);
  });

  it("rejects broken payloads with a readable message", async () => {
    await expect(decompressFromUrl("nope")).rejects.toThrow(/not valid/);
    await expect(decompressFromUrl("c.AAAA")).rejects.toThrow(/damaged/);
    expect(readSharePayload("#other=1")).toBeNull();
  });
});

describe("imageToPdf", () => {
  it("writes a structurally valid single-page PDF", () => {
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
    const pdf = imageToPdf({ jpeg, width: 800, height: 400, title: "Sales (Q1)", pixelRatio: 2 });
    const text = new TextDecoder("latin1").decode(pdf);
    expect(text.startsWith("%PDF-1.4")).toBe(true);
    expect(text.trimEnd().endsWith("%%EOF")).toBe(true);
    expect(text).toContain("/Filter /DCTDecode");
    expect(text).toContain("/Title (Sales \\(Q1\\))");
    const xrefOffset = Number(text.match(/startxref\n(\d+)/)[1]);
    expect(text.slice(xrefOffset, xrefOffset + 4)).toBe("xref");
    const firstObject = Number(text.slice(xrefOffset).split("\n")[3].slice(0, 10));
    expect(text.slice(firstObject, firstObject + 7)).toBe("1 0 obj");
    // 400 CSS px wide -> 300pt plus two 24pt margins
    expect(text).toContain("/MediaBox [0 0 348 198]");
    expect(() => imageToPdf({ jpeg: new Uint8Array(), width: 1, height: 1 })).toThrow();
  });
});

describe("schema extras", () => {
  it("normalises cleaning, lookup, conditional formats and tags", () => {
    const definition = normalizeDefinition({
      fields: [],
      cleaning: { trimText: 1, fillBlanks: { enabled: true, mode: "bogus" } },
      lookup: { enabled: true, matchColumn: "SKU", lookupColumn: "Code", headerRow: 0 },
      outputs: [{ id: "o1", conditionalFormats: [{ columnKey: "a", operator: "nope", style: "pink" }], report: { logo: "https://evil.example/x.png" } }],
    });
    expect(definition.cleaning).toEqual({ ...createCleaning({ trimText: true }), fillBlanks: { enabled: true, mode: "value", value: "", fieldIds: [] } });
    expect(definition.lookup).toEqual(createLookup({ enabled: true, matchColumn: "SKU", lookupColumn: "Code" }));
    expect(definition.outputs[0].conditionalFormats[0]).toMatchObject({ operator: "gt", style: "red", bold: false });
    expect(definition.outputs[0].sheetStyle).toEqual({ boldHeader: true, freezeHeader: true, autoFilter: false });
    expect(definition.outputs[0].report.logo).toBe("");
    expect(normalizeTags([" Sales ", "sales", "", "Monthly   report"])).toEqual(["Sales", "Monthly report"]);
  });

  it("treats the lookup match column as a column reference", () => {
    const definition = createDefinition({ lookup: { enabled: true, matchColumn: "SKU", lookupColumn: "Code" } });
    expect(collectColumnRefs(definition)).toEqual(["SKU"]);
    expect(remapColumnRefs(definition, { SKU: "Item Code" }).lookup.mainKeyColumns).toEqual(["Item Code"]);
  });
});

describe("run history", () => {
  beforeEach(() => {
    globalThis.window = { localStorage: fakeStorage() };
  });

  it("logs runs without data and keeps a bounded list", async () => {
    const history = await import("@/lib/history");
    history.clearHistory();
    let notified = 0;
    const unsubscribe = history.subscribeHistory(() => {
      notified += 1;
    });
    history.logRun({ kind: "zip", templateName: "Monthly", fileName: "dump.xlsx", outputs: [{ name: "Detail", fileType: "xlsx", rowCount: 12 }] });
    history.logRun({ kind: "image", fileName: "dump.xlsx" });
    const entries = history.getHistorySnapshot();
    expect(entries).toHaveLength(2);
    expect(entries[0].kind).toBe("image");
    expect(entries[1]).toMatchObject({ templateName: "Monthly", outputs: [{ name: "Detail", fileType: "xlsx", rowCount: 12 }] });
    expect(history.getHistorySnapshot()).toBe(entries);
    history.removeHistoryEntry(entries[0].id);
    expect(history.getHistorySnapshot()).toHaveLength(1);
    expect(notified).toBe(3);
    unsubscribe();
    history.clearHistory();
    expect(history.getHistorySnapshot()).toHaveLength(0);
    delete globalThis.window;
  });
});
