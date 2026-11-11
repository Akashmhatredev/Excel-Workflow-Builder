"use client";

import { KeyRound, Plus, Wand2, X } from "lucide-react";
import { useState } from "react";
import { exampleKey, suggestKeyPair } from "@/components/upload/lookup";
import { Button, Checkbox, IconButton, Input, Select } from "@/components/ui";
import { DEFAULT_KEY_SEPARATOR, KEY_SEPARATORS, KEY_SEPARATOR_MAX, getLookupKeys } from "@/lib/schema";

const CUSTOM = "__custom__";
const DEFAULT_KEY_NAME = "Merge Key";
const PRESETS = new Set(KEY_SEPARATORS.map((option) => option.value));

/** Options for a key column select: the columns not used elsewhere in this key, plus the current value. */
function KeyOptions({ columns, value, taken, placeholder }) {
  const known = !value || columns.some((column) => column.name === value);
  return (
    <>
      <option value="">{placeholder}</option>
      {!known ? <option value={value}>{value} (not found)</option> : null}
      {columns
        .filter((column) => column.name === value || !taken.includes(column.name))
        .map((column, index) => (
          <option key={`${column.name}-${index}`} value={column.name}>
            {column.name}
          </option>
        ))}
    </>
  );
}

function KeySide({ title, side, names, columns, onChange, onAdd, onRemove }) {
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <p className="text-xs font-medium tracking-wide text-muted uppercase">{title}</p>
      <ol className="flex flex-col gap-2">
        {names.map((name, index) => (
          <li key={`${side}-${index}`} className="flex min-w-0 items-center gap-2">
            {names.length > 1 ? (
              <span aria-hidden="true" className="w-4 shrink-0 text-right text-xs text-muted tabular-nums">
                {index + 1}
              </span>
            ) : null}
            <Select
              aria-label={`${title}: key column ${index + 1}`}
              value={name}
              invalid={Boolean(name) && !columns.some((column) => column.name === name)}
              onChange={(event) => onChange(index, event.target.value)}
              className="min-w-0 flex-1"
            >
              <KeyOptions columns={columns} value={name} taken={names} placeholder="Choose a column…" />
            </Select>
            {names.length > 1 ? (
              <IconButton label={`Remove key column ${index + 1} of ${title.toLowerCase()}`} icon={X} size="sm" onClick={() => onRemove(index)} />
            ) : null}
          </li>
        ))}
      </ol>
      <Button
        variant="ghost"
        size="sm"
        icon={Plus}
        className="self-start"
        disabled={names.some((name) => !name) || names.length >= columns.length}
        onClick={onAdd}
      >
        Add a column to the key
      </Button>
    </div>
  );
}

/**
 * The merge key of a lookup: one column per side, or several columns joined with a separator
 * into a combined key ("Customer" + "Date" -> "C001_2024-01-05"). The two sides may use a
 * different number of columns, so a combined key can match a column that already holds the
 * joined text. The built key can also be added to this file as a column.
 *
 * Changes are only sent (onApply re-joins the files) once every slot on both sides has a column;
 * until then the half-built key is a local draft.
 *
 * Props: lookup (Lookup), mainColumns, lookupColumns ([{ name }]), previewColumns + previewRows
 * (the loaded table, for the example), onApply(patch).
 */
