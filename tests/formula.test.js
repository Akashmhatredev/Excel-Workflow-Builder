import { describe, expect, it } from "vitest";
import { FORMULA_ERROR, FORMULA_FUNCTIONS, compileFormula, compileTemplate } from "@/lib/formula";
import { toText } from "@/lib/transforms";

const day = (y, m, d) => new Date(Date.UTC(y, m - 1, d));

function run(expression, values = {}) {
  const compiled = compileFormula(expression);
  if (!compiled.ok) throw new Error(`did not compile: ${compiled.error}`);
  return compiled.evaluate((name) => values[name]);
}

const errorOf = (expression) => compileFormula(expression).error;

describe("compileFormula: arithmetic", () => {
  it.each([
    ["1 + 2 * 3", 7],
    ["(1 + 2) * 3", 9],
    ["10 - 4 - 3", 3],
    ["2 * 3 / 4", 1.5],
    ["-2 * 3", -6],
    ["2 - -3", 5],
    ["-(2 + 3)", -5],
    ["+4", 4],
    ["7 % 3", 1],
    ["-7 % 3", 2],
    ["10% * 200", 20],
    ["50%", 0.5],
    ["0.1 + 0.2", 0.3],
    [".5 * 4", 2],
    ["1e3 + 1", 1001],
    ["2 * (3 + (4 - 1)) / 3", 4],
  ])("%s = %j", (expression, expected) => {
    expect(run(expression)).toBe(expected);
  });

  it("reads column values, numeric text and empties", () => {
    expect(run("{Qty} * {Price}", { Qty: 3, Price: "1,200.50" })).toBe(3601.5);
    expect(run("{Qty} * (1 - {Discount %} / 100)", { Qty: 200, "Discount %": null })).toBe(200);
    expect(run("{ Qty } + 1", { Qty: 1 })).toBe(2);
    expect(run("{Missing} + 1")).toBe(1);
  });

  it("returns null for bad maths instead of throwing", () => {
    expect(run('"x" * 2')).toBeNull();
    expect(run("{A} * 2", { A: "abc" })).toBeNull();
    expect(run("1 / 0")).toBeNull();
    expect(run("5 % 0")).toBeNull();
    expect(run("-{A}", { A: "abc" })).toBeNull();
    expect(run("ROUND({A} / 0, 2) + 1", { A: 4 })).toBeNull();
  });

  it("does date maths in days", () => {
    expect(toText(run("{D} + 7", { D: day(2024, 1, 5) }))).toBe("2024-01-12");
    expect(toText(run("{D} - 5", { D: day(2024, 1, 5) }))).toBe("2023-12-31");
    expect(run("{B} - {A}", { A: day(2024, 1, 5), B: day(2024, 3, 1) })).toBe(56);
    expect(run("{A} + {B}", { A: day(2024, 1, 5), B: day(2024, 3, 1) })).toBeNull();
  });
});

describe("compileFormula: text and logic", () => {
  it("joins with &", () => {
    expect(run('"a" & "b" & 1')).toBe("ab1");
    expect(run('{First} & " " & {Last}', { First: "Asha", Last: "Rao" })).toBe("Asha Rao");
    expect(run('"Total: " & 0.1 + 0.2')).toBe("Total: 0.3");
    expect(run("'single' & 'quotes'")).toBe("singlequotes");
    expect(run('"say ""hi"""')).toBe('say "hi"');
  });

  it.each([
    ["1 = 1", true],
    ["1 == 1", true],
    ['"abc" = "ABC"', true],
    ["2 != 3", true],
    ["2 <> 2", false],
    ["2 < 10", true],
    ['"2" < "10"', true],
    ["3 <= 3", true],
    ["4 > 5", false],
    ["5 >= 5", true],
    ["1 + 1 = 2", true],
    ["TRUE", true],
    ["false", false],
  ])("%s is %j", (expression, expected) => {
    expect(run(expression)).toBe(expected);
  });

  it("compares empties with empty text and dates with dates", () => {
    expect(run('{A} = ""', { A: null })).toBe(true);
    expect(run("{A} > {B}", { A: day(2024, 2, 1), B: "05/01/2024" })).toBe(true);
  });
});

