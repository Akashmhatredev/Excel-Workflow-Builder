import { MAX_IMPORT_BYTES, parseTemplateJson } from "@/lib/templates";
import { useTemplateStore } from "@/store/useTemplateStore";

/**
 * Import helpers for the Templates page (file picker and "Load the sample template").
 * Text goes through parseTemplateJson (validation + migration) and then
 * useTemplateStore.importTemplates (new ids, unique names, storage check).
 */

const formatSize = (bytes) =>
  bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;

/**
 * @returns {{ added: object[], errors: string[], warnings: string[], skipped: number }}
 *   added: the templates now in the store; errors: why nothing was added;
 *   warnings: notes about what was added (upgraded, or entries of a bundle that were skipped).
 */
export function importTemplateText(text) {
  const parsed = parseTemplateJson(text);
  if (!parsed.ok) return { added: [], errors: parsed.errors, warnings: [], skipped: 0 };
  const result = useTemplateStore.getState().importTemplates(parsed.templates);
  if (!result.ok) {
    return { added: [], errors: [result.error || "The templates could not be saved."], warnings: [], skipped: 0 };
  }
  return { added: result.added, errors: [], warnings: parsed.warnings, skipped: parsed.skipped || 0 };
}

/**
 * Import one or more .json files picked by the user.
 * @returns {Promise<{ added: object[], reports: { source: string, added: object[], errors: string[], warnings: string[], skipped: number }[] }>}
 */
export async function importTemplateFiles(files) {
  const reports = [];
  for (const file of files) {
    const source = file.name || "File";
    if (file.size > MAX_IMPORT_BYTES) {
      reports.push({
        source,
        added: [],
        errors: [
          `This file is too large to be a template (${formatSize(file.size)}; the limit is ${formatSize(MAX_IMPORT_BYTES)}). ` +
            "Templates hold settings only, never spreadsheet data.",
        ],
        warnings: [],
        skipped: 0,
      });
      continue;
    }
    let text;
    try {
      text = await file.text();
    } catch {
      reports.push({ source, added: [], errors: ["The file could not be read."], warnings: [], skipped: 0 });
      continue;
    }
    reports.push({ source, ...importTemplateText(text) });
  }
  return { added: reports.flatMap((report) => report.added), reports };
}
