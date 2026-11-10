import {
  APP_ID,
  SCHEMA_VERSION,
  TRANSFORMS,
  createId,
  fieldColumnRefs,
  isLookupConfigured,
  normalizeDefinition,
  normalizeTags,
  sanitizeFileName,
  validateTemplateShape,
} from "./schema";

/**
 * lib/templates.js (owner: Agent D): template migration, JSON export and JSON import.
 *
 * A template holds a workflow *definition* only (sheet/header settings, expected
 * columns, mappings, transforms, filters, outputs, report styling). It never
 * contains spreadsheet data.
 *
 *   MIGRATIONS                         fromVersion -> (template) => template
 *   templateVersion(template)          schema version a template was written with (0 = before versioning)
 *   migrateTemplate(template)          upgrade + normalise a template. Never throws.
 *   migrateDefinition(definition, v?)  upgrade + normalise a bare definition (drafts). Never throws.
 *   serializeTemplate(template)        -> { app, kind: "template", schemaVersion, exportedAt, template }
 *   serializeTemplates(templates)      -> { app, kind: "template-bundle", schemaVersion, exportedAt, templates }
 *   templateFileName(template)         bundleFileName(date?)
 *   parseTemplateJson(text)            -> { ok: true, templates, warnings, skipped } | { ok: false, errors }
 *   cleanTemplateName(name)            cleanTemplateDescription(text)   cleanTemplateFolder(folder)
 *   columnUsage(definition, column)    -> string[]   where a source column is used ("Full name", "the workflow filter")
 *   templateFolders(templates)         -> string[]   folders in use, A-Z
 *   templateTags(templates)            -> { tag, count }[]   tags in use, most used first
 *   filterTemplates(templates, { query, folder, tags })      the Templates page filter (folder null = all, "" = none)
 *   groupTemplatesByFolder(templates)  -> { folder, templates }[]   named folders A-Z, then "" (no folder)
 *
 * Tags go through normalizeTags (lib/schema.js); `folder` is a single short label ("" = no folder).
 * Folders and tags compare case-insensitively.
 */

export const TEMPLATE_KIND = "template";
export const BUNDLE_KIND = "template-bundle";

/** Template files hold settings only, so anything bigger than this is not a template. */
export const MAX_IMPORT_BYTES = 2 * 1024 * 1024;
export const MAX_IMPORT_TEMPLATES = 200;
export const NAME_MAX_LENGTH = 80;
export const DESCRIPTION_MAX_LENGTH = 400;

const MAX_REPORTED_PROBLEMS = 20;
const FALLBACK_NAME = "Untitled template";

const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const isVersion = (value) => Number.isInteger(value) && value >= 0;

/* ------------------------------------------------------------------ */
/* small cleaners                                                       */
/* ------------------------------------------------------------------ */

/** Single-line, trimmed, length-capped template name ("" when nothing is left). */
export function cleanTemplateName(name) {
  return (typeof name === "string" ? name : name == null ? "" : String(name))
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, NAME_MAX_LENGTH)
    .trim();
}

export function cleanTemplateDescription(description) {
  return (typeof description === "string" ? description : "").trim().slice(0, DESCRIPTION_MAX_LENGTH);
}

/** Same rules as createTemplate in lib/schema.js: one line, trimmed, at most 40 characters. */
export function cleanTemplateFolder(folder) {
  return (typeof folder === "string" ? folder : "").replace(/\s+/g, " ").trim().slice(0, 40).trim();
}

function isoDate(value, fallback) {
  if (typeof value !== "string" || !value) return fallback;
  const time = Date.parse(value);
  return Number.isFinite(time) ? new Date(time).toISOString() : fallback;
}

/* ------------------------------------------------------------------ */
/* migrations                                                           */
/* ------------------------------------------------------------------ */

/**
 * v0 names for transforms that were renamed in v1.
 */
const V0_TRANSFORM_NAMES = { uppercase: "upper", lowercase: "lower", titlecase: "title", capitalize: "title" };

