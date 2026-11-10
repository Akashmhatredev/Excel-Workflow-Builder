import { useMemo } from "react";
import { create } from "zustand";
import { loadAliases } from "../lib/aliases";
import {
  clone,
  collectColumnRefs,
  createDefinition,
  createField,
  createId,
  createOutput,
  createTransform,
  isLookupConfigured,
  matchColumns,
  normalizeDefinition,
  normalizeName,
  pickSheetNames as pickSheets,
  remapColumnRefs,
  uniqueName,
} from "../lib/schema";
import { toast } from "../lib/toast";
import * as engine from "../lib/workerClient";

/**
 * store/useWorkflowStore.js: the in-progress workflow.
 *
 * Two kinds of state live here:
 *  - dataset *metadata* for the loaded file (sheets, columns, 50 preview rows).
 *    The rows themselves stay inside the worker. Nothing about the file is persisted.
 *  - the workflow *definition* (lib/schema.js). It is autosaved as a draft by
 *    components/templates/StorageBridge.jsx and can be saved as a template.
 *
 * Every definition change goes through commit(), which records undo history.
 * Use the specific actions where they exist and updateDefinition() for anything else.
 */

export const STEPS = [
  { id: "upload", label: "Upload", description: "Load your Excel or CSV file" },
  { id: "mapping", label: "Mapping", description: "Shape the columns you need" },
  { id: "outputs", label: "Outputs", description: "Define the files to produce" },
  { id: "export", label: "Export", description: "Download and share" },
];

const HISTORY_LIMIT = 60;
const COALESCE_MS = 900;

export const LOOKUP_DATASET = "lookup";

let lastCommit = { tag: null, at: 0 };
let loadToken = 0;
let lookupToken = 0;

const emptyData = () => ({
  file: null, // { name, size, lastModified }
  sheets: [], // [{ name, rowCount, colCount }]
  columns: [], // [{ name, type, index }]
  rowCount: 0,
  previewRows: [], // string[][], first 50 source rows
  warnings: [],
  status: "idle", // 'idle' | 'parsing' | 'loading' | 'ready' | 'error'
  progress: null, // { phase, percent?, message? }
  error: null,
  columnFix: null, // { missing: string[], suggestions: { [name]: string|null } }
});

const emptyLookup = () => ({
  lookupFile: null, // { name, size }
  lookupSheets: [], // [{ name, rowCount, colCount }]
  lookupColumns: [], // [{ name, type, index }]
  lookupRowCount: 0,
  lookupStatus: "idle", // 'idle' | 'parsing' | 'ready' | 'error'
  lookupError: null,
  lookupInfo: null, // { applied, matched, unmatched, addedColumns: string[], duplicateKeys } from the last table load
});

function stripFieldFromFilterGroup(group, fieldId) {
  if (!group || !Array.isArray(group.rules)) return group;
  const rules = group.rules.filter((rule) => !(rule.target && rule.target.kind === "field" && rule.target.ref === fieldId));
  return rules.length === group.rules.length ? group : { ...group, rules };
}

function stripFieldFromGroupBy(groupBy, fieldId) {
  if (!groupBy) return groupBy;
  return {
    ...groupBy,
    keys: (groupBy.keys || []).filter((key) => key !== fieldId),
    aggregations: (groupBy.aggregations || []).filter((aggregation) => aggregation.fieldId !== fieldId),
  };
}

