import { describe, expect, it, vi } from "vitest";
import {
  compareText,
  compareValues,
  compileFilterGroup,
  compileRule,
  evaluateFilterGroup,
  evaluateRule,
  isRuleComplete,
} from "@/lib/filters";
import { createFilterRule } from "@/lib/schema";

const day = (y, m, d, h = 0, min = 0) => new Date(Date.UTC(y, m - 1, d, h, min));
const rule = (operator, value = "", value2 = "", target = { kind: "column", ref: "x" }) =>
  createFilterRule({ operator, value, value2, target });
const passes = (operator, value, value2, cell) => evaluateRule(rule(operator, value, value2), cell);

describe("compareValues", () => {
  it("compares numbers and numeric text numerically", () => {
    expect(compareValues(2, 10)).toBe(-1);
    expect(compareValues("2", "10")).toBe(-1);
    expect(compareValues("1,000", 999)).toBe(1);
    expect(compareValues(5, "5.0")).toBe(0);
  });

  it("compares dates chronologically, whatever form they come in", () => {
    expect(compareValues(day(2024, 1, 5), day(2024, 1, 4))).toBe(1);
    expect(compareValues("05/01/2024", day(2024, 1, 4))).toBe(1);
    expect(compareValues("2024-01-05", "05/01/2024")).toBe(0);
    expect(compareValues("Jan 5, 2024", "2024-02-01")).toBe(-1);
  });

  it("falls back to case-insensitive text, ignoring surrounding spaces", () => {
    expect(compareValues("apple", "Banana")).toBe(-1);
    expect(compareValues("b", "A")).toBe(1);
    expect(compareValues(" Pune ", "pune")).toBe(0);
    expect(compareValues("10", "abc")).toBe(-1);
    expect(compareValues(null, "")).toBe(0);
    expect(compareText("é", "e")).not.toBe(0);
  });
});

describe("isRuleComplete", () => {
  it("needs a target and the values the operator uses", () => {
    expect(isRuleComplete(rule("equals", "x"))).toBe(true);
    expect(isRuleComplete(rule("equals", ""))).toBe(false);
    expect(isRuleComplete(rule("equals", "   "))).toBe(false);
    expect(isRuleComplete(rule("between", "1", ""))).toBe(false);
    expect(isRuleComplete(rule("between", "1", "5"))).toBe(true);
    expect(isRuleComplete(rule("isEmpty"))).toBe(true);
    expect(isRuleComplete(rule("isEmpty", "", "", { kind: "column", ref: "" }))).toBe(false);
    expect(isRuleComplete({ ...rule("equals", "x"), operator: "bogus" })).toBe(false);
    expect(isRuleComplete(null)).toBe(false);
  });
});