function upgradeV0Transform(transform) {
  if (typeof transform !== "string") return transform;
  const raw = transform.trim();
  const type = TRANSFORMS[raw] ? raw : V0_TRANSFORM_NAMES[raw.toLowerCase()] || raw;
  // An unknown name is kept as { type } so that import validation can name it.
  return TRANSFORMS[type] ? { id: createId("tr"), type, ...TRANSFORMS[type].defaults } : { id: createId("tr"), type };
}

/**
 * Version 0 -> 1. Version 0 is the format used before templates carried a
 * `schemaVersion`:
 *
 *   definition.mappings            -> definition.fields
 *   definition.sheetName: "Sales"  -> definition.source.sheetNames: ["Sales"]
 *   (also accepted as definition.source.sheetName)
 *   definition.headerRow           -> definition.source.headerRow
 *   transforms: ["trim", "uppercase"] -> [{ id, type: "trim" }, { id, type: "upper" }]
 *
 * Each change is applied only when the old shape is really there, so a template
 * that merely lacks a `schemaVersion` passes through untouched (same reference).
 */
function migrateV0ToV1(template) {
  const before = template.definition;
  if (!isObject(before)) return template;
  const definition = { ...before };
  let changed = false;

  if ("mappings" in definition) {
    if (definition.fields === undefined) definition.fields = definition.mappings;
    delete definition.mappings;
    changed = true;
  }

  const legacySheet =
    isObject(definition.source) && "sheetName" in definition.source ? definition.source.sheetName : definition.sheetName;
  const hasLegacySource =
    "sheetName" in definition || "headerRow" in definition || (isObject(definition.source) && "sheetName" in definition.source);
  if (hasLegacySource && (definition.source === undefined || isObject(definition.source))) {
    const source = { ...(definition.source || {}) };
    if (!Array.isArray(source.sheetNames)) {
      source.sheetNames = typeof legacySheet === "string" && legacySheet.trim() ? [legacySheet.trim()] : [];
    }
    if (source.headerRow === undefined && definition.headerRow !== undefined) source.headerRow = definition.headerRow;
    delete source.sheetName;
    delete definition.sheetName;
    delete definition.headerRow;
    definition.source = source;
    changed = true;
  }

  if (Array.isArray(definition.fields)) {
    let fieldsChanged = false;
    const fields = definition.fields.map((field) => {
      if (!isObject(field) || !Array.isArray(field.transforms)) return field;
      if (!field.transforms.some((transform) => typeof transform === "string")) return field;
      fieldsChanged = true;
      return { ...field, transforms: field.transforms.map(upgradeV0Transform) };
    });
    if (fieldsChanged) {
      definition.fields = fields;
      changed = true;
    }
  }

  return changed ? { ...template, definition } : template;
}

/**
 * The migration pipeline: MIGRATIONS[n] upgrades a template from schema version n
 * to n + 1. Steps run in sequence until SCHEMA_VERSION is reached, so adding a
 * version means adding exactly one entry here (and bumping SCHEMA_VERSION).
 *
 * Rules for a step: take a template, return a template; do not mutate the input;
 * return the *same* object when there is nothing to change; tolerate junk (the
 * input has not been validated yet).
 */
export const MIGRATIONS = {
  0: migrateV0ToV1,
};

/** The schema version a template was written with. Templates from before versioning have none: version 0. */
export function templateVersion(template, fallback = 0) {
  if (!isObject(template)) return fallback;
  if (isVersion(template.schemaVersion)) return template.schemaVersion;
  if (isObject(template.definition) && isVersion(template.definition.schemaVersion)) return template.definition.schemaVersion;
  return fallback;
}

/**
 * Run the migration steps (no normalising). Never throws.
 * @returns {{ template: object, from: number, changed: boolean }}
 */
function upgradeTemplate(template, fallbackVersion = 0) {
  const original = isObject(template) ? template : {};
  const from = templateVersion(original, isVersion(fallbackVersion) ? fallbackVersion : 0);
  let current = original;
  for (let version = from; version < SCHEMA_VERSION; version += 1) {
    const step = MIGRATIONS[version];
    if (typeof step !== "function") continue;
    try {
      const next = step(current);
      if (isObject(next)) current = next;
    } catch {
      // A failing step must not lose the template: validation / normalising deal with what is left.
    }
  }
  const changed = current !== original;
  if (from < SCHEMA_VERSION) current = { ...current, schemaVersion: SCHEMA_VERSION };
  return { template: current, from, changed };
}