/** Remove a field and everything that points at it. */
function removeFieldEverywhere(definition, fieldId) {
  const removedAggregations = new Set();
  const collect = (groupBy) =>
    ((groupBy && groupBy.aggregations) || []).forEach((a) => a.fieldId === fieldId && removedAggregations.add(a.id));
  collect(definition.groupBy);
  definition.outputs.forEach((output) => collect(output.overrides.groupBy.config));
  const keepSort = (rule) => rule.key !== fieldId && !removedAggregations.has(rule.key);
  const cleaning = definition.cleaning;
  return {
    ...definition,
    cleaning: cleaning
      ? {
          ...cleaning,
          removeDuplicates: {
            ...cleaning.removeDuplicates,
            keys: (cleaning.removeDuplicates.keys || []).filter((id) => id !== fieldId),
          },
          fillBlanks: {
            ...cleaning.fillBlanks,
            fieldIds: (cleaning.fillBlanks.fieldIds || []).filter((id) => id !== fieldId),
          },
        }
      : cleaning,
    fields: definition.fields.filter((field) => field.id !== fieldId),
    filters: stripFieldFromFilterGroup(definition.filters, fieldId),
    groupBy: stripFieldFromGroupBy(definition.groupBy, fieldId),
    sort: definition.sort.filter(keepSort),
    outputs: definition.outputs.map((output) => ({
      ...output,
      fieldIds: Array.isArray(output.fieldIds) ? output.fieldIds.filter((id) => id !== fieldId) : output.fieldIds,
      conditionalFormats: (output.conditionalFormats || []).filter(
        (format) => format.columnKey !== fieldId && !removedAggregations.has(format.columnKey),
      ),
      overrides: {
        filters: {
          ...output.overrides.filters,
          group: stripFieldFromFilterGroup(output.overrides.filters.group, fieldId),
        },
        sort: { ...output.overrides.sort, rules: output.overrides.sort.rules.filter(keepSort) },
        groupBy: {
          ...output.overrides.groupBy,
          config: stripFieldFromGroupBy(output.overrides.groupBy.config, fieldId),
        },
      },
    })),
  };
}

function mapField(definition, fieldId, recipe) {
  let changed = false;
  const fields = definition.fields.map((field) => {
    if (field.id !== fieldId) return field;
    const next = recipe(field);
    if (next !== field) changed = true;
    return next;
  });
  return changed ? { ...definition, fields } : definition;
}

function mapOutput(definition, outputId, recipe) {
  let changed = false;
  const outputs = definition.outputs.map((output) => {
    if (output.id !== outputId) return output;
    const next = recipe(output);
    if (next !== output) changed = true;
    return next;
  });
  return changed ? { ...definition, outputs } : definition;
}

function move(list, from, to) {
  if (from < 0 || from >= list.length) return list;
  const target = Math.max(0, Math.min(list.length - 1, to));
  if (target === from) return list;
  const next = list.slice();
  const [item] = next.splice(from, 1);
  next.splice(target, 0, item);
  return next;
}

