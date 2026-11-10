"use client";

import { ArrowLeft, ArrowRight, Check, ChevronDown, CircleAlert, Lock, RotateCcw } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import ExportStep from "@/components/ExportStep";
import MappingStep from "@/components/MappingStep";
import OutputsStep from "@/components/OutputsStep";
import FixMappingDialog from "@/components/templates/FixMappingDialog";
import SaveTemplateButton from "@/components/templates/SaveTemplateButton";
import { Badge, Button, ConfirmDialog, Notice } from "@/components/ui";
import ButtonLink from "@/components/ui/ButtonLink";
import UploadStep from "@/components/UploadStep";
import { cn } from "@/lib/cn";
import { toast } from "@/lib/toast";
import { selectHasData, useStepStates, useWorkflowStore } from "@/store/useWorkflowStore";

/**
 * Wizard (owner: Agent E): the frame around the four steps.
 *
 *   title row      workflow name, "unsaved changes", Save as template, Start over
 *   stepper        completed / current / upcoming, clickable, with a progress bar
 *                  (phones: "Step 2 of 4: Mapping" that expands into the list)
 *   step           heading (focus target on step change) + the step component
 *   Back / Next    sticky at the bottom on phones; Next explains why it is blocked
 *
 * All workflow state lives in useWorkflowStore, so switching steps only changes
 * what is rendered: nothing is lost going back and forth.
 */
const STEP_COMPONENTS = [UploadStep, MappingStep, OutputsStep, ExportStep];

function StepMarker({ state, number }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold tabular-nums transition-colors duration-150",
        state === "current" && "bg-brand text-brand-fg",
        state === "done" && "bg-brand-soft text-brand-soft-fg",
        state === "upcoming" && "border border-control text-muted",
        state === "locked" && "border border-dashed border-line-strong text-muted",
      )}
    >
      {state === "done" ? <Check className="size-4" /> : state === "locked" ? <Lock className="size-3.5" /> : number}
    </span>
  );
}

const STATE_LABELS = {
  current: "current step",
  done: "completed",
  upcoming: "not started",
  locked: "not available yet",
};

/** Scroll to the top and put focus on the step heading (no smooth scroll: the content just changed). */
function landOnHeading(heading) {
  window.scrollTo({ top: 0, left: 0, behavior: "instant" });
  if (heading) heading.focus({ preventScroll: true });
}

