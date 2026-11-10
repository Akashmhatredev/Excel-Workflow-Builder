"use client";

import { ArrowDown, ArrowUp, Trash2 } from "lucide-react";
import { useState } from "react";
import NumberInput from "@/components/mapping/NumberInput";
import { Checkbox, Field, IconButton, Input, Select } from "@/components/ui";
import { DATE_PATTERNS, FORMAT_TRANSFORMS, TRANSFORMS } from "@/lib/schema";
import { useWorkflowStore } from "@/store/useWorkflowStore";

const CUSTOM = "__custom__";
const PARAM_GRID = "grid grid-cols-2 gap-x-3 gap-y-2 @lg:grid-cols-4";

function isValidRegex(source) {
  try {
    new RegExp(source);
    return true;
  } catch {
    return false;
  }
}

function NumberFormatParams({ transform, update }) {
  return (
    <div className={PARAM_GRID}>
      <Field label="Decimals">
        {(control) => (
          <NumberInput {...control} min={0} max={10} value={transform.decimals} onCommit={(decimals) => update({ decimals })} />
        )}
      </Field>
      <Field label="Prefix">
        {(control) => (
          <Input {...control} placeholder="e.g. ₹" value={transform.prefix || ""} onChange={(event) => update({ prefix: event.target.value })} />
        )}
      </Field>
      <Field label="Suffix">
        {(control) => (
          <Input {...control} placeholder="e.g. %" value={transform.suffix || ""} onChange={(event) => update({ suffix: event.target.value })} />
        )}
      </Field>
      <Checkbox
        label="Thousands separator"
        checked={Boolean(transform.thousands)}
        onChange={(thousands) => update({ thousands })}
        className="col-span-2 min-h-10 items-center! @lg:col-span-1 @lg:mt-6"
      />
    </div>
  );
}

function DateFormatParams({ transform, update }) {
  const pattern = transform.pattern || "";
  const [custom, setCustom] = useState(() => !DATE_PATTERNS.includes(pattern));
  const showCustom = custom || !DATE_PATTERNS.includes(pattern);
  return (
    <div className="grid grid-cols-1 gap-x-3 gap-y-2 @lg:grid-cols-2">
      <Field label="Pattern">
        {(control) => (
          <Select
            {...control}
            value={showCustom ? CUSTOM : pattern}
            onChange={(event) => {
              const next = event.target.value;
              setCustom(next === CUSTOM);
              if (next !== CUSTOM) update({ pattern: next });
            }}
          >
            {DATE_PATTERNS.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
            <option value={CUSTOM}>Custom…</option>
          </Select>
        )}
      </Field>
      {showCustom ? (
        <Field label="Custom pattern" hint="Tokens: YYYY YY MMMM MMM MM M DD D HH H hh h mm ss A">
          {(control) => (
            <Input
              {...control}
              className="font-mono"
              placeholder="DD MMM YYYY"
              spellCheck={false}
              value={pattern}
              onChange={(event) => update({ pattern: event.target.value })}
            />
          )}
        </Field>
      ) : null}
    </div>
  );
}

function DefaultParams({ transform, update }) {
  return (
    <Field label="Value to use when the cell is empty">
      {(control) => (
        <Input {...control} placeholder="e.g. N/A" value={transform.value ?? ""} onChange={(event) => update({ value: event.target.value })} />
      )}
    </Field>
  );
}

function SplitParams({ transform, update }) {
  return (
    <div className="grid grid-cols-2 gap-x-3 gap-y-2">
      <Field label="Delimiter">
        {(control) => (
          <Input
            {...control}
            className="font-mono"
            placeholder=","
            spellCheck={false}
            value={transform.delimiter ?? ""}
            onChange={(event) => update({ delimiter: event.target.value })}
          />
        )}
      </Field>
      <Field label="Part number" hint="1 keeps the first part">
        {(control) => <NumberInput {...control} min={1} value={transform.index} onCommit={(index) => update({ index })} />}
      </Field>
    </div>
  );
}

function ReplaceParams({ transform, update }) {
  const badRegex = Boolean(transform.useRegex) && Boolean(transform.find) && !isValidRegex(transform.find);
  return (
    <div className="grid grid-cols-1 gap-x-3 gap-y-2 @lg:grid-cols-2">
      <Field label="Find" error={badRegex ? "This is not a valid regular expression." : undefined}>
        {(control) => (
          <Input
            {...control}
            spellCheck={false}
            value={transform.find ?? ""}
            onChange={(event) => update({ find: event.target.value })}
          />
        )}
      </Field>
      <Field label="Replace with">
        {(control) => (
          <Input
            {...control}
            placeholder="(nothing)"
            value={transform.replaceWith ?? ""}
            onChange={(event) => update({ replaceWith: event.target.value })}
          />
        )}
      </Field>
      <div className="flex flex-wrap gap-x-5 gap-y-1 @lg:col-span-2">
        <Checkbox
          label="Match case"
          checked={Boolean(transform.matchCase)}
          onChange={(matchCase) => update({ matchCase })}
          className="min-h-10 items-center!"
        />
        <Checkbox
          label="Regular expression"
          checked={Boolean(transform.useRegex)}
          onChange={(useRegex) => update({ useRegex })}
          className="min-h-10 items-center!"
        />
      </div>
    </div>
  );
}

const PARAM_EDITORS = {
  numberFormat: NumberFormatParams,
  dateFormat: DateFormatParams,
  default: DefaultParams,
  split: SplitParams,
  replace: ReplaceParams,
};

/** One step of a field's transform chain: its parameters plus reorder / remove. */
export default function TransformEditor({ fieldId, transform, index, count }) {
  const updateTransform = useWorkflowStore((state) => state.updateTransform);
  const removeTransform = useWorkflowStore((state) => state.removeTransform);
  const moveTransform = useWorkflowStore((state) => state.moveTransform);

  const spec = TRANSFORMS[transform.type];
  const label = spec ? spec.label : transform.type;
  const Params = PARAM_EDITORS[transform.type];
  const isFormat = FORMAT_TRANSFORMS.includes(transform.type);
  const isLast = index === count - 1;
  const update = (patch) => updateTransform(fieldId, transform.id, patch);

  return (
    <li className="rounded-lg border border-line bg-surface-2 p-2.5">
      <div className="flex items-center gap-2">
        <span
          aria-hidden="true"
          className="flex size-6 shrink-0 items-center justify-center rounded-full bg-surface text-xs font-semibold text-muted"
        >
          {index + 1}
        </span>
        <p className="min-w-0 flex-1 truncate text-sm font-medium text-fg">{label}</p>
        <div className="flex shrink-0 items-center">
          <IconButton
            label={`Move “${label}” earlier`}
            icon={ArrowUp}
            disabled={index === 0}
            onClick={() => moveTransform(fieldId, transform.id, -1)}
          />
          <IconButton
            label={`Move “${label}” later`}
            icon={ArrowDown}
            disabled={isLast}
            onClick={() => moveTransform(fieldId, transform.id, 1)}
          />
          <IconButton
            label={`Remove “${label}”`}
            icon={Trash2}
            variant="dangerGhost"
            onClick={() => removeTransform(fieldId, transform.id)}
          />
        </div>
      </div>
      {Params ? (
        <div className="mt-2">
          <Params transform={transform} update={update} />
        </div>
      ) : null}
      {isFormat ? (
        <p className="mt-2 text-xs text-muted">
          {isLast
            ? "As the last step this sets the column format: Excel cells stay real numbers or dates, and totals still add up."
            : "Not the last step, so the value becomes text here before the next transform runs."}
        </p>
      ) : null}
    </li>
  );
}
