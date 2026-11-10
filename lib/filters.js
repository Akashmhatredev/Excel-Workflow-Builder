/**
 * lib/filters.js (owner: Agent A): value comparison and row filters.
 *
 * Rules compare a cell value (raw source value or mapped field value) with the text
 * the user typed. The typed text decides the kind of comparison:
 *   - it is a number  -> numeric comparison; cells that are not numbers never match
 *   - it is a date    -> chronological comparison; a date without a time compares whole days
 *   - anything else   -> text comparison, ignoring case and surrounding spaces
 * Empty cells only match "is empty", "does not equal" and "does not contain".
 */

import { FILTER_OPERATORS } from "./schema.js";
import { isEmpty, toDate, toNumber, toText } from "./transforms.js";

const DAY_MS = 86400000;
const collator = new Intl.Collator("en", { sensitivity: "accent" });

/** Case-insensitive text order (accents still matter). */
export function compareText(a, b) {
  if (a === b) return 0;
  const order = collator.compare(a, b);
  return order < 0 ? -1 : order > 0 ? 1 : 0;
}

/**
 * Numeric when both values are numbers (or numeric text), chronological when both
 * are dates, otherwise case-insensitive text that ignores surrounding spaces.
 * @returns {-1 | 0 | 1}
 */
export function compareValues(a, b) {
  const numberA = toNumber(a);
  if (numberA !== null) {
    const numberB = toNumber(b);
    if (numberB !== null) return numberA < numberB ? -1 : numberA > numberB ? 1 : 0;
  }
  const dateA = toDate(a);
  if (dateA) {
    const dateB = toDate(b);
    if (dateB) {
      const timeA = dateA.getTime();
      const timeB = dateB.getTime();
      return timeA < timeB ? -1 : timeA > timeB ? 1 : 0;
    }
  }
  return compareText(toText(a).trim(), toText(b).trim());
}

const isBlank = (value) => value === null || value === undefined || String(value).trim() === "";

/** False for rules the engine ignores: no target, unknown operator, or a missing value. */
export function isRuleComplete(rule) {
  if (!rule || !rule.target || isBlank(rule.target.ref)) return false;
  return hasOperands(rule);
}

function hasOperands(rule) {
  const spec = rule && FILTER_OPERATORS[rule.operator];
  if (!spec) return false;
  if (spec.arity >= 1 && isBlank(rule.value)) return false;
  if (spec.arity >= 2 && isBlank(rule.value2)) return false;
  return true;
}

/**
 * Build `(cell) => -1 | 0 | 1 | NaN` for one typed operand. NaN means "not comparable"
 * (for example a text cell against a numeric operand).
 */
function operandComparator(operand) {
  const text = String(operand).trim();
  const number = toNumber(text);
  if (number !== null) {
    return (cell) => {
      const n = typeof cell === "number" ? cell : toNumber(cell);
      if (n === null || Number.isNaN(n)) return NaN;
      return n < number ? -1 : n > number ? 1 : 0;
    };
  }
  const date = toDate(text);
  if (date) {
    const time = date.getTime();
    const wholeDay = time % DAY_MS === 0;
    return (cell) => {
      const d = toDate(cell);
      if (!d) return NaN;
      let t = d.getTime();
      if (wholeDay) t -= ((t % DAY_MS) + DAY_MS) % DAY_MS;
      return t < time ? -1 : t > time ? 1 : 0;
    };
  }
  return (cell) => compareText(toText(cell).trim(), text);
}

const always = () => true;

/**
 * Compile a rule into `(value) => boolean`. Rules with an unknown operator or a
 * missing value compile to "always true" (they are ignored).
 */
