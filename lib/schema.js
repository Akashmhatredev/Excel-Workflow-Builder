/**
 * lib/schema.js: the single source of truth for every data shape in the app.
 *
 * Everything here is plain JSON-serialisable data. A workflow *definition* never
 * contains spreadsheet data, so it is safe to keep in localStorage and to export.
 *
 * Shapes (see CONTRACTS.md for the prose version):
 *
 * WorkflowDefinition = {
 *   schemaVersion: number,
 *   source: {
 *     sheetNames: string[],             // sheets to read ([] = first non-empty sheet)
 *     headerRow: number,                // 1-based row that holds the column names
 *     expectedColumns: Column[],        // snapshot of the source columns: { name, type }
 *   },
 *   fields: MappingField[],             // the output columns, in order
 *   filters: FilterGroup,               // row-level filter
 *   groupBy: GroupBy,
 *   sort: SortRule[],
 *   outputs: Output[],
 * }
 *
 * MappingField = {
 *   id: string,
 *   name: string,                       // output column name (this is the "rename")
 *   source: {
 *     kind: 'column' | 'combine' | 'formula',
 *     column: string,                   // kind=column: source column name
 *     template: string,                 // kind=combine: "{First} {Last}"
 *     expression: string,               // kind=formula: "{Qty} * {Price}"
 *   },
 *   transforms: Transform[],            // applied in order
 * }
 *
 * Transform = { id, type, ...params }   // see TRANSFORMS for the params of each type
 *
 * FilterGroup = { combinator: 'and' | 'or', rules: FilterRule[] }
 * FilterRule  = {
 *   id: string,
 *   target: { kind: 'column' | 'field', ref: string },  // column name or field id
 *   operator: keyof FILTER_OPERATORS,
 *   value: string, value2: string,      // value2 is only used by "between"
 * }
 *
 * GroupBy = {
 *   enabled: boolean,
 *   keys: string[],                     // field ids
 *   aggregations: Aggregation[],
 * }
 * Aggregation = { id, fieldId, fn: 'sum'|'count'|'avg'|'min'|'max', name }
 *
 * SortRule = { id, key: string, direction: 'asc' | 'desc' }   // key = result column key
 *
 * Output = {
 *   id, name, fileType: 'xlsx' | 'csv', sheetName,
 *   fieldIds: string[] | null,          // null = every field; otherwise an ordered subset
 *   overrides: {
 *     filters: { enabled: boolean, group: FilterGroup },
 *     sort:    { enabled: boolean, rules: SortRule[] },
 *     groupBy: { enabled: boolean, config: GroupBy },
 *   },
 *   report: Report,
 * }
 *
 * Report = {
 *   enabled, title, subtitle, theme: 'light'|'dark'|'brand', brandColor,
 *   columnWidths: { [columnKey]: number }, maxRows, showRowNumbers, zebra,
 *   footer, showDate,
 * }
 *
 * Template = {
 *   id, name, description, tags: string[], createdAt, updatedAt (ISO strings),
 *   schemaVersion, definition: WorkflowDefinition,
 * }
 *
 * Result columns: what an output produces. Without grouping it is the included
 * fields ({ key: field.id }). With grouping it is the key fields followed by the
 * aggregations ({ key: aggregation.id }). See getResultColumns().
 */

export const APP_ID = "excel-workflow-builder";
export const SCHEMA_VERSION = 1;

export const COLUMN_TYPES = ["text", "number", "date"];

export const SOURCE_KINDS = {
  column: { label: "Column", hint: "Copy one source column" },
  combine: { label: "Combine", hint: "Join columns with a template, e.g. {First} {Last}" },
  formula: { label: "Formula", hint: "Calculate a value, e.g. {Qty} * {Price}" },
};

/**
 * Transform catalogue. `defaults` are the params a new transform starts with.
 * `numberFormat` and `dateFormat` are *format* transforms: when one is the last
 * transform of a field, the engine keeps the typed value (so Excel gets a real
 * number or date and aggregations still work) and uses it as the column format.
 */
