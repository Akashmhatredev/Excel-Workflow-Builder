/**
 * lib/conditional.js: conditional formats (output.conditionalFormats) evaluated on result rows.
 *
 * One evaluation serves the preview (`highlightCells`, the `highlights` of runPreview) and the
 * xlsx writer (lib/xlsxStyle.js turns the same rules into Excel conditional formatting), so the
 * app shows what Excel will show.
 *
 * Semantics (the same as row filters, see lib/filters.js):
 *   - a rule compares the cell's typed value with the text the user typed: numeric when that text
 *     is a number, chronological when it is a date (whole days when it has no time), otherwise
 *     case-insensitive text; "contains" is a literal, case-insensitive substring test
 *   - empty cells only match "is empty" and "does not equal"
 *   - rules are tried in list order and the first rule that matches a cell wins
 *     (Excel gets the same behaviour through "stop if true")
 * Rules with an unknown operator, a column that is not in the result, or a missing value are ignored.
 */

import { compileRule, hasOperands } from "./filters.js";
import { CONDITIONAL_OPERATORS, HIGHLIGHT_STYLES } from "./schema.js";

const OPERATORS = new Set(CONDITIONAL_OPERATORS);

/**
 * The rules that apply to these result columns, in list order.
 * @param {object[]} rules      ConditionalFormat[]
 * @param {{ key: string }[]} columns  result columns
 * @returns {{ rule: object, column: number, style: string, bold: boolean, test: (value: any) => boolean }[]}
 */
export function resolveConditionalFormats(rules, columns) {
  const list = Array.isArray(rules) ? rules : [];
  const keys = new Map(((columns || []).map((column, index) => [column && column.key, index])));
  const out = [];
  for (const rule of list) {
    if (!rule || typeof rule !== "object" || !OPERATORS.has(rule.operator) || !rule.columnKey) continue;
    const column = keys.get(rule.columnKey);
    if (column === undefined) continue;
    const operands = { operator: rule.operator, value: rule.value ?? "", value2: rule.value2 ?? "" };
    if (!hasOperands(operands)) continue;
    out.push({
      rule: { ...rule, ...operands },
      column,
      style: HIGHLIGHT_STYLES[rule.style] ? rule.style : "red",
      bold: Boolean(rule.bold),
      test: compileRule(operands),
    });
  }
  return out;
}

/**
 * Highlights for the first `limit` result rows: [rowIndex, columnIndex, style, bold], one per cell
 * at most (the first matching rule), ordered by row then column.
 * @param {{ columns: { key: string }[], rows: any[][] }} result  a runPipeline result (typed values)
 * @param {object[]} rules  the output's conditionalFormats
 * @returns {[number, number, string, boolean][]}
 */
export function highlightCells(result, rules, limit) {
  const plan = resolveConditionalFormats(rules, result && result.columns);
  if (!plan.length) return [];
  const rows = (result && result.rows) || [];
  const wanted = typeof limit === "number" && limit >= 0 ? Math.floor(limit) : rows.length;
  const count = Math.min(rows.length, wanted);
  const byColumn = new Map();
  for (const entry of plan) {
    if (!byColumn.has(entry.column)) byColumn.set(entry.column, []);
    byColumn.get(entry.column).push(entry);
  }
  const columns = [...byColumn.keys()].sort((a, b) => a - b);
  const out = [];
  for (let r = 0; r < count; r += 1) {
    const row = rows[r];
    for (const column of columns) {
      const value = row[column];
      for (const entry of byColumn.get(column)) {
        if (entry.test(value)) {
          out.push([r, column, entry.style, entry.bold]);
          break;
        }
      }
    }
  }
  return out;
}
