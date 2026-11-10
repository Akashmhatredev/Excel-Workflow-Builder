/**
 * lib/formula.js (owner: Agent A): a small, safe expression language.
 *
 * Templates are imported from untrusted JSON, so nothing here ever uses eval or
 * new Function. An expression is tokenised, parsed into a tree and turned into
 * plain closures once; evaluating a row only walks those closures.
 *
 * Grammar (lowest to highest precedence):
 *   comparison   = != <> < <= > >=
 *   concat       &
 *   additive     + -
 *   multiply     * / %          (% between two values is "remainder")
 *   unary        - +
 *   percent      10%            (a % that is not followed by a value divides by 100)
 *   primary      12.5  "text"  'text'  {Column Name}  TRUE  FALSE  NAME(args)  ( ... )
 *
 * Functions: ROUND ABS MIN MAX SUM IF CONCAT LEN UPPER LOWER TRIM FLOOR CEIL COALESCE
 * (plus AND OR NOT). Names are case-insensitive.
 *
 * Maths: empty cells count as 0 and numeric text ("1,200") is read as a number.
 * Text that is not a number, or a division by zero, makes the whole result empty
 * (null); COALESCE can supply a fallback. Date - Date is a number of days and
 * Date +/- number moves the date by days.
 */

import { compareValues } from "./filters.js";
import { cleanNumber, roundNumber, toNumber, toText, trimText } from "./transforms.js";

const MAX_LENGTH = 4000;
const MAX_DEPTH = 60;
const DAY_MS = 86400000;

/** Returned by a bound formula when a row cannot be computed (bad maths). */
export const FORMULA_ERROR = Symbol("formula-error");
const ERR = FORMULA_ERROR;

class FormulaSyntaxError extends Error {}

const fail = (message) => {
  throw new FormulaSyntaxError(message);
};

/* ------------------------------------------------------------------ */
/* tokenizer                                                            */
/* ------------------------------------------------------------------ */

const isDigit = (code) => code >= 48 && code <= 57;
const isLetter = (code) => (code >= 65 && code <= 90) || (code >= 97 && code <= 122) || code === 95;
const isSpace = (code) => code === 32 || code === 9 || code === 10 || code === 13 || code === 160;

function tokenize(source) {
  const tokens = [];
  const length = source.length;
  let i = 0;
  while (i < length) {
    const code = source.charCodeAt(i);
    if (isSpace(code)) {
      i += 1;
      continue;
    }
    const ch = source[i];
    if (isDigit(code) || (ch === "." && isDigit(source.charCodeAt(i + 1)))) {
      let j = i;
      while (isDigit(source.charCodeAt(j))) j += 1;
      if (source[j] === ".") {
        j += 1;
        while (isDigit(source.charCodeAt(j))) j += 1;
      }
      if (source[j] === "e" || source[j] === "E") {
        let k = j + 1;
        if (source[k] === "+" || source[k] === "-") k += 1;
        if (isDigit(source.charCodeAt(k))) {
          while (isDigit(source.charCodeAt(k))) k += 1;
          j = k;
        }
      }
      tokens.push({ type: "num", value: Number(source.slice(i, j)) });
      i = j;
      continue;
    }
    if (ch === '"' || ch === "'") {
      let j = i + 1;
      let text = "";
      for (;;) {
        if (j >= length) fail("A piece of text is missing its closing quote.");
        if (source[j] === ch) {
          if (source[j + 1] === ch) {
            text += ch;
            j += 2;
            continue;
          }
          break;
        }
        text += source[j];
        j += 1;
      }
      tokens.push({ type: "str", value: text });
      i = j + 1;
      continue;
    }
    if (ch === "{") {
      const end = source.indexOf("}", i + 1);
      if (end === -1) fail("A column name is missing its closing }.");
      const name = source.slice(i + 1, end).trim();
      if (!name || name.includes("{")) fail("Put one column name inside each pair of { }.");
      tokens.push({ type: "ref", value: name });
      i = end + 1;
      continue;
    }
    if (isLetter(code)) {
      let j = i + 1;
      while (isLetter(source.charCodeAt(j)) || isDigit(source.charCodeAt(j))) j += 1;
      tokens.push({ type: "name", value: source.slice(i, j) });
      i = j;
      continue;
    }
    const two = source.slice(i, i + 2);
    if (two === "<=" || two === ">=" || two === "<>" || two === "!=" || two === "==") {
      tokens.push({ type: "op", value: two === "==" ? "=" : two === "<>" ? "!=" : two });
      i += 2;
      continue;
    }
    if ("+-*/%&=<>".includes(ch)) {
      tokens.push({ type: "op", value: ch });
      i += 1;
      continue;
    }
    if (ch === "(" || ch === ")" || ch === ",") {
      tokens.push({ type: ch });
      i += 1;
      continue;
    }
    if (ch === "}") fail("Found a } without a matching {.");
    fail(`"${ch}" is not allowed in a formula.`);
  }
  tokens.push({ type: "end" });
  return tokens;
}