export const TRANSFORMS = {
  trim: { label: "Trim spaces", defaults: {} },
  upper: { label: "UPPERCASE", defaults: {} },
  lower: { label: "lowercase", defaults: {} },
  title: { label: "Title Case", defaults: {} },
  numberFormat: {
    label: "Number format",
    defaults: { decimals: 2, thousands: true, prefix: "", suffix: "" },
  },
  dateFormat: { label: "Date format", defaults: { pattern: "DD/MM/YYYY" } },
  default: { label: "Default if empty", defaults: { value: "" } },
  split: { label: "Split by delimiter", defaults: { delimiter: ",", index: 1 } },
  replace: {
    label: "Find and replace",
    defaults: { find: "", replaceWith: "", matchCase: false, useRegex: false },
  },
};

export const FORMAT_TRANSFORMS = ["numberFormat", "dateFormat"];

/** Date pattern presets offered in the UI. Tokens: YYYY YY MMMM MMM MM M DD D HH H hh h mm ss A. */
export const DATE_PATTERNS = [
  "DD/MM/YYYY",
  "MM/DD/YYYY",
  "YYYY-MM-DD",
  "DD-MMM-YYYY",
  "DD MMM YYYY",
  "MMM D, YYYY",
  "MMMM YYYY",
  "DD/MM/YYYY HH:mm",
];

/** `arity` is the number of value inputs the operator needs. */
export const FILTER_OPERATORS = {
  equals: { label: "equals", arity: 1 },
  notEquals: { label: "does not equal", arity: 1 },
  contains: { label: "contains", arity: 1 },
  notContains: { label: "does not contain", arity: 1 },
  startsWith: { label: "starts with", arity: 1 },
  endsWith: { label: "ends with", arity: 1 },
  gt: { label: "greater than (>)", arity: 1 },
  gte: { label: "greater or equal (>=)", arity: 1 },
  lt: { label: "less than (<)", arity: 1 },
  lte: { label: "less or equal (<=)", arity: 1 },
  between: { label: "between", arity: 2 },
  isEmpty: { label: "is empty", arity: 0 },
  notEmpty: { label: "is not empty", arity: 0 },
};

export const AGGREGATIONS = {
  sum: { label: "Sum" },
  count: { label: "Count" },
  avg: { label: "Average" },
  min: { label: "Min" },
  max: { label: "Max" },
};