/** Fill in every template property (and normalise the definition). Unknown top-level keys are dropped. */
function normalizeTemplate(template) {
  const t = isObject(template) ? template : {};
  const now = new Date().toISOString();
  const createdAt = isoDate(t.createdAt, isoDate(t.updatedAt, now));
  return {
    id: typeof t.id === "string" && t.id.trim() ? t.id.trim() : createId("tpl"),
    name: cleanTemplateName(t.name) || FALLBACK_NAME,
    description: cleanTemplateDescription(t.description),
    tags: normalizeTags(t.tags),
    folder: cleanTemplateFolder(t.folder),
    createdAt,
    updatedAt: isoDate(t.updatedAt, createdAt),
    schemaVersion: SCHEMA_VERSION,
    definition: normalizeDefinition(t.definition),
  };
}

/**
 * Upgrade a template written by an older schema version and fill in anything
 * that is missing. Never throws; a current, well-formed template comes back
 * with the same content.
 */
export function migrateTemplate(template) {
  try {
    return normalizeTemplate(upgradeTemplate(template).template);
  } catch {
    const t = isObject(template) ? template : {};
    const { id, name, description, tags, folder, createdAt, updatedAt } = t;
    return normalizeTemplate({ id, name, description, tags, folder, createdAt, updatedAt });
  }
}

/**
 * Upgrade a bare definition (for example the autosaved draft). `fromVersion`
 * overrides the version read from `definition.schemaVersion`. Never throws.
 */
export function migrateDefinition(definition, fromVersion) {
  try {
    const wrapped = { definition: isObject(definition) ? definition : {} };
    if (isVersion(fromVersion)) wrapped.schemaVersion = fromVersion;
    return normalizeDefinition(upgradeTemplate(wrapped).template.definition);
  } catch {
    return normalizeDefinition(null);
  }
}

/* ------------------------------------------------------------------ */
/* export                                                               */
/* ------------------------------------------------------------------ */

/** The JSON document written by "Export as JSON". */
export function serializeTemplate(template) {
  return {
    app: APP_ID,
    kind: TEMPLATE_KIND,
    schemaVersion: SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    template: migrateTemplate(template),
  };
}

/** Several templates in one file ("Export all"). parseTemplateJson reads it back. */
export function serializeTemplates(templates) {
  return {
    app: APP_ID,
    kind: BUNDLE_KIND,
    schemaVersion: SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    templates: (Array.isArray(templates) ? templates : []).filter(isObject).map(migrateTemplate),
  };
}

export function templateFileName(template) {
  return `${sanitizeFileName(template && template.name, "template")}.template.json`;
}

export function bundleFileName(date = new Date()) {
  const valid = date instanceof Date && Number.isFinite(date.getTime()) ? date : new Date();
  return `excel-workflow-templates-${valid.toISOString().slice(0, 10)}.json`;
}

/* ------------------------------------------------------------------ */
/* import                                                               */
/* ------------------------------------------------------------------ */

function describeValue(value) {
  if (value === null) return "null";
  if (Array.isArray(value)) return "a list";
  if (typeof value === "object") return "an object";
  if (typeof value === "string") return "text";
  if (typeof value === "boolean") return "true/false";
  return `a ${typeof value}`;
}

function quote(value) {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return `"${String(text).slice(0, 60)}"`;
}