export default function Wizard() {
  const step = useWorkflowStore((state) => state.step);
  const setStep = useWorkflowStore((state) => state.setStep);
  const nextStep = useWorkflowStore((state) => state.nextStep);
  const prevStep = useWorkflowStore((state) => state.prevStep);
  const resetWorkflow = useWorkflowStore((state) => state.resetWorkflow);
  const templateId = useWorkflowStore((state) => state.templateId);
  const templateName = useWorkflowStore((state) => state.templateName);
  const dirty = useWorkflowStore((state) => state.dirty);
  const hasData = useWorkflowStore(selectHasData);
  const hasFile = useWorkflowStore((state) => Boolean(state.file));
  const fieldCount = useWorkflowStore((state) => state.definition.fields.length);
  const outputCount = useWorkflowStore((state) => state.definition.outputs.length);
  const steps = useStepStates();

  const [confirmReset, setConfirmReset] = useState(false);
  const [stepsOpen, setStepsOpen] = useState(false);
  const headingRef = useRef(null);
  const shownStep = useRef(step);
  const headingId = useId();
  const stepListId = useId();
  const reasonId = useId();

  const current = steps[step] || steps[0];
  const next = steps[step + 1] || null;
  const previous = step > 0 ? steps[step - 1] : null;
  const isLast = step >= steps.length - 1;
  const Step = STEP_COMPONENTS[step] || UploadStep;
  const title = templateName.trim() || "Untitled workflow";
  const pristine = !hasFile && !fieldCount && !outputCount && !templateId && !dirty;
  const nextBlocked = Boolean(next && !next.enabled);

  // A step counts as completed when its job is done, not merely because it was visited.
  const completed = [hasData, fieldCount > 0, outputCount > 0, false];
  const stateOf = (item) => {
    if (item.index === step) return "current";
    if (!item.enabled) return "locked";
    return completed[item.index] ? "done" : "upcoming";
  };

  // Where to send someone who is on a step that is not available (yet / any more):
  // the step that fixes it, or the nearest one before it that can be opened.
  let fixIndex = step === 3 ? (!hasData ? 0 : !fieldCount ? 1 : 2) : Math.max(0, step - 1);
  while (fixIndex > 0 && !steps[fixIndex].enabled) fixIndex -= 1;

  // On every step change (Back / Next, the stepper, a template being applied ...)
  // land keyboard and screen-reader users at the top of the new step.
  useEffect(() => {
    if (shownStep.current === step) return;
    shownStep.current = step;
    landOnHeading(headingRef.current);
  }, [step]);

  const goTo = (item) => {
    if (!item.enabled) return;
    setStepsOpen(false);
    setStep(item.index);
  };

  const goNext = () => {
    if (nextBlocked) return;
    setStepsOpen(false);
    nextStep();
  };

  const goBack = () => {
    setStepsOpen(false);
    prevStep();
  };

  const startOver = () => {
    setConfirmReset(false);
    setStepsOpen(false);
    resetWorkflow({ keepData: false });
    toast.info("Workflow cleared", { description: "Saved templates were not changed." });
    // The dialog hands focus back to "Start over", which is disabled by now.
    window.requestAnimationFrame(() => landOnHeading(headingRef.current));
  };

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-5 px-4 pt-5 sm:gap-6 sm:px-6 sm:py-8">
      {/* Title row */}
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <div className="min-w-0">
          <p className="text-xs font-medium tracking-wide text-muted uppercase">Workflow</p>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1">
            <h1 className="min-w-0 text-xl font-semibold tracking-tight break-words text-fg sm:text-2xl">{title}</h1>
            <span role="status" className="flex">
              {dirty ? (
                <Badge
                  tone="warning"
                  title={
                    templateId
                      ? "Changed since this template was last saved"
                      : "This workflow is not saved as a template yet"
                  }
                >
                  <span aria-hidden="true" className="size-1.5 rounded-full bg-warning" />
                  Unsaved changes
                </Badge>
              ) : null}
            </span>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <SaveTemplateButton />
          <Button variant="ghost" icon={RotateCcw} disabled={pristine} onClick={() => setConfirmReset(true)}>
            Start over
          </Button>
        </div>
      </div>

      {/* Stepper */}
      <nav aria-label="Workflow steps" className="overflow-hidden rounded-xl border border-line bg-surface shadow-card">
        <button
          type="button"
          aria-expanded={stepsOpen}
          aria-controls={stepListId}
          onClick={() => setStepsOpen((open) => !open)}
          className="flex h-12 w-full cursor-pointer items-center gap-2 px-4 text-left text-sm sm:hidden"
        >
          <span className="min-w-0 truncate">
            <span className="text-muted">
              Step {step + 1} of {steps.length}:
            </span>{" "}
            <span className="font-semibold text-fg">{current.label}</span>
          </span>
          <span className="sr-only">{stepsOpen ? "Hide all steps" : "Show all steps"}</span>
          <ChevronDown
            className={cn("ml-auto size-4 shrink-0 text-muted transition-transform duration-150", stepsOpen && "rotate-180")}
            aria-hidden="true"
          />
        </button>
        <ol
          id={stepListId}
          className={cn(stepsOpen ? "block" : "hidden", "border-t border-line sm:grid sm:grid-cols-4 sm:border-t-0")}
        >
          {steps.map((item) => {
            const state = stateOf(item);
            const locked = !item.enabled;
            return (
              <li key={item.id} className="min-w-0 border-line not-first:border-t sm:not-first:border-t-0 sm:not-first:border-l">
                <button
                  type="button"
                  onClick={() => goTo(item)}
                  aria-current={state === "current" ? "step" : undefined}
                  aria-disabled={locked || undefined}
                  title={locked ? item.reason : undefined}
                  className={cn(
                    "flex h-full w-full items-center gap-3 px-4 py-3 text-left transition-colors duration-150",
                    locked ? "cursor-not-allowed" : "cursor-pointer usable-hover:bg-surface-2",
                  )}
                >
                  <StepMarker state={state} number={item.index + 1} />
                  <span className="min-w-0">
                    <span
                      className={cn(
                        "block text-sm",
                        state === "current" ? "font-semibold text-fg" : locked ? "font-medium text-muted" : "font-medium text-fg",
                      )}
                    >
                      <span className="sr-only">Step {item.index + 1}: </span>
                      {item.label}
                      <span className="sr-only"> ({STATE_LABELS[state]})</span>
                    </span>
                    <span className="block text-xs leading-snug text-muted sm:hidden lg:block">
                      {locked ? item.reason : item.description}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
        <div
          role="progressbar"
          aria-label="Workflow progress"
          aria-valuemin={0}
          aria-valuemax={steps.length}
          aria-valuenow={step + 1}
          aria-valuetext={`Step ${step + 1} of ${steps.length}: ${current.label}`}
          className="h-1 bg-surface-2"
        >
          <div
            className="h-full bg-brand transition-[width] duration-200 ease-out"
            style={{ width: `${((step + 1) / steps.length) * 100}%` }}
          />
        </div>
      </nav>

      {/* Current step */}
      <section aria-labelledby={headingId} className="flex min-w-0 flex-1 flex-col gap-4">
        <div>
          <h2
            id={headingId}
            ref={headingRef}
            tabIndex={-1}
            className="w-fit rounded-sm text-lg font-semibold tracking-tight text-fg outline-offset-4"
          >
            <span className="sr-only">
              Step {step + 1} of {steps.length}:{" "}
            </span>
            {current.label}
          </h2>
          <p className="mt-0.5 text-sm text-muted">{current.description}</p>
        </div>
        {current.enabled ? null : (
          <Notice
            tone="warning"
            icon={CircleAlert}
            title="This step is not ready yet"
            actions={
              <Button size="sm" onClick={() => goTo(steps[fixIndex])}>
                Go to {steps[fixIndex].label}
              </Button>
            }
          >
            {current.reason}
          </Notice>
        )}
        <Step />
      </section>

      {/* Back / Next */}
      <div
        data-bottom-bar={nextBlocked ? "tall" : ""}
        className="sticky bottom-0 z-30 -mx-4 flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-line bg-surface px-4 py-3 sm:static sm:mx-0 sm:bg-transparent sm:px-0 sm:pt-5 sm:pb-0"
      >
        {previous ? (
          <Button variant="secondary" icon={ArrowLeft} onClick={goBack}>
            Back
            <span className="sr-only">: {previous.label}</span>
          </Button>
        ) : null}
        <span className="hidden flex-1 sm:block" />
        {nextBlocked ? (
          <p id={reasonId} className="order-first flex basis-full items-center gap-1.5 text-xs text-muted sm:order-none sm:basis-auto sm:text-sm">
            <Lock className="size-3.5 shrink-0" aria-hidden="true" />
            {next.reason}
          </p>
        ) : null}
        {isLast ? (
          <ButtonLink href="/" variant="soft" icon={Check} className="flex-1 sm:flex-none">
            Done
          </ButtonLink>
        ) : (
          <Button
            variant="primary"
            iconRight={ArrowRight}
            aria-disabled={nextBlocked || undefined}
            aria-describedby={nextBlocked ? reasonId : undefined}
            onClick={goNext}
            className="flex-1 sm:flex-none"
          >
            Next: {next.label}
          </Button>
        )}
      </div>

      <ConfirmDialog
        open={confirmReset}
        tone="danger"
        title="Start over?"
        message="This clears the loaded file, the mapping and every output of this workflow. Saved templates are not affected."
        confirmLabel="Start over"
        cancelLabel="Keep working"
        onConfirm={startOver}
        onCancel={() => setConfirmReset(false)}
      />
      <FixMappingDialog />
    </div>
  );
}