export default function KeyBuilder({ lookup, mainColumns, lookupColumns, previewColumns, previewRows, onApply }) {
  const stored = getLookupKeys(lookup);
  const [draft, setDraft] = useState(null); // { main: string[], lookup: string[] } while incomplete
  const [customDraft, setCustomDraft] = useState(null); // custom separator text being edited
  const [nameDraft, setNameDraft] = useState(null); // key column name being edited

  const keys = draft || {
    main: stored.main.length ? stored.main : [""],
    lookup: stored.lookup.length ? stored.lookup : [""],
  };
  const separator = typeof lookup.keySeparator === "string" ? lookup.keySeparator : DEFAULT_KEY_SEPARATOR;
  const multi = keys.main.length > 1 || keys.lookup.length > 1;
  const isCustom = customDraft !== null || !PRESETS.has(separator);
  const example = exampleKey(previewColumns, previewRows, keys.main, separator);
  const suggestion = suggestKeyPair(mainColumns, lookupColumns, keys);
  const keyColumnOn = Boolean(lookup.keyColumnName);
  const keyName = nameDraft === null ? lookup.keyColumnName || DEFAULT_KEY_NAME : nameDraft;

  const commit = (next) => {
    const complete = next.main.every(Boolean) && next.lookup.every(Boolean);
    if (complete) {
      setDraft(null);
      onApply({ mainKeyColumns: next.main, lookupKeyColumns: next.lookup });
    } else {
      setDraft(next);
    }
  };

  const change = (side) => (index, value) => {
    const list = keys[side].slice();
    list[index] = value;
    commit({ ...keys, [side]: list });
  };
  const add = (side) => () => setDraft({ ...keys, [side]: [...keys[side], ""] });
  const remove = (side) => (index) => {
    const list = keys[side].filter((_, i) => i !== index);
    commit({ ...keys, [side]: list.length ? list : [""] });
  };

  const commitCustom = () => {
    if (customDraft === null) return;
    const value = customDraft.slice(0, KEY_SEPARATOR_MAX);
    setCustomDraft(null);
    if (value !== separator) onApply({ keySeparator: value });
  };

  const commitName = () => {
    if (nameDraft === null) return;
    const value = nameDraft.replace(/\s+/g, " ").trim() || DEFAULT_KEY_NAME;
    setNameDraft(null);
    if (keyColumnOn && value !== lookup.keyColumnName) onApply({ keyColumnName: value });
  };

  return (
    <fieldset className="min-w-0">
      <legend className="flex items-center gap-2 text-sm font-medium text-fg">
        <KeyRound className="size-4 text-muted" aria-hidden="true" />
        Match rows on a key
      </legend>
      <p className="mt-0.5 text-xs text-muted">
        Pick one column on each side, or several to build a combined key such as Customer + Date. The sides may use a
        different number of columns: a combined key also matches a column that already holds the joined text. Matching
        ignores upper/lower case and spaces at the ends.
      </p>

      <div className="mt-3 grid grid-cols-1 gap-4 rounded-lg border border-line bg-surface-2/60 p-3 sm:grid-cols-2">
        <KeySide
          title="This file"
          side="main"
          names={keys.main}
          columns={mainColumns}
          onChange={change("main")}
          onAdd={add("main")}
          onRemove={remove("main")}
        />
        <KeySide
          title="Second file"
          side="lookup"
          names={keys.lookup}
          columns={lookupColumns}
          onChange={change("lookup")}
          onAdd={add("lookup")}
          onRemove={remove("lookup")}
        />
      </div>

      {suggestion ? (
        <Button
          variant="soft"
          size="sm"
          icon={Wand2}
          className="mt-2"
          onClick={() => {
            setDraft(null);
            onApply(suggestion);
          }}
        >
          Match on “{suggestion.mainKeyColumns[0]}”
          {suggestion.lookupKeyColumns[0] !== suggestion.mainKeyColumns[0] ? ` = “${suggestion.lookupKeyColumns[0]}”` : ""}
        </Button>
      ) : null}
      {draft ? <p className="mt-1.5 text-xs text-warning">Choose a column in every key slot to apply the key.</p> : null}

      {multi ? (
        <div className="mt-3 flex flex-wrap items-end gap-3">
          <label className="flex min-w-0 flex-col gap-1.5 text-sm font-medium text-fg">
            Join the key columns with
            <Select
              value={isCustom ? CUSTOM : separator}
              onChange={(event) => {
                const value = event.target.value;
                if (value === CUSTOM) {
                  setCustomDraft(PRESETS.has(separator) ? "" : separator);
                } else {
                  setCustomDraft(null);
                  if (value !== separator) onApply({ keySeparator: value });
                }
              }}
              className="w-56 max-w-full"
            >
              {KEY_SEPARATORS.map((option) => (
                <option key={option.label} value={option.value}>
                  {option.label}
                </option>
              ))}
              <option value={CUSTOM}>Custom…</option>
            </Select>
          </label>
          {isCustom ? (
            <label className="flex flex-col gap-1.5 text-sm font-medium text-fg">
              Custom separator
              <Input
                value={customDraft === null ? separator : customDraft}
                maxLength={KEY_SEPARATOR_MAX}
                placeholder="e.g. ::"
                onChange={(event) => setCustomDraft(event.target.value)}
                onBlur={commitCustom}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    commitCustom();
                  }
                }}
                className="w-28 font-mono"
              />
            </label>
          ) : null}
        </div>
      ) : null}

      {example ? (
        <p className="mt-3 text-sm text-muted">
          Key of the first row in this file: <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-fg">{example}</code>
        </p>
      ) : null}

      <div className="mt-3 flex flex-col gap-2">
        <Checkbox
          label="Add the key to this file as a column"
          description="The combined key as its own column (for example an ID such as C001_2024-01-05), ready to map to your outputs."
          checked={keyColumnOn}
          onChange={(checked) => {
            setNameDraft(null);
            onApply({ keyColumnName: checked ? keyName.trim() || DEFAULT_KEY_NAME : "" });
          }}
        />
        {keyColumnOn ? (
          <label className="ml-6.5 flex max-w-xs flex-col gap-1.5 text-sm font-medium text-fg">
            Column name
            <Input
              value={keyName}
              maxLength={60}
              onChange={(event) => setNameDraft(event.target.value)}
              onBlur={commitName}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  commitName();
                }
              }}
            />
          </label>
        ) : null}
      </div>
    </fieldset>
  );
}
