/** Pure helpers for the Data cleaning section. */

import { plural } from "@/components/upload/format";

/** "12 duplicates removed, 4 blanks filled" from runPreview's stats, or "" when nothing changed. */
export function describeCleaningStats(stats) {
  if (!stats) return "";
  const parts = [];
  if (stats.duplicatesRemoved) parts.push(`${plural(stats.duplicatesRemoved, "duplicate")} removed`);
  if (stats.emptyRowsRemoved) parts.push(`${plural(stats.emptyRowsRemoved, "empty row")} removed`);
  if (stats.blanksFilled) parts.push(`${plural(stats.blanksFilled, "blank")} filled`);
  return parts.join(", ");
}