export function compileRule(rule) {
  if (!hasOperands(rule)) return always;
  switch (rule.operator) {
    case "isEmpty":
      return isEmpty;
    case "notEmpty":
      return (value) => !isEmpty(value);
    case "contains": {
      const needle = String(rule.value).toLowerCase();
      return (value) => toText(value).toLowerCase().includes(needle);
    }
    case "notContains": {
      const needle = String(rule.value).toLowerCase();
      return (value) => !toText(value).toLowerCase().includes(needle);
    }
    case "startsWith": {
      const needle = String(rule.value).trimStart().toLowerCase();
      return (value) => toText(value).trimStart().toLowerCase().startsWith(needle);
    }
    case "endsWith": {
      const needle = String(rule.value).trimEnd().toLowerCase();
      return (value) => toText(value).trimEnd().toLowerCase().endsWith(needle);
    }
    case "equals": {
      const compare = operandComparator(rule.value);
      return (value) => !isEmpty(value) && compare(value) === 0;
    }
    case "notEquals": {
      const compare = operandComparator(rule.value);
      return (value) => isEmpty(value) || compare(value) !== 0;
    }
    case "gt": {
      const compare = operandComparator(rule.value);
      return (value) => !isEmpty(value) && compare(value) > 0;
    }
    case "gte": {
      const compare = operandComparator(rule.value);
      return (value) => !isEmpty(value) && compare(value) >= 0;
    }
    case "lt": {
      const compare = operandComparator(rule.value);
      return (value) => !isEmpty(value) && compare(value) < 0;
    }
    case "lte": {
      const compare = operandComparator(rule.value);
      return (value) => !isEmpty(value) && compare(value) <= 0;
    }
    case "between": {
      const swap = compareValues(rule.value, rule.value2) > 0;
      const low = operandComparator(swap ? rule.value2 : rule.value);
      const high = operandComparator(swap ? rule.value : rule.value2);
      return (value) => !isEmpty(value) && low(value) >= 0 && high(value) <= 0;
    }
    default:
      return always;
  }
}

const ruleCache = new WeakMap();

/** Does `value` pass `rule`? Incomplete rules pass everything. */
export function evaluateRule(rule, value) {
  if (rule === null || typeof rule !== "object") return true;
  let predicate = ruleCache.get(rule);
  if (!predicate) {
    predicate = compileRule(rule);
    ruleCache.set(rule, predicate);
  }
  return predicate(value);
}

/**
 * Does a row pass the group? `resolve(target)` returns the value for a rule's target.
 * Incomplete rules are ignored; a group without complete rules matches everything.
 */
export function evaluateFilterGroup(group, resolve) {
  const rules = (group && Array.isArray(group.rules) && group.rules) || [];
  const any = Boolean(group) && group.combinator === "or";
  let active = 0;
  for (let i = 0; i < rules.length; i += 1) {
    const rule = rules[i];
    if (!isRuleComplete(rule)) continue;
    active += 1;
    const pass = evaluateRule(rule, resolve(rule.target));
    if (any && pass) return true;
    if (!any && !pass) return false;
  }
  return any ? active === 0 : true;
}

/**
 * Compile a group once for a whole run.
 * `makeGetter(target)` returns `(a, b) => value`; the result is `(a, b) => boolean`,
 * or null when the group has no complete rules (everything matches).
 */
export function compileFilterGroup(group, makeGetter) {
  const rules = ((group && Array.isArray(group.rules) && group.rules) || []).filter(isRuleComplete);
  if (!rules.length) return null;
  const getters = rules.map((rule) => makeGetter(rule.target));
  const predicates = rules.map(compileRule);
  const count = rules.length;
  if (count === 1) {
    const get = getters[0];
    const test = predicates[0];
    return (a, b) => test(get(a, b));
  }
  if (group.combinator === "or") {
    return (a, b) => {
      for (let i = 0; i < count; i += 1) if (predicates[i](getters[i](a, b))) return true;
      return false;
    };
  }
  return (a, b) => {
    for (let i = 0; i < count; i += 1) if (!predicates[i](getters[i](a, b))) return false;
    return true;
  };
}