/* ------------------------------------------------------------------ */
/* parser                                                               */
/* ------------------------------------------------------------------ */

const COMPARISONS = new Set(["=", "!=", "<", "<=", ">", ">="]);

const describe = (token) => {
  if (token.type === "end") return "the end of the formula";
  if (token.type === "num") return String(token.value);
  if (token.type === "str") return `"${token.value}"`;
  if (token.type === "ref") return `{${token.value}}`;
  if (token.type === "name" || token.type === "op") return `"${token.value}"`;
  return `"${token.type}"`;
};

const startsValue = (token) =>
  token.type === "num" || token.type === "str" || token.type === "ref" || token.type === "name" || token.type === "(";

function parse(tokens) {
  let position = 0;
  let depth = 0;
  const peek = () => tokens[position];
  const next = () => tokens[position++];
  const isOp = (value) => peek().type === "op" && peek().value === value;

  function enter() {
    depth += 1;
    if (depth > MAX_DEPTH) fail("This formula is nested too deeply.");
  }

  function comparison() {
    let left = concat();
    while (peek().type === "op" && COMPARISONS.has(peek().value)) {
      const op = next().value;
      left = { type: "compare", op, left, right: concat() };
    }
    return left;
  }

  function concat() {
    let left = additive();
    while (isOp("&")) {
      next();
      left = { type: "binary", op: "&", left, right: additive() };
    }
    return left;
  }

  function additive() {
    let left = multiplicative();
    while (isOp("+") || isOp("-")) {
      const op = next().value;
      left = { type: "binary", op, left, right: multiplicative() };
    }
    return left;
  }

  function multiplicative() {
    let left = unary();
    while (isOp("*") || isOp("/") || isOp("%")) {
      const op = next().value;
      left = { type: "binary", op, left, right: unary() };
    }
    return left;
  }

  function unary() {
    if (isOp("-") || isOp("+")) {
      const op = next().value;
      enter();
      const operand = unary();
      depth -= 1;
      return op === "-" ? { type: "negate", operand } : { type: "plus", operand };
    }
    return postfix();
  }

  function postfix() {
    let node = primary();
    // "10%" is a percentage; "{A} % 3" is a remainder.
    while (isOp("%") && !startsValue(tokens[position + 1])) {
      next();
      node = { type: "percent", operand: node };
    }
    return node;
  }

  function primary() {
    const token = next();
    switch (token.type) {
      case "num":
        return { type: "literal", value: token.value };
      case "str":
        return { type: "literal", value: token.value };
      case "ref":
        return { type: "ref", name: token.value };
      case "(": {
        enter();
        const inner = comparison();
        depth -= 1;
        if (peek().type !== ")") fail("A closing bracket ) is missing.");
        next();
        return inner;
      }
      case "name": {
        const upper = token.value.toUpperCase();
        if (peek().type !== "(") {
          if (upper === "TRUE") return { type: "literal", value: true };
          if (upper === "FALSE") return { type: "literal", value: false };
          fail(`"${token.value}" is not known. Put text in "quotes" and column names in {braces}.`);
        }
        const spec = Object.prototype.hasOwnProperty.call(FUNCTIONS, upper) ? FUNCTIONS[upper] : null;
        if (!spec) fail(`${upper} is not a function this app knows.`);
        next();
        enter();
        const args = [];
        if (peek().type !== ")") {
          for (;;) {
            args.push(comparison());
            if (peek().type === ",") {
              next();
              continue;
            }
            break;
          }
        }
        depth -= 1;
        if (peek().type !== ")") fail(`${upper}( is missing its closing bracket ).`);
        next();
        if (args.length < spec.min || args.length > spec.max) fail(`${upper} needs ${arityText(spec)}.`);
        return { type: "call", name: upper, args };
      }
      case "end":
        fail(position > 1 ? "The formula ends too early." : "The formula is empty.");
        break;
      default:
        fail(`${describe(token)} is not expected here.`);
    }
    return null;
  }

  const tree = comparison();
  if (peek().type !== "end") fail(`${describe(peek())} is not expected here.`);
  return tree;
}

