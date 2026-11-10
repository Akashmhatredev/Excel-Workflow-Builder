"use client";

import { ArrowDown, ArrowUp, Plus } from "lucide-react";
import { Badge, Button, Card, IconButton, SectionHeader } from "@/components/ui";
import { cn } from "@/lib/cn";
import { outputFileName } from "@/lib/schema";
import { plural } from "./helpers";

/**
 * The master list of the Outputs step: one row per output (name, file type, report badge),
 * with reorder buttons. Selecting a row opens it in the editor.
 */
export default function OutputList({ outputs, selectedId, issueLevels, onSelect, onAdd, onMove }) {
  return (
    <Card as="section" aria-label="Outputs" className="p-3 sm:p-4">
      <SectionHeader
        as="h3"
        title="Outputs"
        description={`${plural(outputs.length, "file")} will be produced.`}
        actions={
          <Button variant="soft" size="sm" icon={Plus} onClick={onAdd} className="max-lg:h-10">
            Add output
          </Button>
        }
      />
      <ul className="mt-3 flex flex-col gap-2">
        {outputs.map((output, index) => {
          const selected = output.id === selectedId;
          const name = output.name.trim() || "Untitled output";
          const level = issueLevels ? issueLevels[output.id] : null;
          return (
            <li
              key={output.id}
              className={cn(
                "flex items-center gap-0.5 rounded-lg border pr-1 transition-colors",
                selected ? "border-brand bg-brand-soft" : "border-line bg-surface hover:bg-surface-2",
              )}
            >
              <button
                type="button"
                aria-current={selected ? "true" : undefined}
                onClick={() => onSelect(output.id)}
                className="flex min-h-12 min-w-0 flex-1 cursor-pointer flex-col items-start justify-center gap-1 rounded-lg px-3 py-2 text-left"
              >
                <span className="w-full truncate text-sm font-medium text-fg" title={outputFileName(output)}>
                  {name}
                </span>
                <span className="flex flex-wrap items-center gap-1">
                  <Badge tone="neutral">{output.fileType === "csv" ? "CSV" : "XLSX"}</Badge>
                  {output.report.enabled ? <Badge tone="brand">Report</Badge> : null}
                  {level === "error" ? <Badge tone="danger">Needs attention</Badge> : null}
                  {level === "warning" ? <Badge tone="warning">Warning</Badge> : null}
                </span>
              </button>
              <IconButton
                label={`Move ${name} up`}
                icon={ArrowUp}
                disabled={index === 0}
                data-focus-key={`output:${output.id}:up`}
                onClick={() => onMove(output.id, -1)}
              />
              <IconButton
                label={`Move ${name} down`}
                icon={ArrowDown}
                disabled={index === outputs.length - 1}
                data-focus-key={`output:${output.id}:down`}
                onClick={() => onMove(output.id, 1)}
              />
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
