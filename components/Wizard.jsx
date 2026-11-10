"use client";

import ExportStep from "@/components/ExportStep";
import MappingStep from "@/components/MappingStep";
import OutputsStep from "@/components/OutputsStep";
import FixMappingDialog from "@/components/templates/FixMappingDialog";
import SaveTemplateButton from "@/components/templates/SaveTemplateButton";
import { Button } from "@/components/ui";
import UploadStep from "@/components/UploadStep";
import { useStepStates, useWorkflowStore } from "@/store/useWorkflowStore";

/**
 * Wizard (owner: Agent E). Minimal version: replace with the real shell
 * (progress bar, step gating, back/next, save-as-template, fix-mapping dialog).
 */
const STEP_COMPONENTS = [UploadStep, MappingStep, OutputsStep, ExportStep];

export default function Wizard() {
  const step = useWorkflowStore((state) => state.step);
  const setStep = useWorkflowStore((state) => state.setStep);
  const steps = useStepStates();
  const Step = STEP_COMPONENTS[step] || UploadStep;
  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 p-4">
      <div className="flex flex-wrap items-center gap-2">
        {steps.map((item) => (
          <Button
            key={item.id}
            variant={item.index === step ? "primary" : "secondary"}
            size="sm"
            disabled={!item.enabled}
            title={item.reason || undefined}
            onClick={() => setStep(item.index)}
          >
            {item.index + 1}. {item.label}
          </Button>
        ))}
        <span className="flex-1" />
        <SaveTemplateButton />
      </div>
      <Step />
      <FixMappingDialog />
    </div>
  );
}