export const useWorkflowStore = create((set, get) => {
  /** Apply a definition change and record it for undo. Rapid edits with the same tag collapse into one step. */
  const commit = (tag, recipe) => {
    const state = get();
    const next = recipe(state.definition);
    if (!next || next === state.definition) return;
    const now = Date.now();
    const coalesce = Boolean(tag) && lastCommit.tag === tag && now - lastCommit.at < COALESCE_MS;
    lastCommit = { tag, at: now };
    set({
      definition: next,
      past: coalesce ? state.past : [...state.past.slice(-(HISTORY_LIMIT - 1)), state.definition],
      future: [],
      dirty: true,
    });
  };

  const loadTableInto = async (sheetNames, headerRow, token) => {
    set({ status: "loading", error: null, progress: { phase: "loading" } });
    try {
      const before = get();
      const lookup =
        before.lookupStatus === "ready" && isLookupConfigured(before.definition.lookup) ? before.definition.lookup : null;
      const table = await engine.loadTable({ sheetNames, headerRow, previewLimit: 50, lookup });
      if (token !== loadToken) return false;
      const state = get();
      let definition = {
        ...state.definition,
        source: {
          ...state.definition.source,
          sheetNames: table.sheetNames || sheetNames,
          headerRow: table.headerRow || headerRow,
          expectedColumns: table.columns.map(({ name, type }) => ({ name, type })),
        },
      };
      const names = table.columns.map((column) => column.name);
      const match = matchColumns(collectColumnRefs(definition), names, loadAliases());
      definition = remapColumnRefs(definition, match.map);
      // Columns that a not-yet-loaded lookup file will add are not "missing": the user just has to add that file.
      const pendingLookup = new Set();
      if (!lookup && isLookupConfigured(definition.lookup)) {
        for (const column of definition.lookup.expectedColumns) {
          pendingLookup.add(normalizeName(column.name));
          pendingLookup.add(normalizeName(`${column.name} (lookup)`));
        }
      }
      const missing = match.missing.filter((name) => !pendingLookup.has(normalizeName(name)));
      set({
        status: "ready",
        progress: null,
        error: null,
        columns: table.columns,
        rowCount: table.rowCount,
        previewRows: table.previewRows || [],
        warnings: table.warnings || [],
        definition,
        dataVersion: state.dataVersion + 1,
        columnFix: missing.length ? { missing, suggestions: match.suggestions } : null,
        lookupInfo: table.lookupInfo || null,
      });
      return true;
    } catch (error) {
      if (token !== loadToken) return false;
      set({
        status: "error",
        progress: null,
        error: error.message,
        columns: [],
        rowCount: 0,
        previewRows: [],
        warnings: [],
        columnFix: null,
      });
      toast.error("Could not load the sheet", { description: error.message });
      return false;
    }
  };

  /** Re-read the main table (after the lookup changed). Resolves to true when nothing is loaded. */
  const reloadMainTable = async () => {
    const state = get();
    if (!state.sheets.length) return true;
    loadToken += 1;
    return loadTableInto(
      pickSheets(state.sheets, state.definition.source.sheetNames),
      state.definition.source.headerRow || 1,
      loadToken,
    );
  };

  const loadLookupTableInto = async (sheetName, headerRow, token) => {
    try {
      const table = await engine.loadTable({
        datasetId: LOOKUP_DATASET,
        sheetNames: sheetName ? [sheetName] : [],
        headerRow,
        previewLimit: 0,
      });
      if (token !== lookupToken) return false;
      const names = table.columns.map((column) => column.name);
      const current = get().definition.lookup;
      const keyMatch = matchColumns(current.lookupColumn ? [current.lookupColumn] : [], names);
      const columnMatch = matchColumns(current.columns, names);
      const lookup = {
        ...current,
        enabled: true,
        sheetName: (table.sheetNames && table.sheetNames[0]) || sheetName || "",
        headerRow: table.headerRow || headerRow,
        lookupColumn: keyMatch.map[current.lookupColumn] || "",
        columns: current.columns.map((name) => columnMatch.map[name]).filter(Boolean),
        expectedColumns: table.columns.map(({ name, type }) => ({ name, type })),
      };
      set((state) => ({
        definition: { ...state.definition, lookup },
        lookupColumns: table.columns,
        lookupRowCount: table.rowCount,
        lookupStatus: "ready",
        lookupError: null,
      }));
      await reloadMainTable();
      return true;
    } catch (error) {
      if (token !== lookupToken) return false;
      set({ lookupStatus: "error", lookupError: error.message, lookupColumns: [], lookupRowCount: 0 });
      toast.error("Could not load the lookup sheet", { description: error.message });
      return false;
    }
  };

  return {
    /* ---------------- wizard ---------------- */
    step: 0,
    setStep: (step) => set({ step: Math.max(0, Math.min(STEPS.length - 1, Number(step) || 0)) }),
    nextStep: () => set((state) => ({ step: Math.min(STEPS.length - 1, state.step + 1) })),
    prevStep: () => set((state) => ({ step: Math.max(0, state.step - 1) })),

    /* ---------------- dataset (memory only) ---------------- */
    ...emptyData(),
    dataVersion: 0, // bumps whenever the loaded table changes; previews depend on it

    /** Parse a file in the worker and load its first (or template-selected) sheet. Resolves to true on success. */
    loadFile: async (file) => {
      if (!file) return false;
      loadToken += 1;
      const token = loadToken;
      set({
        ...emptyData(),
        file: { name: file.name, size: file.size, lastModified: file.lastModified },
        status: "parsing",
        progress: { phase: "reading", percent: 0 },
      });
      try {
        const parsed = await engine.parseFile(file, {
          onProgress: (progress) => {
            if (token === loadToken) set({ progress });
          },
        });
        if (token !== loadToken) return false;
        set({ sheets: parsed.sheets || [] });
        const source = get().definition.source;
        return await loadTableInto(pickSheets(parsed.sheets || [], source.sheetNames), source.headerRow || 1, token);
      } catch (error) {
        if (token !== loadToken) return false;
        set({ status: "error", progress: null, error: error.message });
        toast.error("Could not read the file", { description: error.message });
        return false;
      }
    },

    /** Choose which sheet(s) to use. Several sheets are stacked into one table. */
    selectSheets: async (sheetNames) => {
      const names = (sheetNames || []).filter(Boolean);
      if (!names.length || !get().sheets.length) return false;
      loadToken += 1;
      return loadTableInto(names, get().definition.source.headerRow || 1, loadToken);
    },

    /** Choose the 1-based row that holds the column names. */
    setHeaderRow: async (headerRow) => {
      const row = Math.max(1, Math.floor(Number(headerRow) || 1));
      const state = get();
      if (!state.sheets.length) {
        set({ definition: { ...state.definition, source: { ...state.definition.source, headerRow: row } } });
        return true;
      }
      loadToken += 1;
      return loadTableInto(pickSheets(state.sheets, state.definition.source.sheetNames), row, loadToken);
    },

    /** Forget the loaded file (the definition is kept). */
    clearData: () => {
      loadToken += 1;
      engine.disposeDataset().catch(() => {});
      set((state) => ({ ...emptyData(), dataVersion: state.dataVersion + 1 }));
    },

    /* ---------------- lookup file (memory only) ---------------- */
    ...emptyLookup(),

    /**
     * Load a second file to merge into the main table (left join on a key column).
     * Its columns then appear as ordinary source columns. Resolves to true on success.
     */
    loadLookupFile: async (file) => {
      if (!file) return false;
      lookupToken += 1;
      const token = lookupToken;
      set({ ...emptyLookup(), lookupFile: { name: file.name, size: file.size }, lookupStatus: "parsing" });
      try {
        const parsed = await engine.parseFile(file, { datasetId: LOOKUP_DATASET });
        if (token !== lookupToken) return false;
        set({ lookupSheets: parsed.sheets || [] });
        const lookup = get().definition.lookup;
        const [sheetName] = pickSheets(parsed.sheets || [], lookup.sheetName ? [lookup.sheetName] : []);
        return await loadLookupTableInto(sheetName, lookup.headerRow || 1, token);
      } catch (error) {
        if (token !== lookupToken) return false;
        set({ lookupStatus: "error", lookupError: error.message });
        toast.error("Could not read the lookup file", { description: error.message });
        return false;
      }
    },

    /**
     * Change the lookup settings: { enabled, sheetName, headerRow, matchColumn, lookupColumn, columns }.
     * Re-reads the lookup sheet when needed and re-joins the main table. Not part of undo history.
     */
    setLookup: async (patch) => {
      const before = get().definition.lookup;
      const lookup = { ...before, ...(patch || {}) };
      set((state) => ({ definition: { ...state.definition, lookup }, dirty: true }));
      const sheetChanged = lookup.sheetName !== before.sheetName || lookup.headerRow !== before.headerRow;
      if (get().lookupStatus !== "idle" && get().lookupSheets.length && sheetChanged) {
        lookupToken += 1;
        return loadLookupTableInto(lookup.sheetName, lookup.headerRow || 1, lookupToken);
      }
      return reloadMainTable();
    },

    /** Forget the lookup file and switch the merge off. */
    clearLookup: async () => {
      lookupToken += 1;
      engine.disposeDataset(LOOKUP_DATASET).catch(() => {});
      set((state) => ({
        ...emptyLookup(),
        definition: { ...state.definition, lookup: { ...state.definition.lookup, enabled: false } },
        dirty: true,
      }));
      return reloadMainTable();
    },

    /** Apply the user's answers from the "Fix mapping" screen. map = { missingName: actualColumnName | "" }. */
    resolveColumnFix: (map) => {
      commit(null, (definition) => remapColumnRefs(definition, map || {}));
      set({ columnFix: null });
    },
    dismissColumnFix: () => set({ columnFix: null }),

    /* ---------------- definition ---------------- */
    definition: createDefinition(),
    past: [],
    future: [],
    dirty: false, // true when the definition changed since it was last saved as a template
    templateId: null, // the template this workflow came from (enables "Update template")
    templateName: "",
    draftRestored: false,

    /** Generic, undoable definition change: recipe(definition) => newDefinition. */
    updateDefinition: (recipe, tag = null) => commit(tag, recipe),

    setDefinition: (definition) => commit(null, () => normalizeDefinition(definition)),

    undo: () => {
      const state = get();
      if (!state.past.length) return;
      const previous = state.past[state.past.length - 1];
      lastCommit = { tag: null, at: 0 };
      set({
        definition: { ...previous, source: state.definition.source, lookup: state.definition.lookup },
        past: state.past.slice(0, -1),
        future: [state.definition, ...state.future].slice(0, HISTORY_LIMIT),
        dirty: true,
      });
    },

    redo: () => {
      const state = get();
      if (!state.future.length) return;
      const next = state.future[0];
      lastCommit = { tag: null, at: 0 };
      set({
        definition: { ...next, source: state.definition.source, lookup: state.definition.lookup },
        past: [...state.past, state.definition].slice(-HISTORY_LIMIT),
        future: state.future.slice(1),
        dirty: true,
      });
    },

    /* fields */

    /** Add an output field. Returns the new field id. */
    addField: (overrides = {}) => {
      const field = createField(overrides);
      commit(null, (definition) => {
        const names = definition.fields.map((f) => f.name);
        const base = field.name || field.source.column || `Field ${definition.fields.length + 1}`;
        return { ...definition, fields: [...definition.fields, { ...field, name: uniqueName(base, names) }] };
      });
      return field.id;
    },

    /** Add one field per source column that is not already mapped 1:1. Returns how many were added. */
    autoMapFields: () => {
      const state = get();
      const columns = selectAvailableColumns(state);
      const mapped = new Set(
        state.definition.fields.filter((f) => f.source.kind === "column").map((f) => normalizeName(f.source.column)),
      );
      const toAdd = columns.filter((column) => !mapped.has(normalizeName(column.name)));
      if (!toAdd.length) return 0;
      commit(null, (definition) => {
        const names = definition.fields.map((f) => f.name);
        const added = toAdd.map((column) => {
          const name = uniqueName(column.name, names);
          names.push(name);
          return createField({ name, source: { kind: "column", column: column.name } });
        });
        return { ...definition, fields: [...definition.fields, ...added] };
      });
      return toAdd.length;
    },

    /** patch is shallow-merged; patch.source is merged into field.source. */
    updateField: (fieldId, patch) => {
      const keys = Object.keys(patch || {}).concat(Object.keys((patch && patch.source) || {})).join(",");
      commit(`field:${fieldId}:${keys}`, (definition) =>
        mapField(definition, fieldId, (field) => ({
          ...field,
          ...patch,
          source: patch && patch.source ? { ...field.source, ...patch.source } : field.source,
        })),
      );
    },

    removeField: (fieldId) => commit(null, (definition) => removeFieldEverywhere(definition, fieldId)),

    duplicateField: (fieldId) => {
      const id = createId("fld");
      commit(null, (definition) => {
        const index = definition.fields.findIndex((field) => field.id === fieldId);
        if (index < 0) return definition;
        const original = definition.fields[index];
        const copy = {
          ...clone(original),
          id,
          name: uniqueName(`${original.name} copy`, definition.fields.map((f) => f.name)),
          transforms: original.transforms.map((t) => ({ ...t, id: createId("tr") })),
        };
        const fields = definition.fields.slice();
        fields.splice(index + 1, 0, copy);
        return { ...definition, fields };
      });
      return id;
    },

    /** Move a field to a new index (0-based). */
    moveField: (fieldId, toIndex) =>
      commit(null, (definition) => {
        const from = definition.fields.findIndex((field) => field.id === fieldId);
        const fields = move(definition.fields, from, toIndex);
        return fields === definition.fields ? definition : { ...definition, fields };
      }),

    /* transforms */

    /** Append a transform to a field. Returns the new transform id. */
    addTransform: (fieldId, type, overrides = {}) => {
      const transform = createTransform(type, overrides);
      commit(null, (definition) =>
        mapField(definition, fieldId, (field) => ({ ...field, transforms: [...field.transforms, transform] })),
      );
      return transform.id;
    },

    updateTransform: (fieldId, transformId, patch) =>
      commit(`transform:${transformId}:${Object.keys(patch || {}).join(",")}`, (definition) =>
        mapField(definition, fieldId, (field) => ({
          ...field,
          transforms: field.transforms.map((t) => (t.id === transformId ? { ...t, ...patch } : t)),
        })),
      ),

    removeTransform: (fieldId, transformId) =>
      commit(null, (definition) =>
        mapField(definition, fieldId, (field) => ({
          ...field,
          transforms: field.transforms.filter((t) => t.id !== transformId),
        })),
      ),

    /** direction: -1 (earlier) or 1 (later). */
    moveTransform: (fieldId, transformId, direction) =>
      commit(null, (definition) =>
        mapField(definition, fieldId, (field) => {
          const from = field.transforms.findIndex((t) => t.id === transformId);
          const transforms = move(field.transforms, from, from + direction);
          return transforms === field.transforms ? field : { ...field, transforms };
        }),
      ),

    /* filters, grouping, sort (workflow level) */

    setFilters: (group) => commit("filters", (definition) => ({ ...definition, filters: group })),
    setGroupBy: (groupBy) => commit("groupBy", (definition) => ({ ...definition, groupBy })),
    setSort: (rules) => commit("sort", (definition) => ({ ...definition, sort: rules })),

    /** Data cleaning options. patch is merged; patch.removeDuplicates and patch.fillBlanks are merged one level deep. */
    setCleaning: (patch) => {
      const p = patch || {};
      const keys = Object.keys(p)
        .concat(Object.keys(p.removeDuplicates || {}), Object.keys(p.fillBlanks || {}))
        .join(",");
      commit(`cleaning:${keys}`, (definition) => ({
        ...definition,
        cleaning: {
          ...definition.cleaning,
          ...p,
          removeDuplicates: { ...definition.cleaning.removeDuplicates, ...(p.removeDuplicates || {}) },
          fillBlanks: { ...definition.cleaning.fillBlanks, ...(p.fillBlanks || {}) },
        },
      }));
    },

    /* outputs */

    /** Add an output. Returns the new output id. */
    addOutput: (overrides = {}) => {
      const output = createOutput(overrides);
      commit(null, (definition) => {
        const names = definition.outputs.map((o) => o.name);
        const base = overrides.name || `Output ${definition.outputs.length + 1}`;
        return { ...definition, outputs: [...definition.outputs, { ...output, name: uniqueName(base, names) }] };
      });
      return output.id;
    },

    /** patch is shallow-merged; patch.report and patch.overrides.{filters,sort,groupBy} are merged one level deep. */
    updateOutput: (outputId, patch) => {
      const p = patch || {};
      const keys = Object.keys(p)
        .concat(Object.keys(p.report || {}), Object.keys(p.overrides || {}))
        .join(",");
      commit(`output:${outputId}:${keys}`, (definition) =>
        mapOutput(definition, outputId, (output) => ({
          ...output,
          ...p,
          report: p.report ? { ...output.report, ...p.report } : output.report,
          overrides: p.overrides
            ? {
                filters: { ...output.overrides.filters, ...(p.overrides.filters || {}) },
                sort: { ...output.overrides.sort, ...(p.overrides.sort || {}) },
                groupBy: { ...output.overrides.groupBy, ...(p.overrides.groupBy || {}) },
              }
            : output.overrides,
        })),
      );
    },

    removeOutput: (outputId) =>
      commit(null, (definition) => ({
        ...definition,
        outputs: definition.outputs.filter((output) => output.id !== outputId),
      })),

    duplicateOutput: (outputId) => {
      const id = createId("out");
      commit(null, (definition) => {
        const index = definition.outputs.findIndex((output) => output.id === outputId);
        if (index < 0) return definition;
        const original = definition.outputs[index];
        const copy = {
          ...clone(original),
          id,
          name: uniqueName(`Copy of ${original.name}`, definition.outputs.map((o) => o.name)),
        };
        const outputs = definition.outputs.slice();
        outputs.splice(index + 1, 0, copy);
        return { ...definition, outputs };
      });
      return id;
    },

    /** direction: -1 (earlier) or 1 (later). */
    moveOutput: (outputId, direction) =>
      commit(null, (definition) => {
        const from = definition.outputs.findIndex((output) => output.id === outputId);
        const outputs = move(definition.outputs, from, from + direction);
        return outputs === definition.outputs ? definition : { ...definition, outputs };
      }),

    /* ---------------- templates and drafts ---------------- */

    /**
     * Load a template's definition into the workflow.
     * mode 'use': start from Upload (or Mapping when a file is already loaded, re-reading it with the template's sheet settings).
     * mode 'edit': open the Mapping step without needing a file (columns come from expectedColumns).
     */
    applyTemplate: (template, { mode = "use" } = {}) => {
      if (!template || !template.definition) return;
      const definition = normalizeDefinition(clone(template.definition));
      const state = get();
      const hasFile = state.sheets.length > 0;
      lastCommit = { tag: null, at: 0 };
      set({
        definition,
        past: [],
        future: [],
        dirty: false,
        templateId: template.id || null,
        templateName: template.name || "",
        columnFix: null,
        step: mode === "edit" || hasFile ? 1 : 0,
      });
      if (state.lookupSheets.length && isLookupConfigured(definition.lookup)) {
        // Re-read the already loaded lookup file with the template's settings; that also re-joins the main table.
        lookupToken += 1;
        const [sheetName] = pickSheets(state.lookupSheets, definition.lookup.sheetName ? [definition.lookup.sheetName] : []);
        loadLookupTableInto(sheetName, definition.lookup.headerRow || 1, lookupToken);
      } else if (hasFile) {
        loadToken += 1;
        loadTableInto(pickSheets(state.sheets, definition.source.sheetNames), definition.source.headerRow, loadToken);
      }
    },

    /** Call after saving the current definition as a template. */
    markTemplateSaved: ({ id, name }) => set({ templateId: id || null, templateName: name || "", dirty: false }),

    /** Change which template this workflow is linked to (after a rename or delete) without touching `dirty`. */
    setTemplateLink: ({ id, name }) => set({ templateId: id || null, templateName: name || "" }),

    /** Start over with an empty definition. keepData=false also forgets the loaded file. */
    resetWorkflow: ({ keepData = true } = {}) => {
      lastCommit = { tag: null, at: 0 };
      const state = get();
      const source = keepData
        ? {
            sheetNames: state.definition.source.sheetNames,
            headerRow: state.definition.source.headerRow,
            expectedColumns: state.columns.map(({ name, type }) => ({ name, type })),
          }
        : undefined;
      set({
        definition: createDefinition(source ? { source } : {}),
        past: [],
        future: [],
        dirty: false,
        templateId: null,
        templateName: "",
        columnFix: null,
        draftRestored: false,
        step: 0,
      });
      if (!keepData) {
        lookupToken += 1;
        engine.disposeDataset(LOOKUP_DATASET).catch(() => {});
        set(emptyLookup());
        get().clearData();
      }
    },

    /** The part of the state that is autosaved. Definition only: never data. */
    getDraft: () => {
      const state = get();
      return {
        definition: state.definition,
        templateId: state.templateId,
        templateName: state.templateName,
        dirty: state.dirty,
        savedAt: new Date().toISOString(),
      };
    },

    /** Restore an autosaved draft (ignored when the user already started working). Returns true when applied. */
    restoreDraft: (draft) => {
      const state = get();
      if (!draft || !draft.definition || state.dirty || state.definition.fields.length || state.sheets.length) {
        return false;
      }
      const definition = normalizeDefinition(draft.definition);
      const hasContent = definition.fields.length > 0 || definition.outputs.length > 0;
      set({
        definition,
        templateId: draft.templateId || null,
        templateName: draft.templateName || "",
        dirty: Boolean(draft.dirty),
        draftRestored: hasContent,
      });
      return hasContent;
    },

    dismissDraftNotice: () => set({ draftRestored: false }),
  };
});