function arityText(spec) {
  const values = (n) => `${n} value${n === 1 ? "" : "s"}`;
  if (spec.max === Infinity) return `at least ${values(spec.min)}`;
  if (spec.min === spec.max) return values(spec.min);
  return `${spec.min} to ${values(spec.max)}`;
}

/* ------------------------------------------------------------------ */
/* evaluation helpers                                                   */
/* ------------------------------------------------------------------ */

/** Number for maths: empty -> 0, numeric text -> number, other text -> ERR. */
function numeric(value) {
  if (typeof value === "number") return Number.isNaN(value) ? ERR : value;
  if (value === null || value === undefined) return 0;
  if (typeof value === "string") {
    const n = toNumber(value);
    if (n !== null) return n;
    return value.trim() === "" ? 0 : ERR;
  }
  if (typeof value === "boolean") return value ? 1 : 0;
  return ERR;
}

function truthy(value) {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0 && !Number.isNaN(value);
  if (value === null || value === undefined) return false;
  if (typeof value === "string") {
    const s = value.trim().toLowerCase();
    return s !== "" && s !== "false" && s !== "0";
  }
  return true;
}

const finite = (n) => (Number.isFinite(n) ? n : ERR);

function add(a, b) {
  if (a === ERR || b === ERR) return ERR;
  const dateA = a instanceof Date;
  const dateB = b instanceof Date;
  if (dateA || dateB) {
    if (dateA && dateB) return ERR;
    const days = numeric(dateA ? b : a);
    if (days === ERR) return ERR;
    return new Date((dateA ? a : b).getTime() + Math.round(days * DAY_MS));
  }
  const x = numeric(a);
  const y = numeric(b);
  return x === ERR || y === ERR ? ERR : finite(x + y);
}

function subtract(a, b) {
  if (a === ERR || b === ERR) return ERR;
  if (a instanceof Date) {
    if (b instanceof Date) return cleanNumber((a.getTime() - b.getTime()) / DAY_MS);
    const days = numeric(b);
    return days === ERR ? ERR : new Date(a.getTime() - Math.round(days * DAY_MS));
  }
  if (b instanceof Date) return ERR;
  const x = numeric(a);
  const y = numeric(b);
  return x === ERR || y === ERR ? ERR : finite(x - y);
}

function arithmetic(op) {
  return (a, b) => {
    if (a === ERR || b === ERR) return ERR;
    const x = numeric(a);
    const y = numeric(b);
    if (x === ERR || y === ERR) return ERR;
    if (op === "*") return finite(x * y);
    if (y === 0) return ERR;
    if (op === "/") return finite(x / y);
    return finite(x - y * Math.floor(x / y));
  };
}

