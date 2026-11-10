"use client";

import { ArrowDown, ArrowUp, ChevronDown, ChevronRight, Columns3, Combine, Copy, Sigma, Trash2 } from "lucide-react";
import { memo, useId } from "react";
import FieldEditor from "@/components/mapping/FieldEditor";
import IssueList from "@/components/mapping/IssueList";
import { sameIssues, worstLevel } from "@/components/mapping/issues";
import { Badge, IconButton, Input } from "@/components/ui";
import { cn } from "@/lib/cn";
import { useWorkflowStore } from "@/store/useWorkflowStore";

const SOURCE_ICONS = { column: Columns3, combine: Combine, formula: Sigma };
const NAME_CODES = /name/i;

function describeSource(source) {
  if (source.kind === "combine") return source.template ? `Combine: ${source.template}` : "Combine: empty template";
  if (source.kind === "formula") return source.expression ? `= ${source.expression}` : "Formula: empty";
  return source.column ? `from ${source.column}` : "No source column yet";
}

/** Moving a row re-inserts its DOM node, which drops keyboard focus: put it back on the same control. */
function refocus(fieldId, action) {
  requestAnimationFrame(() => {
    const row = document.querySelector(`[data-field-id="${fieldId}"]`);
    if (!row) return;
    const target =
      row.querySelector(`[data-action="${action}"]:not(:disabled)`) || row.querySelector("[data-action]:not(:disabled)");
    if (target) target.focus();
  });
}

/**
 * One output field. Collapsed it is a single line (name, source summary, reorder,
 * delete); expanded it also shows the source and transform editors.
 */
function FieldRow({ field, index, count, columns, issues, expanded, autoFocus, onToggle, onAdded }) {
  const updateField = useWorkflowStore((state) => state.updateField);
  const moveField = useWorkflowStore((state) => state.moveField);
  const duplicateField = useWorkflowStore((state) => state.duplicateField);
  const removeField = useWorkflowStore((state) => state.removeField);
  const panelId = useId();
  const issuesId = useId();

  const number = index + 1;
  const title = field.name.trim() ? `“${field.name.trim()}”` : `field ${number}`;
  const level = worstLevel(issues);
  const nameInvalid = !field.name.trim() || issues.some((issue) => issue.level === "error" && NAME_CODES.test(issue.code || ""));
  const sourceInvalid = issues.some((issue) => issue.level === "error" && !NAME_CODES.test(issue.code || ""));
  const SourceIcon = SOURCE_ICONS[field.source.kind] || Columns3;
  const transformCount = field.transforms.length;

  const move = (delta, action) => {
    moveField(field.id, index + delta);
    refocus(field.id, action);
  };
  const duplicate = () => onAdded(duplicateField(field.id));
  const remove = () => removeField(field.id);

  return (
    <li
      data-field-id={field.id}
      className={cn(
        "rounded-lg border bg-surface",
        level === "error" ? "border-danger" : level === "warning" ? "border-warning" : "border-line",
      )}
    >
      <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 p-1.5 @lg:flex-nowrap">
        <IconButton
          label={expanded ? `Collapse ${title}` : `Edit ${title}`}
          icon={expanded ? ChevronDown : ChevronRight}
          aria-expanded={expanded}
          aria-controls={expanded ? panelId : undefined}
          onClick={() => onToggle(field.id)}
        />
        <div className="min-w-0 flex-1 basis-[calc(100%-3rem)] @lg:w-48 @lg:flex-none @lg:basis-auto">
          <Input
            aria-label={`Output name of field ${number}`}
            aria-describedby={issues.length ? issuesId : undefined}
            placeholder="Output column name"
            autoComplete="off"
            autoFocus={autoFocus}
            invalid={nameInvalid}
            value={field.name}
            onChange={(event) => updateField(field.id, { name: event.target.value })}
          />
        </div>
        <div className="flex min-w-0 flex-1 basis-0 items-center gap-1.5 pl-2 text-sm text-muted @lg:pl-1">
          <SourceIcon className="size-4 shrink-0" aria-hidden="true" />
          <span className="truncate" title={describeSource(field.source)}>
            {describeSource(field.source)}
          </span>
          {transformCount ? (
            <Badge title={`${transformCount} ${transformCount === 1 ? "transform" : "transforms"}`}>
              +{transformCount}
              <span className="sr-only">{transformCount === 1 ? " transform" : " transforms"}</span>
            </Badge>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center">
          <IconButton
            label={`Move ${title} up`}
            icon={ArrowUp}
            data-action="up"
            disabled={index === 0}
            onClick={() => move(-1, "up")}
            className="@lg:size-8!"
          />
          <IconButton
            label={`Move ${title} down`}
            icon={ArrowDown}
            data-action="down"
            disabled={index === count - 1}
            onClick={() => move(1, "down")}
            className="@lg:size-8!"
          />
          <IconButton label={`Duplicate ${title}`} icon={Copy} onClick={duplicate} className="hidden! @lg:inline-flex! @lg:size-8!" />
          <IconButton label={`Delete ${title}`} icon={Trash2} variant="dangerGhost" onClick={remove} className="@lg:size-8!" />
        </div>
      </div>

      <IssueList id={issuesId} issues={issues} className="px-3 pb-2.5" />

      {expanded ? (
        <div id={panelId} className="border-t border-line p-3 sm:p-4">
          <FieldEditor field={field} columns={columns} sourceInvalid={sourceInvalid} onDuplicate={duplicate} onRemove={remove} />
        </div>
      ) : null}
    </li>
  );
}

export default memo(
  FieldRow,
  (previous, next) =>
    previous.field === next.field &&
    previous.index === next.index &&
    previous.count === next.count &&
    previous.columns === next.columns &&
    previous.expanded === next.expanded &&
    previous.autoFocus === next.autoFocus &&
    previous.onToggle === next.onToggle &&
    previous.onAdded === next.onAdded &&
    sameIssues(previous.issues, next.issues),
);