export const FILE_TYPES = {
  xlsx: { label: "Excel (.xlsx)", mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" },
  csv: { label: "CSV (.csv)", mime: "text/csv;charset=utf-8" },
};

export const REPORT_THEMES = {
  light: { label: "Light" },
  dark: { label: "Dark" },
  brand: { label: "Brand colour" },
};

export const DEFAULT_BRAND_COLOR = "#059669";
export const REPORT_MAX_ROWS = 500;

/* ------------------------------------------------------------------ */
/* ids and factories                                                    */
/* ------------------------------------------------------------------ */

export function createId(prefix = "id") {
  const uuid =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID().replace(/-/g, "").slice(0, 12)
      : Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
  return `${prefix}_${uuid}`;
}

export function createTransform(type, overrides = {}) {
  const spec = TRANSFORMS[type];
  if (!spec) throw new Error(`Unknown transform type: ${type}`);
  return { id: createId("tr"), type, ...spec.defaults, ...overrides };
}

export function createField(overrides = {}) {
  const { source, transforms, ...rest } = overrides;
  return {
    id: createId("fld"),
    name: "",
    ...rest,
    source: { kind: "column", column: "", template: "", expression: "", ...(source || {}) },
    transforms: Array.isArray(transforms) ? transforms : [],
  };
}

export function createFilterRule(overrides = {}) {
  const { target, ...rest } = overrides;
  return {
    id: createId("flt"),
    operator: "equals",
    value: "",
    value2: "",
    ...rest,
    target: { kind: "column", ref: "", ...(target || {}) },
  };
}

export function createFilterGroup(overrides = {}) {
  return { combinator: "and", rules: [], ...overrides };
}

export function createAggregation(overrides = {}) {
  return { id: createId("agg"), fieldId: "", fn: "sum", name: "", ...overrides };
}

export function createGroupBy(overrides = {}) {
  return { enabled: false, keys: [], aggregations: [], ...overrides };
}

export function createSortRule(overrides = {}) {
  return { id: createId("srt"), key: "", direction: "asc", ...overrides };
}

export function createReport(overrides = {}) {
  return {
    enabled: false,
    title: "",
    subtitle: "",
    theme: "light",
    brandColor: DEFAULT_BRAND_COLOR,
    columnWidths: {},
    maxRows: 50,
    showRowNumbers: false,
    zebra: true,
    footer: "",
    showDate: false,
    ...overrides,
  };
}

export function createOutput(overrides = {}) {
  const { overrides: outputOverrides, report, ...rest } = overrides;
  const o = outputOverrides || {};
  return {
    id: createId("out"),
    name: "Output",
    fileType: "xlsx",
    sheetName: "Sheet1",
    fieldIds: null,
    ...rest,
    overrides: {
      filters: { enabled: false, group: createFilterGroup(), ...(o.filters || {}) },
      sort: { enabled: false, rules: [], ...(o.sort || {}) },
      groupBy: { enabled: false, config: createGroupBy(), ...(o.groupBy || {}) },
    },
    report: createReport(report || {}),
  };
}

export function createDefinition(overrides = {}) {
  const { source, ...rest } = overrides;
  return {
    schemaVersion: SCHEMA_VERSION,
    fields: [],
    filters: createFilterGroup(),
    groupBy: createGroupBy(),
    sort: [],
    outputs: [],
    ...rest,
    source: { sheetNames: [], headerRow: 1, expectedColumns: [], ...(source || {}) },
  };
}

export function createTemplate({ name, description = "", tags = [], definition } = {}) {
  const now = new Date().toISOString();
  return {
    id: createId("tpl"),
    name: String(name || "Untitled template").trim() || "Untitled template",
    description: String(description || ""),
    tags: Array.isArray(tags) ? tags : [],
    createdAt: now,
    updatedAt: now,
    schemaVersion: SCHEMA_VERSION,
    definition: normalizeDefinition(definition),
  };
}

export function clone(value) {
  return value === undefined ? value : JSON.parse(JSON.stringify(value));
}

/* ------------------------------------------------------------------ */
/* names                                                                */
/* ------------------------------------------------------------------ */

/** Case-insensitive, whitespace-insensitive key used to match column headers. */
export function normalizeName(value) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/** "Name" -> "Name (2)" when "Name" is already taken (comparison is normalised). */
export function uniqueName(base, existing = []) {
  const taken = new Set(existing.map(normalizeName));
  const root = String(base || "").trim() || "Untitled";
  if (!taken.has(normalizeName(root))) return root;
  let n = 2;
  while (taken.has(normalizeName(`${root} (${n})`))) n += 1;
  return `${root} (${n})`;
}

export function sanitizeFileName(name, fallback = "output") {
  const cleaned = String(name ?? "")
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^\.+/, "")
    .slice(0, 120);
  return cleaned || fallback;
}

/** Excel sheet names: at most 31 chars, none of \ / ? * [ ] : */
export function sanitizeSheetName(name, fallback = "Sheet1") {
  const cleaned = String(name ?? "")
    .replace(/[\\/?*[\]:]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^'+|'+$/g, "")
    .slice(0, 31);
  return cleaned || fallback;
}

export function outputFileName(output) {
  const ext = output && output.fileType === "csv" ? "csv" : "xlsx";
  return `${sanitizeFileName(output && output.name)}.${ext}`;
}

/* ------------------------------------------------------------------ */
/* {Column} references                                                  */
/* ------------------------------------------------------------------ */

const REF_PATTERN = /\{([^{}]+)\}/g;

/** "{First} {Last}" -> ["First", "Last"] (trimmed, de-duplicated, in order). */
export function extractRefs(text) {
  const out = [];
  const seen = new Set();
  for (const match of String(text ?? "").matchAll(REF_PATTERN)) {
    const name = match[1].trim();
    if (name && !seen.has(name)) {
      seen.add(name);
      out.push(name);
    }
  }
  return out;
}

/** Rename references inside a template/expression. `map` is { oldName: newName }. */
export function replaceRefs(text, map) {
  return String(text ?? "").replace(REF_PATTERN, (whole, inner) => {
    const name = inner.trim();
    return Object.prototype.hasOwnProperty.call(map, name) && map[name] ? `{${map[name]}}` : whole;
  });
}

/** Source columns a single field reads. */
export function fieldColumnRefs(field) {
  const source = (field && field.source) || {};
  if (source.kind === "combine") return extractRefs(source.template);
  if (source.kind === "formula") return extractRefs(source.expression);
  return source.column ? [source.column] : [];
}