const BINARY = {
  "+": add,
  "-": subtract,
  "*": arithmetic("*"),
  "/": arithmetic("/"),
  "%": arithmetic("%"),
  "&": (a, b) => (a === ERR || b === ERR ? ERR : toText(a) + toText(b)),
};

const COMPARE = {
  "=": (c) => c === 0,
  "!=": (c) => c !== 0,
  "<": (c) => c < 0,
  "<=": (c) => c <= 0,
  ">": (c) => c > 0,
  ">=": (c) => c >= 0,
};

/** Numbers among the arguments (numeric text counts, other text and empties are skipped). */
function numbersOf(values) {
  const out = [];
  for (let i = 0; i < values.length; i += 1) {
    const value = values[i];
    if (value === ERR) return ERR;
    const n = typeof value === "number" ? value : toNumber(value);
    if (n !== null && !Number.isNaN(n)) out.push(n);
  }
  return out;
}

const hasError = (values) => values.includes(ERR);

function numericFn(fn) {
  return (values) => {
    const x = numeric(values[0]);
    if (x === ERR) return ERR;
    let y;
    if (values.length > 1) {
      y = numeric(values[1]);
      if (y === ERR) return ERR;
    }
    return fn(x, y);
  };
}

function textFn(fn) {
  return (values) => (values[0] === ERR ? ERR : fn(toText(values[0])));
}

function toMultiple(rounder) {
  return (x, step = 1) => {
    if (step === 0) return ERR;
    return finite(cleanNumber(rounder(Number((x / step).toPrecision(15))) * step));
  };
}

/** `fn(values)` receives evaluated arguments; `lazy(args)` receives the argument closures. */
const FUNCTIONS = {
  ROUND: { min: 1, max: 2, fn: numericFn((x, digits = 0) => roundNumber(x, digits)) },
  ABS: { min: 1, max: 1, fn: numericFn((x) => Math.abs(x)) },
  FLOOR: { min: 1, max: 2, fn: numericFn(toMultiple(Math.floor)) },
  CEIL: { min: 1, max: 2, fn: numericFn(toMultiple(Math.ceil)) },
  MIN: {
    min: 1,
    max: Infinity,
    fn: (values) => {
      const numbers = numbersOf(values);
      if (numbers === ERR) return ERR;
      return numbers.length ? Math.min(...numbers) : null;
    },
  },
  MAX: {
    min: 1,
    max: Infinity,
    fn: (values) => {
      const numbers = numbersOf(values);
      if (numbers === ERR) return ERR;
      return numbers.length ? Math.max(...numbers) : null;
    },
  },
  SUM: {
    min: 1,
    max: Infinity,
    fn: (values) => {
      const numbers = numbersOf(values);
      if (numbers === ERR) return ERR;
      let total = 0;
      for (let i = 0; i < numbers.length; i += 1) total += numbers[i];
      return finite(total);
    },
  },
  CONCAT: {
    min: 1,
    max: Infinity,
    fn: (values) => {
      if (hasError(values)) return ERR;
      let out = "";
      for (let i = 0; i < values.length; i += 1) out += toText(values[i]);
      return out;
    },
  },
  LEN: { min: 1, max: 1, fn: textFn((text) => text.length) },
  UPPER: { min: 1, max: 1, fn: textFn((text) => text.toUpperCase()) },
  LOWER: { min: 1, max: 1, fn: textFn((text) => text.toLowerCase()) },
  TRIM: { min: 1, max: 1, fn: textFn(trimText) },
  NOT: { min: 1, max: 1, fn: (values) => (values[0] === ERR ? ERR : !truthy(values[0])) },
  IF: {
    min: 2,
    max: 3,
    lazy: (args) => (context) => {
      const condition = args[0](context);
      if (condition === ERR) return ERR;
      if (truthy(condition)) return args[1](context);
      return args.length > 2 ? args[2](context) : null;
    },
  },
  COALESCE: {
    min: 1,
    max: Infinity,
    lazy: (args) => (context) => {
      for (let i = 0; i < args.length; i += 1) {
        const value = args[i](context);
        if (value === ERR || value === null || value === undefined) continue;
        if (typeof value === "string" && value.trim() === "") continue;
        if (typeof value === "number" && Number.isNaN(value)) continue;
        return value;
      }
      return null;
    },
  },
  AND: {
    min: 1,
    max: Infinity,
    lazy: (args) => (context) => {
      for (let i = 0; i < args.length; i += 1) {
        const value = args[i](context);
        if (value === ERR) return ERR;
        if (!truthy(value)) return false;
      }
      return true;
    },
  },
  OR: {
    min: 1,
    max: Infinity,
    lazy: (args) => (context) => {
      for (let i = 0; i < args.length; i += 1) {
        const value = args[i](context);
        if (value === ERR) return ERR;
        if (truthy(value)) return true;
      }
      return false;
    },
  },
};