describe("compileFormula: functions", () => {
  it.each([
    ["ROUND(2.675, 2)", 2.68],
    ["ROUND(-2.5)", -3],
    ["ROUND(1234, -2)", 1200],
    ["ABS(-4)", 4],
    ["FLOOR(2.7)", 2],
    ["FLOOR(17, 5)", 15],
    ["CEIL(1.2)", 2],
    ["CEIL(17, 5)", 20],
    ["MIN(3, 1, 2)", 1],
    ["MAX(3, '10', 2)", 10],
    ['SUM(1, "2", "x", 3)', 6],
    ['CONCAT("a", 1, "b")', "a1b"],
    ['LEN("hello")', 5],
    ['UPPER("abc")', "ABC"],
    ['LOWER("ABC")', "abc"],
    ['TRIM("  a   b ")', "a b"],
    ['IF(2 > 1, "yes", "no")', "yes"],
    ['IF(0, "yes", "no")', "no"],
    ['IF("", "yes")', null],
    ['COALESCE("", "  ", "fallback")', "fallback"],
    ["COALESCE(1 / 0, 0)", 0],
    ["AND(1, TRUE, 1 < 2)", true],
    ["OR(0, FALSE)", false],
    ["NOT(0)", true],
    ["round(1.26, 1)", 1.3],
  ])("%s = %j", (expression, expected) => {
    expect(run(expression)).toBe(expected);
  });

  it("works on column values", () => {
    expect(run("MIN({A}, {B})", { A: null, B: 4 })).toBe(4);
    expect(run("MAX({A}, {B})", { A: null, B: null })).toBeNull();
    expect(run("SUM({A}, {B})", { A: null, B: null })).toBe(0);
    expect(run("LEN({A})", { A: 12345 })).toBe(5);
    expect(run('IF({Status} = "paid", {Amount}, 0)', { Status: "PAID", Amount: 50 })).toBe(50);
  });

  it("only evaluates the IF branch it needs", () => {
    expect(run("IF(TRUE, 1, 1 / 0)")).toBe(1);
    expect(run("IF(FALSE, 1 / 0, 2)")).toBe(2);
    expect(run("IF(1 / 0, 1, 2)")).toBeNull();
  });

  it("exposes the function list", () => {
    for (const name of ["ROUND", "ABS", "MIN", "MAX", "SUM", "IF", "CONCAT", "LEN", "UPPER", "LOWER", "TRIM", "FLOOR", "CEIL", "COALESCE"]) {
      expect(FORMULA_FUNCTIONS).toContain(name);
    }
  });
});

