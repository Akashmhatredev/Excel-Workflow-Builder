"use client";

import TransformEditor from "@/components/mapping/TransformEditor";
import { Select } from "@/components/ui";
import { TRANSFORMS } from "@/lib/schema";
import { useWorkflowStore } from "@/store/useWorkflowStore";

const TRANSFORM_TYPES = Object.entries(TRANSFORMS);

/** The transform chain of one field, applied top to bottom, with an "Add transform" menu. */
export default function TransformList({ field }) {
  const addTransform = useWorkflowStore((state) => state.addTransform);
  const transforms = field.transforms || [];
  const title = field.name || "this field";
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-medium text-fg">
          Transforms
          {transforms.length > 1 ? <span className="font-normal text-muted"> · applied top to bottom</span> : null}
        </p>
        <div className="w-44">
          <Select
            aria-label={`Add a transform to ${title}`}
            value=""
            onChange={(event) => {
              if (event.target.value) addTransform(field.id, event.target.value);
            }}
          >
            <option value="">Add transform…</option>
            {TRANSFORM_TYPES.map(([type, spec]) => (
              <option key={type} value={type}>
                {spec.label}
              </option>
            ))}
          </Select>
        </div>
      </div>
      {transforms.length ? (
        <ol className="flex flex-col gap-2">
          {transforms.map((transform, index) => (
            <TransformEditor key={transform.id} fieldId={field.id} transform={transform} index={index} count={transforms.length} />
          ))}
        </ol>
      ) : (
        <p className="text-xs text-muted">No transforms: the value is used exactly as it is in the source.</p>
      )}
    </div>
  );
}