/** The function names a formula may call. */
export const FORMULA_FUNCTIONS = Object.keys(FUNCTIONS);

/* ------------------------------------------------------------------ */
/* tree -> closures                                                     */
/* ------------------------------------------------------------------ */

/** `makeRef(name)` returns `(context) => value` for a column reference. */
function build(node, makeRef) {
  switch (node.type) {
    case "literal": {
      const value = node.value;
      return () => value;
    }
    case "ref":
      return makeRef(node.name);
    case "negate": {
      const operand = build(node.operand, makeRef);
      return (context) => {
        const value = operand(context);
        if (value === ERR) return ERR;
        const n = numeric(value);
        return n === ERR ? ERR : n === 0 ? 0 : -n;
      };
    }
    case "plus": {
      const operand = build(node.operand, makeRef);
      return (context) => {
        const value = operand(context);
        return value === ERR ? ERR : numeric(value);
      };
    }
    case "percent": {
      const operand = build(node.operand, makeRef);
      return (context) => {
        const value = operand(context);
        if (value === ERR) return ERR;
        const n = numeric(value);
        return n === ERR ? ERR : cleanNumber(n / 100);
      };
    }
    case "binary": {
      const left = build(node.left, makeRef);
      const right = build(node.right, makeRef);
      const apply = BINARY[node.op];
      return (context) => apply(left(context), right(context));
    }
    case "compare": {
      const left = build(node.left, makeRef);
      const right = build(node.right, makeRef);
      const test = COMPARE[node.op];
      return (context) => {
        const a = left(context);
        const b = right(context);
        if (a === ERR || b === ERR) return ERR;
        return test(compareValues(a, b));
      };
    }
    case "call": {
      const spec = FUNCTIONS[node.name];
      const args = node.args.map((arg) => build(arg, makeRef));
      if (spec.lazy) return spec.lazy(args);
      const fn = spec.fn;
      const count = args.length;
      if (count === 1) {
        const only = args[0];
        return (context) => fn([only(context)]);
      }
      return (context) => {
        const values = new Array(count);
        for (let i = 0; i < count; i += 1) values[i] = args[i](context);
        return fn(values);
      };
    }
    default:
      return () => null;
  }
}

function collectRefs(node, out, seen) {
  if (!node) return;
  if (node.type === "ref") {
    if (!seen.has(node.name)) {
      seen.add(node.name);
      out.push(node.name);
    }
    return;
  }
  if (node.operand) collectRefs(node.operand, out, seen);
  if (node.left) collectRefs(node.left, out, seen);
  if (node.right) collectRefs(node.right, out, seen);
  if (node.args) for (const arg of node.args) collectRefs(arg, out, seen);
}

function finish(value) {
  if (value === ERR || value === undefined) return value === ERR ? ERR : null;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return ERR;
    return Number.isInteger(value) ? value : cleanNumber(value);
  }
  return value;
}

const REF_PATTERN = /\{([^{}]+)\}/g;

function looseRefs(text) {
  const out = [];
  const seen = new Set();
  for (const match of text.matchAll(REF_PATTERN)) {
    const name = match[1].trim();
    if (name && !seen.has(name)) {
      seen.add(name);
      out.push(name);
    }
  }
  return out;
}