describe("compileFormula: errors", () => {
  it.each([
    ["", "The formula is empty."],
    ["   ", "The formula is empty."],
    ["1 +", "The formula ends too early."],
    ["(1 + 2", "A closing bracket ) is missing."],
    ["1 + 2)", '")" is not expected here.'],
    ['"abc', "A piece of text is missing its closing quote."],
    ["{Qty", "A column name is missing its closing }."],
    ["{} + 1", "Put one column name inside each pair of { }."],
    ["Qty} * 2", "Found a } without a matching {."],
    ["Qty * 2", '"Qty" is not known. Put text in "quotes" and column names in {braces}.'],
    ["1 $ 2", '"$" is not allowed in a formula.'],
    ["FOO(1)", "FOO is not a function this app knows."],
    ["ROUND()", "ROUND needs 1 to 2 values."],
    ["ABS(1, 2)", "ABS needs 1 value."],
    ["IF(1)", "IF needs 2 to 3 values."],
    ["SUM()", "SUM needs at least 1 value."],
    ["ROUND(1, 2", "ROUND( is missing its closing bracket )."],
    ["1 2", '2 is not expected here.'],
  ])("%j -> %s", (expression, message) => {
    const compiled = compileFormula(expression);
    expect(compiled.ok).toBe(false);
    expect(compiled.error).toBe(message);
    expect(compiled.evaluate(() => 1)).toBeNull();
  });

  it("cannot reach JavaScript: names and properties are not code", () => {
    for (const expression of ["constructor", "__proto__", "process.exit(1)", "this", "globalThis", "eval(1)", "Function(1)"]) {
      expect(compileFormula(expression).ok).toBe(false);
    }
    expect(errorOf("CONSTRUCTOR(1)")).toBe("CONSTRUCTOR is not a function this app knows.");
    expect(errorOf("toString(1)")).toBe("TOSTRING is not a function this app knows.");
    expect(errorOf("__proto__(1)")).toBe("__PROTO__ is not a function this app knows.");
    // a column may be called "constructor": it is only ever read through getValue
    expect(run('{constructor} & "!"', Object.create(null))).toBe("!");
  });

  it("rejects absurdly nested or long input without crashing", () => {
    expect(errorOf(`${"(".repeat(200)}1${")".repeat(200)}`)).toBe("This formula is nested too deeply.");
    expect(errorOf("-".repeat(500) + "1")).toBe("This formula is nested too deeply.");
    expect(errorOf("1+".repeat(3000) + "1")).toBe("This formula is too long.");
  });

  it("still reports the columns a broken formula mentions", () => {
    expect(compileFormula("{Qty} * {Price} +").refs).toEqual(["Qty", "Price"]);
  });
});

describe("compileFormula: refs and binding", () => {
  it("lists referenced columns once, in order", () => {
    expect(compileFormula("{B} + {A} * {B}").refs).toEqual(["B", "A"]);
    expect(compileFormula("1 + 2").refs).toEqual([]);
  });

  it("binds accessors once and flags failed rows", () => {
    const compiled = compileFormula("{Qty} * {Price}");
    const indexes = { Qty: 0, Price: 1 };
    const row = compiled.bind((name) => (indexes[name] === undefined ? null : (r) => r[indexes[name]]));
    expect(row([2, 3.5])).toBe(7);
    expect(row([2, "n/a"])).toBe(FORMULA_ERROR);
    const missing = compileFormula("{Nope} + 1").bind(() => null);
    expect(missing([1])).toBe(1);
  });

  it("caches compiled formulas", () => {
    expect(compileFormula("{A} + 1")).toBe(compileFormula("{A} + 1"));
  });
});

describe("compileTemplate", () => {
  it("renders values as display text", () => {
    const template = compileTemplate("{First} {Last} ({Joined})");
    expect(template.refs).toEqual(["First", "Last", "Joined"]);
    expect(template.render((name) => ({ First: "Asha", Last: "Rao", Joined: day(2024, 1, 5) })[name])).toBe(
      "Asha Rao (2024-01-05)",
    );
    expect(compileTemplate("{Qty} x {Price}").render((name) => ({ Qty: 2, Price: 0.1 + 0.2 })[name])).toBe("2 x 0.3");
  });

  it("collapses the gap left by an empty value", () => {
    const template = compileTemplate("{First} {Middle} {Last}");
    expect(template.render((name) => ({ First: "Asha", Middle: null, Last: "Rao" })[name])).toBe("Asha Rao");
    expect(template.render(() => null)).toBe("");
  });

  it("keeps literal text and repeated references", () => {
    expect(compileTemplate("{A}-{A}").render(() => "x")).toBe("x-x");
    expect(compileTemplate("no refs").render(() => "x")).toBe("no refs");
    expect(compileTemplate("{ First }").refs).toEqual(["First"]);
    expect(compileTemplate("").render(() => "x")).toBe("");
  });

  it("binds accessors for the pipeline", () => {
    const bound = compileTemplate("{First} {Last}").bind((name) => (name === "First" ? (row) => row[0] : null));
    expect(bound(["Asha"])).toBe("Asha");
    expect(compileTemplate("static").bind(() => null)([1])).toBe("static");
  });
});