describe("evaluateRule", () => {
  it("equals: numbers numerically, dates by day, text ignoring case and spaces", () => {
    expect(passes("equals", "100", "", 100)).toBe(true);
    expect(passes("equals", "100", "", "100.00")).toBe(true);
    expect(passes("equals", "1000", "", "1,000")).toBe(true);
    expect(passes("equals", "100", "", "1000")).toBe(false);
    expect(passes("equals", "mumbai", "", " Mumbai ")).toBe(true);
    expect(passes("equals", "Mumbai", "", "Navi Mumbai")).toBe(false);
    expect(passes("equals", "05/01/2024", "", day(2024, 1, 5, 15, 30))).toBe(true);
    expect(passes("equals", "2024-01-05", "", "05-01-2024")).toBe(true);
    expect(passes("equals", "2024-01-05 10:00", "", day(2024, 1, 5, 15, 30))).toBe(false);
    expect(passes("equals", "x", "", null)).toBe(false);
  });

  it("notEquals is the opposite of equals, and empty cells pass it", () => {
    expect(passes("notEquals", "cancelled", "", "Cancelled")).toBe(false);
    expect(passes("notEquals", "cancelled", "", "Delivered")).toBe(true);
    expect(passes("notEquals", "cancelled", "", null)).toBe(true);
    expect(passes("notEquals", "5", "", "five")).toBe(true);
  });

  it("text operators ignore case", () => {
    expect(passes("contains", "PUNE", "", "Pune West")).toBe(true);
    expect(passes("contains", "x", "", null)).toBe(false);
    expect(passes("notContains", "test", "", "Real order")).toBe(true);
    expect(passes("notContains", "test", "", "TEST order")).toBe(false);
    expect(passes("notContains", "test", "", null)).toBe(true);
    expect(passes("startsWith", "so-", "", "SO-10001")).toBe(true);
    expect(passes("startsWith", "so-", "", "  SO-1")).toBe(true);
    expect(passes("startsWith", "10", "", "SO-10")).toBe(false);
    expect(passes("endsWith", ".COM", "", "asha@example.com ")).toBe(true);
    expect(passes("contains", "12", "", 1234)).toBe(true);
    expect(passes("contains", "2024-01", "", day(2024, 1, 5))).toBe(true);
  });

  it("comparisons are numeric for numeric operands", () => {
    expect(passes("gt", "100", "", 250)).toBe(true);
    expect(passes("gt", "100", "", "99")).toBe(false);
    expect(passes("gt", "9", "", "10")).toBe(true);
    expect(passes("gte", "100", "", 100)).toBe(true);
    expect(passes("lt", "0", "", "(45)")).toBe(true);
    expect(passes("lte", "1,000", "", 1000)).toBe(true);
    expect(passes("gt", "100", "", "N/A")).toBe(false);
    expect(passes("lt", "100", "", null)).toBe(false);
  });

  it("comparisons are chronological for date operands and whole days include their times", () => {
    expect(passes("gt", "01/01/2024", "", day(2024, 1, 5))).toBe(true);
    expect(passes("lt", "01/01/2024", "", "31/12/2023")).toBe(true);
    expect(passes("lte", "2024-01-05", "", day(2024, 1, 5, 23, 59))).toBe(true);
    expect(passes("gt", "2024-01-05", "", day(2024, 1, 5, 23, 59))).toBe(false);
    expect(passes("gte", "2024-01-05 12:00", "", day(2024, 1, 5, 9))).toBe(false);
    expect(passes("gt", "01/01/2024", "", "not a date")).toBe(false);
  });

  it("comparisons are alphabetical for text operands", () => {
    expect(passes("lt", "m", "", "apple")).toBe(true);
    expect(passes("gte", "M", "", "mango")).toBe(true);
  });

  it("between is inclusive and accepts bounds in either order", () => {
    expect(passes("between", "10", "20", 10)).toBe(true);
    expect(passes("between", "10", "20", 20)).toBe(true);
    expect(passes("between", "10", "20", 21)).toBe(false);
    expect(passes("between", "20", "10", 15)).toBe(true);
    expect(passes("between", "01/01/2024", "31/01/2024", day(2024, 1, 31, 18))).toBe(true);
    expect(passes("between", "01/01/2024", "31/01/2024", day(2024, 2, 1))).toBe(false);
    expect(passes("between", "1", "5", null)).toBe(false);
  });

  it("isEmpty / notEmpty", () => {
    for (const value of [null, undefined, "", "  "]) {
      expect(passes("isEmpty", "", "", value)).toBe(true);
      expect(passes("notEmpty", "", "", value)).toBe(false);
    }
    for (const value of [0, "0", "x", day(2024, 1, 5)]) {
      expect(passes("isEmpty", "", "", value)).toBe(false);
      expect(passes("notEmpty", "", "", value)).toBe(true);
    }
  });

  it("incomplete or unknown rules let everything through", () => {
    expect(passes("equals", "", "", "anything")).toBe(true);
    expect(passes("between", "1", "", 99)).toBe(true);
    expect(evaluateRule({ ...rule("equals", "x"), operator: "bogus" }, "y")).toBe(true);
    expect(evaluateRule(null, "y")).toBe(true);
  });

  it("matches compileRule", () => {
    const r = rule("contains", "ab");
    const compiled = compileRule(r);
    for (const value of ["xaby", "nope", null, 12]) expect(compiled(value)).toBe(evaluateRule(r, value));
  });
});

