import { APP_ID, SCHEMA_VERSION, normalizeDefinition, sanitizeFileName, validateTemplateShape } from "./schema";

/**
 * lib/templates.js (owner: Agent D). Minimal working version: see CONTRACTS.md for the contract.
 * Template migration, JSON export and JSON import (with validation).
 */

/** Upgrade a definition written by an older schema version. Never throws. */
export function migrateDefinition(definition) {
  return normalizeDefinition(definition);
}

/** Upgrade a template written by an older schema version. */
export function migrateTemplate(template) {
  return { ...template, schemaVersion: SCHEMA_VERSION, definition: migrateDefinition(template && template.definition) };
}

/** The JSON document written by "Export as JSON". */
export function serializeTemplate(template) {
  return {
    app: APP_ID,
    kind: "template",
    schemaVersion: SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    template,
  };
}

export function templateFileName(template) {
  return `${sanitizeFileName(template && template.name, "template")}.template.json`;
}

/**
 * Parse and validate imported JSON text.
 * @returns {{ ok: true, templates: object[], warnings: string[] } | { ok: false, errors: string[] }}
 */
export function parseTemplateJson(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    return { ok: false, errors: ["This file is not valid JSON."] };
  }
  const candidate = data && data.template ? data.template : data;
  const errors = validateTemplateShape(candidate);
  if (errors.length) return { ok: false, errors };
  return { ok: true, templates: [migrateTemplate(candidate)], warnings: [] };
}
