"use client";

import { Columns3, Merge, Plus, Wand2 } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import CleaningEditor from "@/components/mapping/CleaningEditor";
import FieldList from "@/components/mapping/FieldList";
import FilterBuilder from "@/components/mapping/FilterBuilder";
import GroupByEditor from "@/components/mapping/GroupByEditor";
import IssueSummary from "@/components/mapping/IssueSummary";
import MappingToolbar from "@/components/mapping/MappingToolbar";
import ResultPanel from "@/components/mapping/ResultPanel";
import SortEditor from "@/components/mapping/SortEditor";
import { countIssues, groupMappingIssues, NO_ISSUES, toColumnIssues } from "@/components/mapping/issues";
import { useUndoShortcuts } from "@/components/mapping/useUndoShortcuts";
import { plural } from "@/components/upload/format";
import { Button, Card, EmptyState, Notice, SectionHeader } from "@/components/ui";
import { usePreview } from "@/hooks/usePreview";
import { getResultColumns, isGroupingActive } from "@/lib/schema";
import { toast } from "@/lib/toast";
import { validateDefinition } from "@/lib/validate";
import { selectAvailableColumns, selectLookupNeeded, useWorkflowStore } from "@/store/useWorkflowStore";

function validateSafely(definition, columns) {
  try {
    const issues = validateDefinition(definition, columns);
    return Array.isArray(issues) ? issues : NO_ISSUES;
  } catch {
    return NO_ISSUES;
  }
}

/**
 * Step 2: shape the output. Fields (rename, combine, formula, transforms), then
 * filters, cleaning, grouping and sorting, with a live preview and a summary of the result. Works without
 * a loaded file too (editing a template): the columns then come from the template.
 */