describe("evaluateFilterGroup", () => {
  const row = { Region: "North", Qty: 12, Status: "Delivered" };
  const resolve = (target) => row[target.ref];
  const on = (ref, operator, value, value2) => rule(operator, value, value2, { kind: "column", ref });

  it("AND needs every complete rule to pass", () => {
    const group = { combinator: "and", rules: [on("Region", "equals", "north"), on("Qty", "gt", "10")] };
    expect(evaluateFilterGroup(group, resolve)).toBe(true);
    group.rules.push(on("Status", "equals", "Pending"));
    expect(evaluateFilterGroup(group, resolve)).toBe(false);
  });

  it("OR needs one complete rule to pass", () => {
    const group = { combinator: "or", rules: [on("Region", "equals", "South"), on("Qty", "lt", "20")] };
    expect(evaluateFilterGroup(group, resolve)).toBe(true);
    expect(evaluateFilterGroup({ combinator: "or", rules: [on("Region", "equals", "South")] }, resolve)).toBe(false);
  });

  it("ignores incomplete rules, and a group without complete rules matches everything", () => {
    const incomplete = [on("Region", "equals", ""), on("", "equals", "x")];
    expect(evaluateFilterGroup({ combinator: "and", rules: incomplete }, resolve)).toBe(true);
    expect(evaluateFilterGroup({ combinator: "or", rules: incomplete }, resolve)).toBe(true);
    expect(evaluateFilterGroup({ combinator: "or", rules: [...incomplete, on("Region", "equals", "South")] }, resolve)).toBe(
      false,
    );
    expect(evaluateFilterGroup({ combinator: "and", rules: [] }, resolve)).toBe(true);
    expect(evaluateFilterGroup(null, resolve)).toBe(true);
  });

  it("passes each rule's target to resolve and stops early", () => {
    const spy = vi.fn(resolve);
    const group = { combinator: "and", rules: [on("Region", "equals", "South"), on("Qty", "gt", "1")] };
    expect(evaluateFilterGroup(group, spy)).toBe(false);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith({ kind: "column", ref: "Region" });
  });
});

describe("compileFilterGroup", () => {
  const rows = [
    ["North", 5],
    ["South", 15],
    ["north", 25],
  ];
  const getter = (target) => {
    const index = target.ref === "Region" ? 0 : 1;
    return (row) => row[index];
  };
  const on = (ref, operator, value) => rule(operator, value, "", { kind: "column", ref });

  it("returns null when nothing filters", () => {
    expect(compileFilterGroup({ combinator: "and", rules: [] }, getter)).toBeNull();
    expect(compileFilterGroup({ combinator: "and", rules: [on("Region", "equals", "")] }, getter)).toBeNull();
    expect(compileFilterGroup(undefined, getter)).toBeNull();
  });

  it("compiles AND and OR groups", () => {
    const and = compileFilterGroup({ combinator: "and", rules: [on("Region", "equals", "NORTH"), on("Qty", "gt", "10")] }, getter);
    expect(rows.filter((row) => and(row))).toEqual([["north", 25]]);
    const or = compileFilterGroup({ combinator: "or", rules: [on("Region", "equals", "south"), on("Qty", "lt", "10")] }, getter);
    expect(rows.filter((row) => or(row))).toEqual([
      ["North", 5],
      ["South", 15],
    ]);
    const single = compileFilterGroup({ combinator: "or", rules: [on("Qty", "between", "")] }, getter);
    expect(single).toBeNull();
  });
});
