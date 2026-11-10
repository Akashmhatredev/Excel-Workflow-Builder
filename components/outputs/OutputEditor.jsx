"use client";

import { Copy, Trash2 } from "lucide-react";
import { useMemo } from "react";
import { Button, Card, Field, Input, SectionHeader, Segmented } from "@/components/ui";
import { usePreview } from "@/hooks/usePreview";
import {
  FILE_TYPES,
  getResultColumns,
  isGroupingActive,
  outputFileName,
  resolveOutputConfig,
  sanitizeSheetName,
} from "@/lib/schema";
import { validateDefinition } from "@/lib/validate";
import { selectAvailableColumns, useWorkflowStore } from "@/store/useWorkflowStore";
import FieldPicker from "./FieldPicker";
import { issuesForOutput, sortIssues } from "./helpers";
import OutputPreview from "./OutputPreview";
import OverridesSection from "./OverridesSection";
import ReportSettings from "./ReportSettings";

const PREVIEW_ROWS = 20;
const FILE_TYPE_OPTIONS = Object.entries(FILE_TYPES).map(([value, spec]) => ({ value, label: spec.label }));
const NONE = [];

function FileSettings({ output, sameFileName, onChange }) {
  const sheetName = sanitizeSheetName(output.sheetName);
  const sheetChanged = sheetName !== output.sheetName;
  const nameMissing = !output.name.trim();
  return (
    <Card as="section" className="p-4 sm:p-5">
      <SectionHeader as="h4" title="File" description="What this output is called and how it is saved." />
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <Field
          label="Output name"
          required
          error={nameMissing ? "Give this output a name. It becomes the file name." : undefined}
          hint={
            sameFileName
              ? "Another output produces the same file name. The zip adds a number to tell them apart."
              : "Shown in the list and used as the file name."
          }
        >
          {(p) => (
            <Input
              {...p}
              value={output.name}
              maxLength={120}
              autoComplete="off"
              onChange={(event) => onChange({ name: event.target.value })}
            />
          )}
        </Field>

        <div className="flex min-w-0 flex-col gap-1.5">
          <span className="text-sm font-medium text-fg">File type</span>
          <Segmented
            label="File type"
            className="self-start"
            options={FILE_TYPE_OPTIONS}
            value={output.fileType}
            onChange={(fileType) => onChange({ fileType })}
          />
        </div>

        {output.fileType === "xlsx" ? (
          <Field
            label="Sheet name"
            hint={
              sheetChanged
                ? `Excel does not allow this name as typed. The sheet will be called "${sheetName}".`
                : "Up to 31 characters, without \\ / ? * [ ] :"
            }
          >
            {(p) => (
              <Input
                {...p}
                value={output.sheetName}
                maxLength={60}
                autoComplete="off"
                onChange={(event) => onChange({ sheetName: event.target.value })}
              />
            )}
          </Field>
        ) : null}

        <div className="flex min-w-0 flex-col gap-1.5">
          <span className="text-sm font-medium text-fg">File name</span>
          <p className="flex min-h-10 items-center rounded-lg bg-surface-2 px-3 py-2 font-mono text-sm wrap-anywhere text-fg">
            {outputFileName(output)}
          </p>
        </div>
      </div>
    </Card>
  );
}

/** Everything about one output: file, fields, overrides, preview and the report image. */
export default function OutputEditor({ output, onDuplicate, onDelete }) {
  const definition = useWorkflowStore((state) => state.definition);
  const availableColumns = useWorkflowStore(selectAvailableColumns);
  const updateOutput = useWorkflowStore((state) => state.updateOutput);
  const setStep = useWorkflowStore((state) => state.setStep);

  // One worker run feeds both the table preview and the report image preview.
  const { enabled: reportEnabled, maxRows } = output.report;
  const limit = reportEnabled ? Math.max(PREVIEW_ROWS, maxRows) : PREVIEW_ROWS;
  const preview = usePreview({ outputId: output.id, limit });
  const { data, hasData } = preview;

  const resultColumns = useMemo(() => getResultColumns(definition, output), [definition, output]);
  const grouped = useMemo(
    () => isGroupingActive(resolveOutputConfig(definition, output).groupBy),
    [definition, output],
  );

  // With a file the engine reports issues (validation plus run-time ones). Without one, validate directly.
  const allIssues = useMemo(() => {
    if (data) return Array.isArray(data.issues) ? data.issues : NONE;
    if (hasData) return NONE;
    const found = validateDefinition(definition, availableColumns);
    return Array.isArray(found) ? found : NONE;
  }, [data, hasData, definition, availableColumns]);
  const issues = useMemo(() => sortIssues(issuesForOutput(allIssues, output.id)), [allIssues, output.id]);
  const columnIssues = useMemo(() => {
    const levels = {};
    for (const issue of allIssues) {
      if (!issue || issue.scope !== "field" || !issue.id) continue;
      for (const column of resultColumns) {
        if (column.fieldId !== issue.id || levels[column.key] === "error") continue;
        levels[column.key] = issue.level === "error" ? "error" : "warning";
      }
    }
    return levels;
  }, [allIssues, resultColumns]);
  const tableRows = useMemo(() => (data ? data.rows.slice(0, PREVIEW_ROWS) : NONE), [data]);

  const fileName = outputFileName(output).toLowerCase();
  const sameFileName = definition.outputs.some(
    (other) => other.id !== output.id && outputFileName(other).toLowerCase() === fileName,
  );
  const name = output.name.trim() || "Untitled output";

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <h3 className="min-w-0 truncate text-lg font-semibold text-fg">{name}</h3>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="secondary" size="sm" icon={Copy} className="max-sm:h-10" onClick={onDuplicate}>
            Duplicate
          </Button>
          <Button variant="dangerGhost" size="sm" icon={Trash2} className="max-sm:h-10" onClick={onDelete}>
            Delete
          </Button>
        </div>
      </div>

      <FileSettings
        output={output}
        sameFileName={sameFileName}
        onChange={(patch) => updateOutput(output.id, patch)}
      />
      <FieldPicker
        output={output}
        fields={definition.fields}
        grouped={grouped}
        resultColumns={resultColumns}
        onChange={(fieldIds) => updateOutput(output.id, { fieldIds })}
        onGoToMapping={() => setStep(1)}
      />
      <OverridesSection
        output={output}
        definition={definition}
        availableColumns={availableColumns}
        grouped={grouped}
        resultColumns={resultColumns}
        issues={issues}
        onChange={(overrides) => updateOutput(output.id, { overrides })}
      />
      <OutputPreview
        output={output}
        preview={preview}
        rows={tableRows}
        issues={issues}
        columnIssues={columnIssues}
        onGoToUpload={() => setStep(0)}
      />
      <ReportSettings
        output={output}
        resultColumns={resultColumns}
        preview={preview}
        onChange={(report) => updateOutput(output.id, { report })}
      />
    </div>
  );
}
