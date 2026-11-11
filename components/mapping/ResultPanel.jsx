"use client";

import { useId, useMemo, useRef, useState } from "react";
import PreviewPanel from "@/components/mapping/PreviewPanel";
import SummaryPanel from "@/components/summary/SummaryPanel";
import { Card } from "@/components/ui";
import { cn } from "@/lib/cn";
import { useWorkflowStore } from "@/store/useWorkflowStore";

const TABS = [
  { id: "preview", label: "Preview" },
  { id: "summary", label: "Summary" },
];
const EMPTY = [];

/**
 * The right-hand side of the Mapping step: tabs "Preview | Summary".
 * Preview = the first rows of the result (optionally with problem cells highlighted);
 * Summary = a pivot of the rows. Only the open tab is mounted, so the pivot only runs while
 * it is shown. The pivot settings live in the workflow definition (`definition.summary`), so they
 * are undoable, autosaved with the draft and saved in templates; the highlight switch lives here.
 */
export default function ResultPanel({ preview, fields = EMPTY, columnIssues, onGoToUpload, className }) {
  const baseId = useId();
  const tabRefs = useRef([]);
  const [tab, setTab] = useState("preview");
  const [highlight, setHighlight] = useState(false);
  const pivot = useWorkflowStore((state) => state.definition.summary);
  const setSummary = useWorkflowStore((state) => state.setSummary);

  const previewColumns = preview.data && preview.data.columns;
  const types = useMemo(() => {
    const out = {};
    for (const column of previewColumns || EMPTY) if (column && column.key) out[column.key] = column.type;
    return out;
  }, [previewColumns]);

  const onKeyDown = (event, index) => {
    let next = -1;
    if (event.key === "ArrowRight") next = (index + 1) % TABS.length;
    else if (event.key === "ArrowLeft") next = (index - 1 + TABS.length) % TABS.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = TABS.length - 1;
    if (next < 0) return;
    event.preventDefault();
    setTab(TABS[next].id);
    const target = tabRefs.current[next];
    if (target) target.focus();
  };

  return (
    <Card as="section" aria-label="Result" className={cn("flex min-w-0 flex-col gap-4 p-4 sm:p-5", className)}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-base font-semibold text-fg">Result</h2>
        <div role="tablist" aria-label="Result view" className="inline-flex rounded-lg border border-line bg-surface-2 p-0.5">
          {TABS.map((item, index) => {
            const selected = item.id === tab;
            return (
              <button
                key={item.id}
                ref={(node) => {
                  tabRefs.current[index] = node;
                }}
                type="button"
                role="tab"
                id={`${baseId}-tab-${item.id}`}
                aria-selected={selected}
                aria-controls={`${baseId}-panel-${item.id}`}
                tabIndex={selected ? 0 : -1}
                onClick={() => setTab(item.id)}
                onKeyDown={(event) => onKeyDown(event, index)}
                className={cn(
                  "tap-target cursor-pointer rounded-md px-3.5 py-1.5 text-sm font-medium transition-colors duration-150",
                  selected ? "bg-surface-raised text-fg shadow-sm" : "text-muted usable-hover:text-fg",
                )}
              >
                {item.label}
              </button>
            );
          })}
        </div>
      </div>
      <div
        role="tabpanel"
        id={`${baseId}-panel-${tab}`}
        aria-labelledby={`${baseId}-tab-${tab}`}
        className="min-w-0 rounded-md focus-visible:outline-offset-2"
      >
        {tab === "preview" ? (
          <PreviewPanel
            preview={preview}
            fieldCount={fields.length}
            columnIssues={columnIssues}
            highlight={highlight}
            onHighlightChange={setHighlight}
            onGoToUpload={onGoToUpload}
          />
        ) : (
          <SummaryPanel
            settings={pivot}
            onSettingsChange={setSummary}
            fields={fields}
            types={types}
            onGoToUpload={onGoToUpload}
          />
        )}
      </div>
    </Card>
  );
}
