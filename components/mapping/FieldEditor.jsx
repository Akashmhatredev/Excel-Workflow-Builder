"use client";

import { Copy, Trash2 } from "lucide-react";
import { useRef } from "react";
import ColumnChips from "@/components/mapping/ColumnChips";
import TransformList from "@/components/mapping/TransformList";
import { Button, Field, Input, Segmented, Select, Textarea } from "@/components/ui";
import { SOURCE_KINDS, uniqueName } from "@/lib/schema";
import { useWorkflowStore } from "@/store/useWorkflowStore";

const KIND_OPTIONS = Object.entries(SOURCE_KINDS).map(([value, spec]) => ({ value, label: spec.label }));
const DEFAULT_NAME = /^Field \d+$/;

/**
 * The expanded part of a field row: where the value comes from (a column, a
 * combine template or a formula) and the transforms applied to it.
 */
export default function FieldEditor({ field, columns, sourceInvalid = false, onDuplicate, onRemove }) {
  const updateField = useWorkflowStore((state) => state.updateField);
  const textRef = useRef(null);
  const source = field.source;
  const kind = SOURCE_KINDS[source.kind] ? source.kind : "column";
  const columnKnown = !source.column || columns.some((column) => column.name === source.column);

  const chooseColumn = (column) => {
    const patch = { source: { column } };
    const name = field.name.trim();
    // A field that still has its placeholder name takes the name of the column it now copies.
    if (column && (!name || DEFAULT_NAME.test(name))) {
      const others = useWorkflowStore
        .getState()
        .definition.fields.filter((other) => other.id !== field.id)
        .map((other) => other.name);
      patch.name = uniqueName(column, others);
    }
    updateField(field.id, patch);
  };

  /** Put "{Column}" at the caret of the template / formula box (or at its end). */
  const insertReference = (columnName) => {
    const key = kind === "formula" ? "expression" : "template";
    const current = source[key] || "";
    const node = textRef.current;
    const start = node && typeof node.selectionStart === "number" ? node.selectionStart : current.length;
    const end = node && typeof node.selectionEnd === "number" ? node.selectionEnd : start;
    const token = `{${columnName}}`;
    updateField(field.id, { source: { [key]: current.slice(0, start) + token + current.slice(end) } });
    const caret = start + token.length;
    requestAnimationFrame(() => {
      const target = textRef.current;
      if (!target) return;
      target.focus();
      target.setSelectionRange(caret, caret);
    });
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <Segmented
            label="Where the value comes from"
            options={KIND_OPTIONS}
            value={kind}
            onChange={(next) => updateField(field.id, { source: { kind: next } })}
          />
          <p className="text-xs text-muted">{SOURCE_KINDS[kind].hint}</p>
        </div>

        {kind === "column" ? (
          <Field label="Source column">
            {(control) => (
              <Select
                {...control}
                invalid={sourceInvalid || !columnKnown}
                value={source.column || ""}
                onChange={(event) => chooseColumn(event.target.value)}
              >
                <option value="">Choose a column…</option>
                {!columnKnown ? <option value={source.column}>{source.column} (not in this file)</option> : null}
                {columns.map((column, index) => (
                  <option key={`${column.name}-${index}`} value={column.name}>
                    {column.type && column.type !== "text" ? `${column.name} (${column.type})` : column.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        ) : null}

        {kind === "combine" ? (
          <>
            <Field label="Template" hint="Plain text with {Column} placeholders, for example {First Name} {Last Name}.">
              {(control) => (
                <Input
                  {...control}
                  ref={textRef}
                  invalid={sourceInvalid}
                  spellCheck={false}
                  placeholder="{First Name} {Last Name}"
                  value={source.template || ""}
                  onChange={(event) => updateField(field.id, { source: { template: event.target.value } })}
                />
              )}
            </Field>
            <ColumnChips columns={columns} onInsert={insertReference} label="Insert a column" />
          </>
        ) : null}

        {kind === "formula" ? (
          <>
            <Field label="Formula">
              {(control) => (
                <Textarea
                  {...control}
                  ref={textRef}
                  invalid={sourceInvalid}
                  rows={2}
                  spellCheck={false}
                  className="font-mono"
                  placeholder="{Qty} * {Price}"
                  value={source.expression || ""}
                  onChange={(event) => updateField(field.id, { source: { expression: event.target.value } })}
                />
              )}
            </Field>
            <ColumnChips columns={columns} onInsert={insertReference} label="Insert a column" />
            <details className="text-xs text-muted">
              <summary className="cursor-pointer py-1 font-medium text-fg">Formula syntax</summary>
              <ul className="mt-1 flex list-disc flex-col gap-1 pl-4">
                <li>
                  Columns go in braces: <code className="font-mono">{"{Qty} * {Price}"}</code>
                </li>
                <li>
                  Maths <code className="font-mono">+ - * / %</code>, brackets, and <code className="font-mono">&amp;</code> to join
                  text: <code className="font-mono">{'{City} & ", " & {State}'}</code>
                </li>
                <li>
                  Comparisons <code className="font-mono">= != &lt; &lt;= &gt; &gt;=</code> inside{" "}
                  <code className="font-mono">{'IF({Total} > 1000, "High", "Low")'}</code>
                </li>
                <li>
                  Functions: <code className="font-mono">ROUND ABS MIN MAX SUM FLOOR CEIL IF COALESCE CONCAT LEN UPPER LOWER TRIM</code>
                </li>
                <li>Text goes in double quotes. Maths that cannot be done, such as dividing by zero, gives an empty cell.</li>
              </ul>
            </details>
          </>
        ) : null}
      </div>

      <TransformList field={field} />

      <div className="flex flex-wrap items-center justify-end gap-2 border-t border-line pt-3">
        <Button variant="ghost" size="sm" icon={Copy} onClick={onDuplicate}>
          Duplicate field
        </Button>
        <Button variant="dangerGhost" size="sm" icon={Trash2} onClick={onRemove}>
          Delete field
        </Button>
      </div>
    </div>
  );
}