export default function MappingStep() {
  const definition = useWorkflowStore((state) => state.definition);
  const columns = useWorkflowStore(selectAvailableColumns);
  const addField = useWorkflowStore((state) => state.addField);
  const autoMapFields = useWorkflowStore((state) => state.autoMapFields);
  const setFilters = useWorkflowStore((state) => state.setFilters);
  const setGroupBy = useWorkflowStore((state) => state.setGroupBy);
  const setSort = useWorkflowStore((state) => state.setSort);
  const setCleaning = useWorkflowStore((state) => state.setCleaning);
  const lookupNeeded = useWorkflowStore(selectLookupNeeded);
  const setStep = useWorkflowStore((state) => state.setStep);
  const preview = usePreview({ outputId: null, limit: 20 });
  useUndoShortcuts();

  const [expanded, setExpanded] = useState(() => new Set());
  const [lastAddedId, setLastAddedId] = useState(null);

  const fields = definition.fields;
  const localIssues = useMemo(() => validateSafely(definition, columns), [definition, columns]);
  // With a file loaded the worker's issues win: they add what only shows up when the rows are processed.
  const rawIssues = preview.data && Array.isArray(preview.data.issues) ? preview.data.issues : localIssues;
  const issues = useMemo(() => groupMappingIssues(rawIssues, definition), [rawIssues, definition]);
  const columnIssues = useMemo(() => toColumnIssues(issues), [issues]);
  const counts = useMemo(() => countIssues(issues.all), [issues]);
  const sortOptions = useMemo(() => getResultColumns(definition, null), [definition]);
  const grouping = isGroupingActive(definition.groupBy);

  const toggle = useCallback((id) => {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  /** Open a field that was just created and move focus to its name. */
  const reveal = useCallback((id) => {
    if (!id) return;
    setExpanded((current) => new Set(current).add(id));
    setLastAddedId(id);
  }, []);

  const handleAddField = () => reveal(addField());

  const handleMapAll = () => {
    const added = autoMapFields();
    if (added) toast.success(`Added ${plural(added, "field")}`, { description: "One for each source column that was not mapped yet." });
    else toast.info("Every source column is already mapped");
  };

  const allExpanded = fields.length > 0 && fields.every((field) => expanded.has(field.id));

  return (
    <div className="@container">
      <div className="flex flex-col gap-5">
        <div className="flex flex-col gap-3">
          <MappingToolbar canMapAll={columns.length > 0} onMapAll={handleMapAll} onAddField={handleAddField} />
          <IssueSummary fieldCount={fields.length} errors={counts.errors} warnings={counts.warnings} general={issues.general} />
          {lookupNeeded ? (
            <Notice
              tone="warning"
              icon={Merge}
              title="This workflow merges a second file"
              actions={
                <Button variant="secondary" size="sm" onClick={() => setStep(0)}>
                  Add it in Upload
                </Button>
              }
            >
              It matches rows on “{definition.lookup.matchColumn}”. The columns it brings in are missing from the preview until
              that file is added on the Upload step.
            </Notice>
          ) : null}
        </div>

        <div className="grid grid-cols-1 gap-5 @5xl:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] @5xl:items-start">
          <div className="flex min-w-0 flex-col gap-5">
            <Card as="section" className="flex flex-col gap-4 p-4 sm:p-5">
              <SectionHeader
                title="Fields"
                description="Each field becomes one column of your output files, in this order."
                actions={
                  fields.length > 1 ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setExpanded(allExpanded ? new Set() : new Set(fields.map((field) => field.id)))}
                    >
                      {allExpanded ? "Collapse all" : "Expand all"}
                    </Button>
                  ) : null
                }
              />
              {fields.length ? (
                <>
                  {grouping ? (
                    <p className="text-xs text-muted">
                      Grouping is on, so the result shows only the group-by fields and the aggregations. The other fields can
                      still be used in filters and aggregations.
                    </p>
                  ) : null}
                  <FieldList
                    fields={fields}
                    columns={columns}
                    issuesByField={issues.byField}
                    expanded={expanded}
                    lastAddedId={lastAddedId}
                    onToggle={toggle}
                    onAdded={reveal}
                  />
                  <div>
                    <Button variant="secondary" size="sm" icon={Plus} onClick={handleAddField}>
                      Add field
                    </Button>
                  </div>
                </>
              ) : (
                <EmptyState
                  icon={Columns3}
                  title="No fields yet"
                  description={
                    columns.length
                      ? "Map every source column in one click and then trim the list, or add the fields you need one by one."
                      : "Upload a file to map its columns in one click, or add fields by hand."
                  }
                  action={
                    <div className="flex flex-wrap justify-center gap-2">
                      <Button variant="primary" icon={Wand2} onClick={handleMapAll} disabled={!columns.length}>
                        Map all columns
                      </Button>
                      <Button variant="secondary" icon={Plus} onClick={handleAddField}>
                        Add field
                      </Button>
                    </div>
                  }
                />
              )}
            </Card>

            <Card as="section" className="flex flex-col gap-4 p-4 sm:p-5">
              <SectionHeader
                title="Filters"
                description="Keep only the rows that match. Outputs use these filters unless they set their own."
              />
              <FilterBuilder
                value={definition.filters}
                onChange={setFilters}
                columns={columns}
                fields={fields}
                issues={issues.filters}
              />
            </Card>

            <Card as="section" className="flex flex-col gap-4 p-4 sm:p-5">
              <SectionHeader
                title="Data cleaning"
                description="Tidy the rows after the filters and before grouping: spaces, empty rows, duplicates and blanks."
              />
              <CleaningEditor
                value={definition.cleaning}
                onChange={setCleaning}
                fields={fields}
                stats={(preview.data && preview.data.stats) ?? null}
                hasData={preview.hasData}
                loading={preview.loading}
              />
            </Card>

            <Card as="section" className="flex flex-col gap-4 p-4 sm:p-5">
              <SectionHeader title="Group and aggregate" description="Summarise the rows: totals, counts and averages per group." />
              <GroupByEditor value={definition.groupBy} onChange={setGroupBy} fields={fields} issues={issues.groupBy} />
            </Card>

            <Card as="section" className="flex flex-col gap-4 p-4 sm:p-5">
              <SectionHeader title="Sort" description="The order of the rows in the result. Empty values always come last." />
              <SortEditor value={definition.sort} onChange={setSort} options={sortOptions} issues={issues.sort} />
            </Card>
          </div>

          <ResultPanel
            preview={preview}
            fields={fields}
            columnIssues={columnIssues}
            onGoToUpload={() => setStep(0)}
            className="@5xl:sticky @5xl:top-[var(--ewb-sticky-top,5rem)]"
          />
        </div>
      </div>
    </div>
  );
}