function filterGroupColumnRefs(group) {
  const rules = (group && group.rules) || [];
  return rules
    .filter((rule) => rule && rule.target && rule.target.kind === "column" && rule.target.ref)
    .map((rule) => rule.target.ref);
}

/** Every source column name a definition references (unique, first-seen order). */
export function collectColumnRefs(definition) {
  const out = [];
  const seen = new Set();
  const add = (name) => {
    if (name && !seen.has(name)) {
      seen.add(name);
      out.push(name);
    }
  };
  const def = definition || {};
  for (const field of def.fields || []) fieldColumnRefs(field).forEach(add);
  filterGroupColumnRefs(def.filters).forEach(add);
  for (const output of def.outputs || []) {
    const override = output && output.overrides && output.overrides.filters;
    if (override && override.enabled) filterGroupColumnRefs(override.group).forEach(add);
  }
  return out;
}

function remapFilterGroup(group, map) {
  if (!group || !Array.isArray(group.rules)) return group;
  return {
    ...group,
    rules: group.rules.map((rule) =>
      rule && rule.target && rule.target.kind === "column" && map[rule.target.ref]
        ? { ...rule, target: { ...rule.target, ref: map[rule.target.ref] } }
        : rule,
    ),
  };
}

/** Returns a new definition with source column references renamed. `map` is { oldName: newName }. */
export function remapColumnRefs(definition, map) {
  const renames = {};
  for (const [from, to] of Object.entries(map || {})) {
    if (to && to !== from) renames[from] = to;
  }
  if (!Object.keys(renames).length) return definition;
  return {
    ...definition,
    fields: (definition.fields || []).map((field) => {
      const source = field.source || {};
      return {
        ...field,
        source: {
          ...source,
          column: renames[source.column] || source.column,
          template: replaceRefs(source.template, renames),
          expression: replaceRefs(source.expression, renames),
        },
      };
    }),
    filters: remapFilterGroup(definition.filters, renames),
    outputs: (definition.outputs || []).map((output) => {
      const override = output.overrides && output.overrides.filters;
      if (!override) return output;
      return {
        ...output,
        overrides: {
          ...output.overrides,
          filters: { ...override, group: remapFilterGroup(override.group, renames) },
        },
      };
    }),
  };
}

function bigrams(text) {
  const s = ` ${text} `;
  const out = new Map();
  for (let i = 0; i < s.length - 1; i += 1) {
    const gram = s.slice(i, i + 2);
    out.set(gram, (out.get(gram) || 0) + 1);
  }
  return out;
}