/* ------------------------------------------------------------------ */
/* selectors and hooks                                                  */
/* ------------------------------------------------------------------ */

/** True when a table is loaded in the worker and previews/exports can run. */
export const selectHasData = (state) => state.status === "ready";

export const selectIsBusy = (state) => state.status === "parsing" || state.status === "loading";

/**
 * Source columns to offer in the UI: the loaded file's columns, or the template's
 * expected columns when no file is loaded (editing a template). Returns a stable reference.
 */
export const selectAvailableColumns = (state) =>
  state.columns.length ? state.columns : state.definition.source.expectedColumns;

/** True when the workflow expects a lookup file that has not been loaded yet. */
export const selectLookupNeeded = (state) => isLookupConfigured(state.definition.lookup) && state.lookupStatus !== "ready";

export const selectCanUndo = (state) => state.past.length > 0;
export const selectCanRedo = (state) => state.future.length > 0;

/**
 * Which wizard steps can be opened right now.
 * @returns {{ id, label, description, index, enabled: boolean, reason: string }[]}
 */
export function getStepStates({ hasData, hasColumns, fieldCount, outputCount }) {
  return STEPS.map((step, index) => {
    let enabled = true;
    let reason = "";
    if (index === 1 && !hasColumns) {
      enabled = false;
      reason = "Upload a file first";
    } else if (index === 2 && !fieldCount) {
      enabled = false;
      reason = "Add at least one field in Mapping";
    } else if (index === 3) {
      if (!hasData) {
        enabled = false;
        reason = "Upload a file to export";
      } else if (!fieldCount) {
        enabled = false;
        reason = "Add at least one field in Mapping";
      } else if (!outputCount) {
        enabled = false;
        reason = "Add at least one output";
      }
    }
    return { ...step, index, enabled, reason };
  });
}

export function useStepStates() {
  const hasData = useWorkflowStore(selectHasData);
  const hasColumns = useWorkflowStore((state) => selectAvailableColumns(state).length > 0);
  const fieldCount = useWorkflowStore((state) => state.definition.fields.length);
  const outputCount = useWorkflowStore((state) => state.definition.outputs.length);
  return useMemo(
    () => getStepStates({ hasData, hasColumns, fieldCount, outputCount }),
    [hasData, hasColumns, fieldCount, outputCount],
  );
}
