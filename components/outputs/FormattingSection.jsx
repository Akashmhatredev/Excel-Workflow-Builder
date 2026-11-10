"use client";

import { ArrowDown, ArrowUp, CircleAlert, Highlighter, Plus, Trash2 } from "lucide-react";
import { useId } from "react";
import { Badge, Button, Card, Checkbox, IconButton, Input, Notice, SectionHeader, Select, Switch } from "@/components/ui";
import {
  CONDITIONAL_OPERATORS,
  FILTER_OPERATORS,
  HIGHLIGHT_STYLES,
  createConditionalFormat,
  createSheetStyle,
} from "@/lib/schema";
import { describeConditionalFormat, plural } from "./helpers";
import HighlightPicker from "./HighlightPicker";
import { useRestoreFocus } from "./hooks";

const NONE = [];
const OPERATOR_OPTIONS = CONDITIONAL_OPERATORS.filter((value) => FILTER_OPERATORS[value]).map((value) => ({
  value,
  label: FILTER_OPERATORS[value].label,
}));
const PLACEHOLDERS = { number: "For example 1000", date: "For example 2024-12-31", text: "For example Paid" };

function SheetStyleBlock({ sheetStyle, onChange }) {
  const titleId = useId();
  const set = (key, value) => onChange({ ...sheetStyle, [key]: value });
  return (
    <div role="group" aria-labelledby={titleId} className="rounded-lg border border-line p-3 sm:p-4">
      <p id={titleId} className="text-sm font-medium text-fg">
        Excel sheet
      </p>
      <div className="mt-2 grid gap-x-6 gap-y-1 sm:grid-cols-3">
        <Switch
          className="min-h-11"
          label="Bold header row"
          checked={sheetStyle.boldHeader}
          onChange={(value) => set("boldHeader", value)}
        />
        <Switch
          className="min-h-11"
          label="Freeze header row"
          description="Stays in view while scrolling"
          checked={sheetStyle.freezeHeader}
          onChange={(value) => set("freezeHeader", value)}
        />
        <Switch
          className="min-h-11"
          label="Filter buttons"
          description="Excel's auto filter on the header"
          checked={sheetStyle.autoFilter}
          onChange={(value) => set("autoFilter", value)}
        />
      </div>
    </div>
  );
}