const formulaCache = new Map();

/**
 * Compile an expression once.
 *
 * @returns {{
 *   ok: boolean,
 *   error: string | null,                       // user-facing message when ok is false
 *   refs: string[],                             // column names the formula reads
 *   evaluate: (getValue: (column: string) => any) => any,     // null when the row cannot be computed
 *   bind: (resolve: (column: string) => ((row: any) => any)) => ((row: any) => any),
 * }}
 * `bind` pre-resolves every column to an accessor and returns a per-row function
 * that yields FORMULA_ERROR (instead of null) for rows that cannot be computed.
 */
export function compileFormula(expression) {
  const source = typeof expression === "string" ? expression : String(expression ?? "");
  const cached = formulaCache.get(source);
  if (cached) return cached;
  let result;
  try {
    if (source.trim() === "") fail("The formula is empty.");
    if (source.length > MAX_LENGTH) fail("This formula is too long.");
    const tree = parse(tokenize(source));
    const refs = [];
    collectRefs(tree, refs, new Set());
    const generic = build(tree, (name) => (getValue) => getValue(name));
    result = {
      ok: true,
      error: null,
      refs,
      evaluate: (getValue) => {
        const value = finish(generic(getValue));
        return value === ERR ? null : value;
      },
      bind: (resolve) => {
        const bound = build(tree, (name) => {
          const accessor = resolve(name);
          return typeof accessor === "function" ? accessor : () => null;
        });
        return (row) => finish(bound(row));
      },
    };
  } catch (error) {
    if (!(error instanceof FormulaSyntaxError) && !(error instanceof RangeError)) throw error;
    const message = error instanceof FormulaSyntaxError ? error.message : "This formula is nested too deeply.";
    result = {
      ok: false,
      error: message,
      refs: looseRefs(source),
      evaluate: () => null,
      bind: () => () => null,
    };
  }
  if (formulaCache.size > 300) formulaCache.clear();
  formulaCache.set(source, result);
  return result;
}

/**
 * Compile a combine template such as "{First} {Last}".
 * Values are rendered as display text. When a referenced value is empty, doubled
 * spaces are collapsed and the ends trimmed ("{First} {Last}" -> "Asha").
 *
 * @returns {{ refs: string[], render: (getValue) => string, bind: (resolve) => ((row) => string) }}
 */
export function compileTemplate(template) {
  const source = typeof template === "string" ? template : String(template ?? "");
  const literals = [];
  const names = [];
  let last = 0;
  for (const match of source.matchAll(REF_PATTERN)) {
    const name = match[1].trim();
    if (!name) continue;
    literals.push(source.slice(last, match.index));
    names.push(name);
    last = match.index + match[0].length;
  }
  const tail = source.slice(last);
  const refs = [...new Set(names)];
  const count = names.length;

  const tidy = (text) => text.replace(/[ \t]{2,}/g, " ").trim();
  const isBlankText = (text) => text === "" || text.trim() === "";

  return {
    refs,
    render: (getValue) => {
      let out = "";
      let sawEmpty = false;
      for (let i = 0; i < count; i += 1) {
        const text = toText(getValue(names[i]));
        if (isBlankText(text)) sawEmpty = true;
        out += literals[i] + text;
      }
      out += tail;
      return sawEmpty ? tidy(out) : out;
    },
    bind: (resolve) => {
      const accessors = names.map((name) => {
        const accessor = resolve(name);
        return typeof accessor === "function" ? accessor : () => null;
      });
      if (count === 0) return () => tail;
      return (row) => {
        let out = "";
        let sawEmpty = false;
        for (let i = 0; i < count; i += 1) {
          const text = toText(accessors[i](row));
          if (isBlankText(text)) sawEmpty = true;
          out += literals[i] + text;
        }
        out += tail;
        return sawEmpty ? tidy(out) : out;
      };
    },
  };
}