/** 0..1 similarity (Dice coefficient on character bigrams of the normalised names). */
export function nameSimilarity(a, b) {
  const x = normalizeName(a);
  const y = normalizeName(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  const gx = bigrams(x);
  const gy = bigrams(y);
  let overlap = 0;
  let total = 0;
  for (const [gram, count] of gx) {
    total += count;
    overlap += Math.min(count, gy.get(gram) || 0);
  }
  for (const count of gy.values()) total += count;
  return total ? (2 * overlap) / total : 0;
}

/** Best fuzzy match for a missing column, or null when nothing is close enough. */
export function suggestColumn(name, columnNames, threshold = 0.45) {
  let best = null;
  let bestScore = threshold;
  for (const candidate of columnNames || []) {
    const score = nameSimilarity(name, candidate);
    if (score > bestScore) {
      best = candidate;
      bestScore = score;
    }
  }
  return best;
}

/**
 * Match the column names a definition references against the columns of a file.
 * Matching ignores case and surrounding/repeated whitespace, then tries aliases.
 *
 * @param {string[]} refs         names referenced by the definition (collectColumnRefs)
 * @param {string[]} columnNames  column names actually present in the file
 * @param {{from: string, to: string}[]} aliases  saved alias pairs (either direction)
 * @returns {{ map: Record<string,string>, missing: string[], suggestions: Record<string,string|null> }}
 *   map: ref -> actual column name (only for matched refs)
 */
export function matchColumns(refs, columnNames, aliases = []) {
  const actual = new Map();
  for (const name of columnNames || []) {
    const key = normalizeName(name);
    if (!actual.has(key)) actual.set(key, name);
  }
  const exact = new Set(columnNames || []);
  const map = {};
  const missing = [];
  const suggestions = {};
  for (const ref of refs || []) {
    if (exact.has(ref)) {
      map[ref] = ref;
      continue;
    }
    const key = normalizeName(ref);
    if (actual.has(key)) {
      map[ref] = actual.get(key);
      continue;
    }
    let found = null;
    for (const alias of aliases || []) {
      if (!alias) continue;
      const from = normalizeName(alias.from);
      const to = normalizeName(alias.to);
      if (from === key && actual.has(to)) found = actual.get(to);
      else if (to === key && actual.has(from)) found = actual.get(from);
      if (found) break;
    }
    if (found) {
      map[ref] = found;
    } else {
      missing.push(ref);
      suggestions[ref] = suggestColumn(ref, columnNames);
    }
  }
  return { map, missing, suggestions };
}

/* ------------------------------------------------------------------ */
/* outputs                                                              */
/* ------------------------------------------------------------------ */

/** The filters / grouping / sort an output really uses (its override when enabled, else the workflow's). */
export function resolveOutputConfig(definition, output) {
  const def = definition || {};
  const overrides = (output && output.overrides) || {};
  return {
    filters:
      overrides.filters && overrides.filters.enabled
        ? overrides.filters.group || createFilterGroup()
        : def.filters || createFilterGroup(),
    groupBy:
      overrides.groupBy && overrides.groupBy.enabled
        ? { ...createGroupBy(), ...(overrides.groupBy.config || {}), enabled: true }
        : def.groupBy || createGroupBy(),
    sort: overrides.sort && overrides.sort.enabled ? overrides.sort.rules || [] : def.sort || [],
  };
}

export function isGroupingActive(groupBy) {
  return Boolean(
    groupBy &&
      groupBy.enabled &&
      ((groupBy.keys && groupBy.keys.length) || (groupBy.aggregations && groupBy.aggregations.length)),
  );
}

export function aggregationLabel(aggregation, fields = []) {
  if (aggregation && aggregation.name && aggregation.name.trim()) return aggregation.name.trim();
  const spec = AGGREGATIONS[aggregation && aggregation.fn];
  const field = fields.find((f) => f.id === (aggregation && aggregation.fieldId));
  const fnLabel = spec ? spec.label : "Value";
  if (aggregation && aggregation.fn === "count" && !field) return "Count";
  return `${fnLabel} of ${field ? field.name || "field" : "field"}`;
}

/**
 * The columns an output produces, in order.
 * `output` may be null to describe the workflow-level (mapping step) result.
 *
 * @returns {{ key: string, name: string, role: 'field'|'key'|'aggregation', fieldId: string, fn?: string }[]}
 */
export function getResultColumns(definition, output = null) {
  const def = definition || {};
  const fields = def.fields || [];
  const { groupBy } = resolveOutputConfig(def, output);
  if (isGroupingActive(groupBy)) {
    const columns = [];
    for (const key of groupBy.keys || []) {
      const field = fields.find((f) => f.id === key);
      if (field) columns.push({ key: field.id, name: field.name, role: "key", fieldId: field.id });
    }
    for (const aggregation of groupBy.aggregations || []) {
      columns.push({
        key: aggregation.id,
        name: aggregationLabel(aggregation, fields),
        role: "aggregation",
        fieldId: aggregation.fieldId,
        fn: aggregation.fn,
      });
    }
    return columns;
  }
  let included = fields;
  if (output && Array.isArray(output.fieldIds)) {
    included = output.fieldIds.map((id) => fields.find((f) => f.id === id)).filter(Boolean);
  }
  return included.map((field) => ({ key: field.id, name: field.name, role: "field", fieldId: field.id }));
}

/* ------------------------------------------------------------------ */
/* normalising and structural validation (used when importing)          */
/* ------------------------------------------------------------------ */

const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const str = (value, fallback = "") => (typeof value === "string" ? value : value == null ? fallback : String(value));

function normalizeFilterGroup(group) {
  const g = isObject(group) ? group : {};
  return {
    combinator: g.combinator === "or" ? "or" : "and",
    rules: (Array.isArray(g.rules) ? g.rules : []).filter(isObject).map((rule) => ({
      id: str(rule.id) || createId("flt"),
      target: {
        kind: isObject(rule.target) && rule.target.kind === "field" ? "field" : "column",
        ref: isObject(rule.target) ? str(rule.target.ref) : "",
      },
      operator: FILTER_OPERATORS[rule.operator] ? rule.operator : "equals",
      value: str(rule.value),
      value2: str(rule.value2),
    })),
  };
}

function normalizeGroupBy(groupBy) {
  const g = isObject(groupBy) ? groupBy : {};
  return {
    enabled: Boolean(g.enabled),
    keys: (Array.isArray(g.keys) ? g.keys : []).map((k) => str(k)).filter(Boolean),
    aggregations: (Array.isArray(g.aggregations) ? g.aggregations : []).filter(isObject).map((a) => ({
      id: str(a.id) || createId("agg"),
      fieldId: str(a.fieldId),
      fn: AGGREGATIONS[a.fn] ? a.fn : "sum",
      name: str(a.name),
    })),
  };
}

function normalizeSort(sort) {
  return (Array.isArray(sort) ? sort : []).filter(isObject).map((rule) => ({
    id: str(rule.id) || createId("srt"),
    key: str(rule.key),
    direction: rule.direction === "desc" ? "desc" : "asc",
  }));
}

function normalizeTransform(transform) {
  if (!isObject(transform) || !TRANSFORMS[transform.type]) return null;
  return { ...TRANSFORMS[transform.type].defaults, ...transform, id: str(transform.id) || createId("tr") };
}

function normalizeField(field) {
  const f = isObject(field) ? field : {};
  const source = isObject(f.source) ? f.source : {};
  return {
    ...f,
    id: str(f.id) || createId("fld"),
    name: str(f.name),
    source: {
      kind: SOURCE_KINDS[source.kind] ? source.kind : "column",
      column: str(source.column),
      template: str(source.template),
      expression: str(source.expression),
    },
    transforms: (Array.isArray(f.transforms) ? f.transforms : []).map(normalizeTransform).filter(Boolean),
  };
}

function normalizeOutput(output) {
  const o = isObject(output) ? output : {};
  const overrides = isObject(o.overrides) ? o.overrides : {};
  const filters = isObject(overrides.filters) ? overrides.filters : {};
  const sort = isObject(overrides.sort) ? overrides.sort : {};
  const groupBy = isObject(overrides.groupBy) ? overrides.groupBy : {};
  const report = isObject(o.report) ? o.report : {};
  const maxRows = Number(report.maxRows);
  return {
    ...o,
    id: str(o.id) || createId("out"),
    name: str(o.name) || "Output",
    fileType: o.fileType === "csv" ? "csv" : "xlsx",
    sheetName: str(o.sheetName) || "Sheet1",
    fieldIds: Array.isArray(o.fieldIds) ? o.fieldIds.map((id) => str(id)).filter(Boolean) : null,
    overrides: {
      filters: { enabled: Boolean(filters.enabled), group: normalizeFilterGroup(filters.group) },
      sort: { enabled: Boolean(sort.enabled), rules: normalizeSort(sort.rules) },
      groupBy: { enabled: Boolean(groupBy.enabled), config: normalizeGroupBy(groupBy.config) },
    },
    report: createReport({
      ...report,
      enabled: Boolean(report.enabled),
      title: str(report.title),
      subtitle: str(report.subtitle),
      theme: REPORT_THEMES[report.theme] ? report.theme : "light",
      brandColor: /^#[0-9a-f]{6}$/i.test(str(report.brandColor)) ? report.brandColor : DEFAULT_BRAND_COLOR,
      columnWidths: isObject(report.columnWidths) ? report.columnWidths : {},
      maxRows: Number.isFinite(maxRows) ? Math.min(Math.max(Math.round(maxRows), 1), REPORT_MAX_ROWS) : 50,
      showRowNumbers: Boolean(report.showRowNumbers),
      zebra: report.zebra === undefined ? true : Boolean(report.zebra),
      footer: str(report.footer),
      showDate: Boolean(report.showDate),
    }),
  };
}

/**
 * Fill in every optional property so the rest of the app can read a definition
 * without defensive checks. Never throws; unknown transforms are dropped.
 */
export function normalizeDefinition(definition) {
  const d = isObject(definition) ? definition : {};
  const source = isObject(d.source) ? d.source : {};
  const headerRow = Number(source.headerRow);
  return {
    ...d,
    schemaVersion: SCHEMA_VERSION,
    source: {
      ...source,
      sheetNames: (Array.isArray(source.sheetNames) ? source.sheetNames : []).map((s) => str(s)).filter(Boolean),
      headerRow: Number.isFinite(headerRow) && headerRow >= 1 ? Math.floor(headerRow) : 1,
      expectedColumns: (Array.isArray(source.expectedColumns) ? source.expectedColumns : [])
        .map((column) => (typeof column === "string" ? { name: column, type: "text" } : column))
        .filter((column) => isObject(column) && str(column.name))
        .map((column) => ({
          name: str(column.name),
          type: COLUMN_TYPES.includes(column.type) ? column.type : "text",
        })),
    },
    fields: (Array.isArray(d.fields) ? d.fields : []).map(normalizeField),
    filters: normalizeFilterGroup(d.filters),
    groupBy: normalizeGroupBy(d.groupBy),
    sort: normalizeSort(d.sort),
    outputs: (Array.isArray(d.outputs) ? d.outputs : []).map(normalizeOutput),
  };
}

/**
 * Structural check of an (already migrated) definition. Returns human-readable
 * problems; an empty array means the shape is acceptable.
 */
export function validateDefinitionShape(definition) {
  const errors = [];
  if (!isObject(definition)) return ["The definition must be an object."];
  const d = definition;
  if (d.source !== undefined && !isObject(d.source)) errors.push("definition.source must be an object.");
  if (!Array.isArray(d.fields)) errors.push("definition.fields must be a list.");
  else {
    const ids = new Set();
    d.fields.forEach((field, i) => {
      const where = `fields[${i}]`;
      if (!isObject(field)) {
        errors.push(`${where} must be an object.`);
        return;
      }
      if (typeof field.id !== "string" || !field.id) errors.push(`${where}.id is missing.`);
      else if (ids.has(field.id)) errors.push(`${where}.id "${field.id}" is used more than once.`);
      else ids.add(field.id);
      if (typeof field.name !== "string") errors.push(`${where}.name must be text.`);
      if (!isObject(field.source)) errors.push(`${where}.source must be an object.`);
      else if (!SOURCE_KINDS[field.source.kind]) errors.push(`${where}.source.kind "${field.source.kind}" is not supported.`);
      if (field.transforms !== undefined && !Array.isArray(field.transforms)) {
        errors.push(`${where}.transforms must be a list.`);
      } else {
        (field.transforms || []).forEach((transform, j) => {
          if (!isObject(transform) || !TRANSFORMS[transform.type]) {
            errors.push(`${where}.transforms[${j}] has an unknown type "${transform && transform.type}".`);
          }
        });
      }
    });
  }
  if (d.filters !== undefined && (!isObject(d.filters) || !Array.isArray(d.filters.rules))) {
    errors.push("definition.filters must be { combinator, rules }.");
  }
  if (d.groupBy !== undefined && !isObject(d.groupBy)) errors.push("definition.groupBy must be an object.");
  if (d.sort !== undefined && !Array.isArray(d.sort)) errors.push("definition.sort must be a list.");
  if (d.outputs !== undefined && !Array.isArray(d.outputs)) errors.push("definition.outputs must be a list.");
  else {
    (d.outputs || []).forEach((output, i) => {
      const where = `outputs[${i}]`;
      if (!isObject(output)) {
        errors.push(`${where} must be an object.`);
        return;
      }
      if (typeof output.id !== "string" || !output.id) errors.push(`${where}.id is missing.`);
      if (output.fileType !== undefined && !FILE_TYPES[output.fileType]) {
        errors.push(`${where}.fileType "${output.fileType}" is not supported (use xlsx or csv).`);
      }
      if (output.fieldIds !== undefined && output.fieldIds !== null && !Array.isArray(output.fieldIds)) {
        errors.push(`${where}.fieldIds must be a list or null.`);
      }
    });
  }
  return errors;
}

/** Structural check of a template object (the `definition` is checked with validateDefinitionShape). */
export function validateTemplateShape(template) {
  if (!isObject(template)) return ["The template must be an object."];
  const errors = [];
  if (typeof template.name !== "string" || !template.name.trim()) errors.push("The template has no name.");
  if (template.schemaVersion !== undefined && !Number.isInteger(template.schemaVersion)) {
    errors.push("schemaVersion must be a whole number.");
  }
  if (!isObject(template.definition)) errors.push("The template has no definition.");
  else errors.push(...validateDefinitionShape(template.definition));
  return errors;
}
