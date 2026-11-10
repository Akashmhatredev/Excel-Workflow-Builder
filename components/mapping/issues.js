/**
 * Helpers for placing validation issues in the UI.
 * Issue = { level: 'error' | 'warning', scope, id, outputId?, code, message } (see CONTRACTS.md).
 */

export const NO_ISSUES = Object.freeze([]);

/** 'error' when any issue is an error, else 'warning' when there is one, else null. */
export function worstLevel(issues) {
  let level = null;
  for (const issue of issues || NO_ISSUES) {
    if (issue.level === "error") return "error";
    if (issue.level === "warning") level = "warning";
  }
  return level;
}

export function countIssues(issues) {
  let errors = 0;
  let warnings = 0;
  for (const issue of issues || NO_ISSUES) {
    if (issue.level === "error") errors += 1;
    else warnings += 1;
  }
  return { errors, warnings };
}

/** True when two issue lists would render the same (used to skip re-rendering rows). */
export function sameIssues(a, b) {
  if (a === b) return true;
  if (!a || !b || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i].level !== b[i].level || a[i].code !== b[i].code || a[i].message !== b[i].message) return false;
  }
  return true;
}

/**
 * Split the issues of one scope between the items they belong to and the rest.
 * @param {object[]} issues
 * @param {string} scope       'filter' | 'sort' | 'groupBy'
 * @param {string[]} itemIds   ids of the rules / aggregations that are on screen
 * @returns {{ byId: Map<string, object[]>, rest: object[] }}
 */
export function splitIssues(issues, scope, itemIds) {
  const known = new Set(itemIds);
  const byId = new Map();
  const rest = [];
  for (const issue of issues || NO_ISSUES) {
    if (!issue || issue.scope !== scope) continue;
    if (issue.id && known.has(issue.id)) {
      if (!byId.has(issue.id)) byId.set(issue.id, []);
      byId.get(issue.id).push(issue);
    } else {
      rest.push(issue);
    }
  }
  return { byId, rest };
}

/**
 * Sort the issues of a workflow into the places the Mapping step shows them.
 * Issues that belong to a single output (scope 'output' or an outputId) are left
 * to the Outputs step.
 * @returns {{ all, byField: Map<string, object[]>, filters, groupBy, sort, general }}
 */
export function groupMappingIssues(issues, definition) {
  const fieldIds = new Set(((definition && definition.fields) || []).map((field) => field.id));
  const out = { all: [], byField: new Map(), filters: [], groupBy: [], sort: [], general: [] };
  for (const issue of issues || NO_ISSUES) {
    if (!issue || issue.outputId || issue.scope === "output") continue;
    out.all.push(issue);
    if (issue.scope === "field" && issue.id && fieldIds.has(issue.id)) {
      if (!out.byField.has(issue.id)) out.byField.set(issue.id, []);
      out.byField.get(issue.id).push(issue);
    } else if (issue.scope === "filter") out.filters.push(issue);
    else if (issue.scope === "groupBy") out.groupBy.push(issue);
    else if (issue.scope === "sort") out.sort.push(issue);
    else out.general.push(issue);
  }
  return out;
}

/** { [resultColumnKey]: 'error' | 'warning' } for DataTable's columnIssues. */
export function toColumnIssues(grouped) {
  const out = {};
  const mark = (key, level) => {
    if (!key) return;
    if (level === "error" || !out[key]) out[key] = level === "error" ? "error" : "warning";
  };
  for (const [fieldId, list] of grouped.byField) mark(fieldId, worstLevel(list));
  for (const issue of grouped.groupBy) mark(issue.id, issue.level); // aggregation columns are keyed by aggregation id
  return out;
}
