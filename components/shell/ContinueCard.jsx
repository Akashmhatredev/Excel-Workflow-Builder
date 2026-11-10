"use client";

import { ArrowRight, History } from "lucide-react";
import { Badge, Card } from "@/components/ui";
import ButtonLink from "@/components/ui/ButtonLink";
import { STEPS, useWorkflowStore } from "@/store/useWorkflowStore";

function plural(count, word) {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

/**
 * "Continue where you left off": shown on the landing page while the workflow
 * store holds a draft in progress (fields or outputs present). The draft is
 * restored after hydration by StorageBridge, so this renders nothing on the
 * server and on the first client render.
 */
export default function ContinueCard() {
  const fieldCount = useWorkflowStore((state) => state.definition.fields.length);
  const outputCount = useWorkflowStore((state) => state.definition.outputs.length);
  const templateName = useWorkflowStore((state) => state.templateName);
  const dirty = useWorkflowStore((state) => state.dirty);
  const fileName = useWorkflowStore((state) => (state.file ? state.file.name : ""));
  const step = useWorkflowStore((state) => state.step);

  if (!fieldCount && !outputCount) return null;

  const title = templateName.trim() || "Untitled workflow";
  const current = STEPS[step] || STEPS[0];

  return (
    <Card as="section" aria-labelledby="continue-heading" className="animate-fade-in p-4 sm:p-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <span
            aria-hidden="true"
            className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-brand-soft text-brand-soft-fg"
          >
            <History className="size-5" />
          </span>
          <div className="min-w-0">
            <h2 id="continue-heading" className="text-sm font-medium text-muted">
              Continue where you left off
            </h2>
            <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="min-w-0 text-base font-semibold break-words text-fg">{title}</span>
              {dirty ? <Badge tone="warning">Unsaved changes</Badge> : null}
            </p>
            <p className="mt-1 text-sm text-muted">
              {plural(fieldCount, "field")}, {plural(outputCount, "output")}. Step {step + 1} of {STEPS.length}:{" "}
              {current.label}.
            </p>
            <p className="mt-0.5 text-sm break-words text-muted">
              {fileName ? `${fileName} is loaded.` : "No file is loaded: add it again to preview and export."}
            </p>
          </div>
        </div>
        <ButtonLink href="/workflow" variant="primary" iconRight={ArrowRight} className="sm:shrink-0">
          Continue workflow
        </ButtonLink>
      </div>
    </Card>
  );
}