function RuleRow({ rule, index, count, columns, columnTypes, problem, onPatch, onMove, onRemove }) {
  const titleId = useId();
  const number = index + 1;
  const spec = FILTER_OPERATORS[rule.operator] || FILTER_OPERATORS.gt;
  const known = !rule.columnKey || columns.some((column) => column.key === rule.columnKey);
  const type = columnTypes[rule.columnKey] || "text";
  const placeholder = PLACEHOLDERS[type] || PLACEHOLDERS.text;
  const inputMode = type === "number" ? "decimal" : undefined;

  return (
    <li className="min-w-0">
      <div role="group" aria-labelledby={titleId} className="rounded-lg border border-line p-3 sm:p-4">
        <div className="flex items-center justify-between gap-2">
          <p id={titleId} className="text-sm font-medium text-fg">
            Rule {number}
            {problem && problem.level === "error" ? <span className="sr-only"> (needs attention)</span> : null}
          </p>
          <div className="-my-1 flex items-center">
            <IconButton
              label={`Move rule ${number} up`}
              icon={ArrowUp}
              disabled={index === 0}
              data-focus-key={`cf:${rule.id}:up`}
              onClick={() => onMove(-1)}
            />
            <IconButton
              label={`Move rule ${number} down`}
              icon={ArrowDown}
              disabled={index === count - 1}
              data-focus-key={`cf:${rule.id}:down`}
              onClick={() => onMove(1)}
            />
            <IconButton
              label={`Remove rule ${number}`}
              icon={Trash2}
              variant="dangerGhost"
              data-focus-key={`cf:${rule.id}:remove`}
              onClick={onRemove}
            />
          </div>
        </div>

        <div className="mt-2 grid min-w-0 gap-2 sm:grid-cols-2 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)_minmax(0,1.4fr)]">
          <Select
            aria-label={`Rule ${number}: column`}
            value={rule.columnKey || ""}
            invalid={!known}
            onChange={(event) => onPatch({ columnKey: event.target.value })}
          >
            <option value="">Choose a column…</option>
            {!known ? <option value={rule.columnKey}>(removed column)</option> : null}
            {columns.map((column) => (
              <option key={column.key} value={column.key}>
                {column.name || "(unnamed)"}
              </option>
            ))}
          </Select>
          <Select
            aria-label={`Rule ${number}: condition`}
            value={rule.operator}
            onChange={(event) => onPatch({ operator: event.target.value })}
          >
            {OPERATOR_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
          {spec.arity === 1 ? (
            <Input
              aria-label={`Rule ${number}: value`}
              value={rule.value}
              placeholder={placeholder}
              inputMode={inputMode}
              autoComplete="off"
              maxLength={200}
              className="sm:col-span-2 xl:col-span-1"
              onChange={(event) => onPatch({ value: event.target.value })}
            />
          ) : spec.arity === 2 ? (
            <div className="flex min-w-0 items-center gap-2 sm:col-span-2 xl:col-span-1">
              <Input
                aria-label={`Rule ${number}: from`}
                value={rule.value}
                placeholder="From"
                inputMode={inputMode}
                autoComplete="off"
                maxLength={200}
                onChange={(event) => onPatch({ value: event.target.value })}
              />
              <span className="shrink-0 text-sm text-muted">and</span>
              <Input
                aria-label={`Rule ${number}: to`}
                value={rule.value2}
                placeholder="To"
                inputMode={inputMode}
                autoComplete="off"
                maxLength={200}
                onChange={(event) => onPatch({ value2: event.target.value })}
              />
            </div>
          ) : null}
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
          <HighlightPicker
            label={`Rule ${number}: highlight colour`}
            value={HIGHLIGHT_STYLES[rule.style] ? rule.style : "red"}
            bold={rule.bold}
            onChange={(style) => onPatch({ style })}
          />
          <Checkbox
            className="min-h-10 items-center! [&_input]:mt-0 [&_label]:py-2.5"
            label="Bold text"
            checked={rule.bold}
            onChange={(bold) => onPatch({ bold })}
          />
        </div>

        {problem ? (
          <p
            className={
              problem.level === "error"
                ? "mt-2 flex items-start gap-1.5 text-xs text-danger"
                : "mt-2 flex items-start gap-1.5 text-xs text-muted"
            }
          >
            {problem.level === "error" ? <CircleAlert className="mt-px size-3.5 shrink-0" aria-hidden="true" /> : null}
            {problem.message}
          </p>
        ) : null}
      </div>
    </li>
  );
}

/**
 * Formatting of one output: Excel sheet style (bold / frozen header, auto filter) and the
 * conditional formatting rules that colour matching cells in the xlsx file, the preview and the
 * report image. CSV files cannot carry formatting: the rules stay saved and still drive the preview
 * and the report image.
 *
 * `columnTypes` = { [resultColumnKey]: 'text'|'number'|'date' } from the preview (may be empty).
 * `onChange(patch)` is updateOutput's patch: { conditionalFormats } or { sheetStyle } (replaced
 * wholesale, so this component merges the sheet style itself).
 */
export default function FormattingSection({ output, resultColumns, columnTypes, onChange }) {
  const rules = Array.isArray(output.conditionalFormats) ? output.conditionalFormats : NONE;
  const sheetStyle = { ...createSheetStyle(), ...(output.sheetStyle || {}) };
  const csv = output.fileType === "csv";
  const restoreFocus = useRestoreFocus();
  const types = columnTypes || {};

  const problems = rules.map((rule) => describeConditionalFormat(rule, resultColumns));
  const invalidCount = problems.filter((problem) => problem && problem.level === "error").length;

  const emit = (next) => onChange({ conditionalFormats: next });
  const patchRule = (id, patch) => emit(rules.map((rule) => (rule.id === id ? { ...rule, ...patch } : rule)));
  const moveRule = (index, delta) => {
    const to = index + delta;
    if (to < 0 || to >= rules.length) return;
    const id = rules[index].id;
    restoreFocus(`cf:${id}:${delta < 0 ? "up" : "down"}`, `cf:${id}:${delta < 0 ? "down" : "up"}`);
    const next = rules.slice();
    const [rule] = next.splice(index, 1);
    next.splice(to, 0, rule);
    emit(next);
  };
  const removeRule = (index) => {
    const neighbour = rules[index + 1] || rules[index - 1];
    restoreFocus(...(neighbour ? [`cf:${neighbour.id}:remove`] : []), "cf:add");
    emit(rules.filter((_, i) => i !== index));
  };
  const addRule = () => {
    const numeric = resultColumns.find((column) => types[column.key] === "number");
    const column = numeric || resultColumns[0];
    const used = new Set(rules.map((rule) => rule.style));
    const style = Object.keys(HIGHLIGHT_STYLES).find((key) => !used.has(key)) || "red";
    emit([
      ...rules,
      createConditionalFormat({ columnKey: column ? column.key : "", operator: numeric ? "gt" : "equals", style }),
    ]);
  };

  return (
    <Card as="section" className="p-4 sm:p-5">
      <SectionHeader
        as="h4"
        title="Formatting"
        description="Style the header row and colour the cells that match a rule."
        actions={invalidCount ? <Badge tone="danger">{plural(invalidCount, "rule")} to fix</Badge> : null}
      />

      <div className="mt-4 flex flex-col gap-4">
        {csv ? (
          <Notice tone="info" title="CSV files cannot carry formatting">
            A CSV holds plain values only, so colours, bold text, a frozen header and filter buttons are not
            written to the file. Your rules stay saved: they still colour the preview and the report image, and
            go into the file again if you switch this output to Excel.
          </Notice>
        ) : (
          <SheetStyleBlock sheetStyle={sheetStyle} onChange={(next) => onChange({ sheetStyle: next })} />
        )}

        <div className="flex min-w-0 flex-col gap-3">
          <div className="min-w-0">
            <h5 className="flex items-center gap-2 text-sm font-medium text-fg">
              <Highlighter className="size-4 text-muted" aria-hidden="true" />
              Highlight rules
            </h5>
            <p className="mt-0.5 text-xs text-muted">
              Rules are checked from top to bottom and the first one that matches a cell sets its colour.
              {csv ? "" : " Excel gets them as real conditional formatting."}
            </p>
          </div>

          {rules.length ? (
            <ol className="flex min-w-0 flex-col gap-3" aria-label="Highlight rules">
              {rules.map((rule, index) => (
                <RuleRow
                  key={rule.id}
                  rule={rule}
                  index={index}
                  count={rules.length}
                  columns={resultColumns}
                  columnTypes={types}
                  problem={problems[index]}
                  onPatch={(patch) => patchRule(rule.id, patch)}
                  onMove={(delta) => moveRule(index, delta)}
                  onRemove={() => removeRule(index)}
                />
              ))}
            </ol>
          ) : (
            <p className="text-sm text-muted">No highlight rules yet. Add one to colour cells such as overdue dates or large amounts.</p>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              icon={Plus}
              className="max-sm:h-10"
              disabled={!resultColumns.length}
              data-focus-key="cf:add"
              onClick={addRule}
            >
              Add rule
            </Button>
            {!resultColumns.length ? <span className="text-xs text-muted">This output has no columns yet.</span> : null}
          </div>
        </div>
      </div>
    </Card>
  );
}