function formatSize(bytes) {
  return bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function capProblems(problems) {
  if (problems.length <= MAX_REPORTED_PROBLEMS) return problems;
  const hidden = problems.length - MAX_REPORTED_PROBLEMS;
  return [...problems.slice(0, MAX_REPORTED_PROBLEMS), `...and ${hidden} more ${hidden === 1 ? "problem" : "problems"}.`];
}

const fail = (...errors) => ({ ok: false, errors: capProblems(errors.flat()) });

function newerVersionMessage(version, subject) {
  return (
    `${subject} was made with a newer version of the app (template format ${version}; this version reads up to format ${SCHEMA_VERSION}). ` +
    "Reload the app to get the latest version, then import the file again."
  );
}

/** Problems with a declared `schemaVersion` ([] when it is absent or usable). */
function versionProblems(value, where, subject = "This template") {
  if (value === undefined) return [];
  if (!isVersion(value)) return [`${where} must be a whole number (0 or more), but it is ${quote(value)}.`];
  if (value > SCHEMA_VERSION) return [newerVersionMessage(value, subject)];
  return [];
}

/**
 * Validate and upgrade one template candidate.
 * @returns {{ ok: true, template: object, upgraded: boolean } | { ok: false, errors: string[] }}
 */
function readCandidate(raw, envelopeVersion) {
  let candidate = raw;
  let fallbackVersion = envelopeVersion;

  // An entry of a bundle may itself be a complete single-template export.
  if (isObject(candidate) && candidate.template !== undefined && candidate.definition === undefined) {
    const problems = [...envelopeProblems(candidate), ...versionProblems(candidate.schemaVersion, '"schemaVersion"')];
    if (problems.length) return { ok: false, errors: problems };
    if (isVersion(candidate.schemaVersion)) fallbackVersion = candidate.schemaVersion;
    candidate = candidate.template;
  }

  if (!isObject(candidate)) {
    return { ok: false, errors: [`A template must be a JSON object, but this is ${describeValue(candidate)}.`] };
  }

  const declared = [
    ...versionProblems(candidate.schemaVersion, '"schemaVersion"'),
    ...versionProblems(isObject(candidate.definition) ? candidate.definition.schemaVersion : undefined, '"definition.schemaVersion"'),
  ];
  if (declared.length) return { ok: false, errors: [...new Set(declared)] };

  if (candidate.name === undefined && candidate.definition === undefined) {
    return {
      ok: false,
      errors: ['This does not look like a workflow template: it has no "name" and no "definition".'],
    };
  }

  const upgraded = upgradeTemplate(candidate, fallbackVersion);
  const errors = validateTemplateShape(upgraded.template);
  if (errors.length) return { ok: false, errors };
  return { ok: true, template: normalizeTemplate(upgraded.template), upgraded: upgraded.changed };
}

/** Problems with the `app` / `kind` markers of an export envelope ([] when absent or right). */
function envelopeProblems(data) {
  const problems = [];
  if (data.app !== undefined && data.app !== APP_ID) {
    problems.push(`This file was not made by Excel Workflow Builder (its "app" is ${quote(data.app)}, expected "${APP_ID}").`);
  }
  if (data.kind !== undefined && data.kind !== TEMPLATE_KIND && data.kind !== BUNDLE_KIND) {
    problems.push(`This file holds ${quote(data.kind)} data, not a template (its "kind" should be "${TEMPLATE_KIND}").`);
  }
  return problems;
}

function parseUnsafe(text) {
  if (typeof text !== "string") return fail("The file could not be read as text.");
  if (text.length > MAX_IMPORT_BYTES) {
    return fail(
      `This file is too large to be a template (${formatSize(text.length)}; the limit is ${formatSize(MAX_IMPORT_BYTES)}). ` +
        "Templates hold settings only, never spreadsheet data. Check that you picked a template .json file.",
    );
  }
  const body = text.replace(/^﻿/, "").trim();
  if (!body) return fail("The file is empty.");

  let data;
  try {
    data = JSON.parse(body);
  } catch (error) {
    const detail = error && typeof error.message === "string" && error.message ? ` (${error.message.slice(0, 160)})` : "";
    return fail(`This file is not valid JSON${detail}. Choose a .json file that was exported from the Templates page.`);
  }

  let entries;
  let isBundle = false;
  let envelopeVersion;

  if (Array.isArray(data)) {
    entries = data;
    isBundle = true;
  } else if (!isObject(data)) {
    return fail(`A template file must contain a JSON object, but this one contains ${describeValue(data)}.`);
  } else {
    const isEnvelope = data.template !== undefined || data.templates !== undefined;
    const problems = envelopeProblems(data);
    if (isEnvelope) problems.push(...versionProblems(data.schemaVersion, '"schemaVersion"', "This file"));
    if (problems.length) return fail(problems);

    if (data.templates !== undefined && data.definition === undefined && data.template === undefined) {
      if (!Array.isArray(data.templates)) {
        return fail(`"templates" must be a list of templates, but it is ${describeValue(data.templates)}.`);
      }
      entries = data.templates;
      isBundle = true;
      envelopeVersion = data.schemaVersion;
    } else if (data.template !== undefined && data.definition === undefined) {
      if (!isObject(data.template)) {
        return fail(`"template" must be an object, but it is ${describeValue(data.template)}.`);
      }
      entries = [data.template];
      envelopeVersion = data.schemaVersion;
    } else {
      entries = [data];
    }
  }

  if (!entries.length) return fail("This file contains no templates.");
  if (entries.length > MAX_IMPORT_TEMPLATES) {
    return fail(`This file contains ${entries.length} templates. At most ${MAX_IMPORT_TEMPLATES} can be imported at once.`);
  }

  if (!isBundle) {
    const result = readCandidate(entries[0], envelopeVersion);
    if (!result.ok) return fail(result.errors);
    const warnings = result.upgraded
      ? [`"${result.template.name}" was saved by an older version of the app and has been updated to the current format.`]
      : [];
    return { ok: true, templates: [result.template], warnings, skipped: 0 };
  }

  const templates = [];
  const problems = [];
  let upgradedCount = 0;
  let skipped = 0;
  entries.forEach((entry, index) => {
    const result = readCandidate(entry, envelopeVersion);
    if (result.ok) {
      templates.push(result.template);
      if (result.upgraded) upgradedCount += 1;
      return;
    }
    skipped += 1;
    const inner = isObject(entry) && isObject(entry.template) ? entry.template : entry;
    const name = isObject(inner) ? cleanTemplateName(inner.name) : "";
    const label = `Template ${index + 1}${name ? ` ("${name}")` : ""}`;
    for (const error of result.errors) problems.push(`${label}: ${error}`);
  });

  if (!templates.length) return fail(problems);

  const warnings = [];
  if (skipped) {
    warnings.push(
      `${skipped} of ${entries.length} templates ${skipped === 1 ? "was" : "were"} skipped because of problems:`,
      ...capProblems(problems),
    );
  }
  if (upgradedCount) {
    warnings.push(
      `${upgradedCount} ${upgradedCount === 1 ? "template was" : "templates were"} saved by an older version of the app and updated to the current format.`,
    );
  }
  return { ok: true, templates, warnings, skipped };
}

/**
 * Parse and validate imported JSON text. Accepts
 *   - the export format        { app, kind: "template", schemaVersion, exportedAt, template }
 *   - a bare template          { name, definition, ... }
 *   - a bundle                 { templates: [...] } (or a plain list of templates)
 * Older templates are migrated; templates from a newer schema version are refused.
 * In a bundle, valid templates are returned and broken ones are listed in `warnings`
 * (`skipped` says how many); the import only fails when nothing is usable.
 * Never throws.
 *
 * @returns {{ ok: true, templates: object[], warnings: string[], skipped: number } | { ok: false, errors: string[] }}
 */
export function parseTemplateJson(text) {
  try {
    return parseUnsafe(text);
  } catch {
    return fail("This file could not be read as a template.");
  }
}

/* ------------------------------------------------------------------ */
/* tags and folders (Templates page)                                    */
/* ------------------------------------------------------------------ */

/** Folder filter value for "templates without a folder" (the default `null` means every folder). */
export const NO_FOLDER = "";

const byText = (a, b) => a.localeCompare(b, undefined, { sensitivity: "base", numeric: true });
const folderOf = (template) => cleanTemplateFolder(isObject(template) ? template.folder : "");
const tagsOf = (template) => normalizeTags(isObject(template) ? template.tags : []);

/** The folders in use, A-Z. Folders are case-insensitive: the first spelling met is kept. */
export function templateFolders(templates) {
  const seen = new Map();
  for (const template of Array.isArray(templates) ? templates : []) {
    const folder = folderOf(template);
    if (folder && !seen.has(folder.toLowerCase())) seen.set(folder.toLowerCase(), folder);
  }
  return [...seen.values()].sort(byText);
}

/** The tags in use with how many templates carry each one: most used first, then A-Z. Case-insensitive. */
export function templateTags(templates) {
  const counts = new Map();
  for (const template of Array.isArray(templates) ? templates : []) {
    for (const tag of tagsOf(template)) {
      const key = tag.toLowerCase();
      const entry = counts.get(key);
      if (entry) entry.count += 1;
      else counts.set(key, { tag, count: 1 });
    }
  }
  return [...counts.values()].sort((a, b) => b.count - a.count || byText(a.tag, b.tag));
}

/**
 * The templates the Templates page shows, in the given order.
 *   query   matches name, description, tags and folder (case- and space-insensitive)
 *   folder  null = every folder, NO_FOLDER ("") = templates without a folder, otherwise that folder
 *   tags    the template must carry every one of them (case-insensitive)
 */
export function filterTemplates(templates, { query = "", folder = null, tags = [] } = {}) {
  const needle = String(query ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
  const wantedFolder = folder === null || folder === undefined ? null : cleanTemplateFolder(folder).toLowerCase();
  const wantedTags = normalizeTags(tags).map((tag) => tag.toLowerCase());
  return (Array.isArray(templates) ? templates : []).filter((template) => {
    if (!isObject(template)) return false;
    if (wantedFolder !== null && folderOf(template).toLowerCase() !== wantedFolder) return false;
    if (wantedTags.length) {
      const own = new Set(tagsOf(template).map((tag) => tag.toLowerCase()));
      if (!wantedTags.every((tag) => own.has(tag))) return false;
    }
    if (!needle) return true;
    const haystack = [template.name, template.description, ...tagsOf(template), folderOf(template)]
      .map((part) => String(part ?? ""))
      .join(" \u0000 ")
      .replace(/\s+/g, " ")
      .toLowerCase();
    return haystack.includes(needle);
  });
}

/**
 * Group templates by folder for display, keeping their order inside each group:
 * named folders A-Z first, then the templates without a folder (folder: "").
 * @returns {{ folder: string, templates: object[] }[]}
 */
export function groupTemplatesByFolder(templates) {
  const groups = new Map();
  for (const template of Array.isArray(templates) ? templates : []) {
    if (!isObject(template)) continue;
    const folder = folderOf(template);
    const key = folder.toLowerCase();
    if (!groups.has(key)) groups.set(key, { folder, templates: [] });
    groups.get(key).templates.push(template);
  }
  const named = [...groups.values()].filter((group) => group.folder).sort((a, b) => byText(a.folder, b.folder));
  const loose = groups.get("");
  return loose ? [...named, loose] : named;
}

/* ------------------------------------------------------------------ */
/* helpers for the UI                                                   */
/* ------------------------------------------------------------------ */

function filterGroupUses(group, columnName) {
  const rules = isObject(group) && Array.isArray(group.rules) ? group.rules : [];
  return rules.some((rule) => isObject(rule) && isObject(rule.target) && rule.target.kind === "column" && rule.target.ref === columnName);
}

/**
 * Where a source column is used in a definition, as short labels for the
 * "Fix mapping" dialog: output field names first, then filters and the lookup
 * (the same places collectColumnRefs in lib/schema.js reads).
 */
export function columnUsage(definition, columnName) {
  const def = isObject(definition) ? definition : {};
  const out = [];
  const add = (label) => {
    if (!out.includes(label)) out.push(label);
  };
  for (const field of Array.isArray(def.fields) ? def.fields : []) {
    if (!fieldColumnRefs(field).includes(columnName)) continue;
    const name = typeof field.name === "string" ? field.name.trim() : "";
    add(name || "an unnamed field");
  }
  if (filterGroupUses(def.filters, columnName)) add("the workflow filter");
  if (isLookupConfigured(def.lookup) && def.lookup.matchColumn === columnName) add("the lookup (match column)");
  for (const output of Array.isArray(def.outputs) ? def.outputs : []) {
    const override = isObject(output) && isObject(output.overrides) ? output.overrides.filters : null;
    if (isObject(override) && override.enabled && filterGroupUses(override.group, columnName)) {
      add(`the filter of output "${output.name || "Output"}"`);
    }
  }
  return out;
}
