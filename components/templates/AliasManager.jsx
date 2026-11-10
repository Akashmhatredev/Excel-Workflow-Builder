"use client";

import { ArrowLeftRight, ChevronDown, Plus, Trash2 } from "lucide-react";
import { useId, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useLocationHash } from "@/components/templates/locationHash";
import { isStorageFailure, notifyStorageError } from "@/components/templates/notify";
import { Badge, Button, Card, EmptyState, Field, IconButton, Input } from "@/components/ui";
import {
  ALIAS_MAX_LENGTH,
  getAliasesSnapshot,
  getServerAliasesSnapshot,
  removeAlias,
  saveAlias,
  subscribeAliases,
} from "@/lib/aliases";
import { cn } from "@/lib/cn";
import { KEYS } from "@/lib/storage";
import { toast } from "@/lib/toast";
import { useTemplateStore } from "@/store/useTemplateStore";

/** Link here (for example from the batch results) to open this section: /templates#column-aliases */
export const ALIASES_ANCHOR = "column-aliases";

const plural = (count, word, many = `${word}s`) => `${count} ${count === 1 ? word : many}`;

function reportStorage(result) {
  if (isStorageFailure(result.code)) notifyStorageError({ code: result.code, key: KEYS.aliases }, { userAction: true });
  else toast.error("Could not save the change", { description: result.error });
}

/**
 * "Column aliases" on the Templates page: the saved pairs of column names that mean the same column
 * ("Cust Name" = "Customer"), with Remove and an "Add alias" form. Collapsed by default; it opens by
 * itself when the page is opened at #column-aliases. No props.
 */
export default function AliasManager() {
  const panelId = useId();
  const columnListId = useId();
  const fromRef = useRef(null);
  const aliases = useSyncExternalStore(subscribeAliases, getAliasesSnapshot, getServerAliasesSnapshot);
  const templates = useTemplateStore((state) => state.templates);
  const hash = useLocationHash();
  const [expanded, setExpanded] = useState(null); // null: follow the URL (#column-aliases opens it)
  const open = expanded ?? hash === `#${ALIASES_ANCHOR}`;

  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [error, setError] = useState("");

  // Column names the saved templates expect, offered while typing.
  const knownColumns = useMemo(() => {
    const seen = new Map();
    for (const template of templates) {
      const columns = template.definition && template.definition.source ? template.definition.source.expectedColumns : [];
      for (const column of Array.isArray(columns) ? columns : []) {
        const name = column && typeof column.name === "string" ? column.name.trim() : "";
        if (name && !seen.has(name.toLowerCase())) seen.set(name.toLowerCase(), name);
      }
    }
    return [...seen.values()].sort((a, b) => a.localeCompare(b));
  }, [templates]);

  const add = (event) => {
    event.preventDefault();
    const result = saveAlias(from, to);
    if (!result.ok) {
      if (result.code === "invalid") setError(result.error);
      else reportStorage(result);
      return;
    }
    setError("");
    if (result.existed) {
      toast.info("That alias is already saved", { description: `"${from.trim()}" and "${to.trim()}" already match.` });
    } else {
      const saved = result.aliases[result.aliases.length - 1];
      toast.success("Alias saved", { description: `"${saved.from}" and "${saved.to}" now match in every template.` });
    }
    setFrom("");
    setTo("");
    if (fromRef.current) fromRef.current.focus();
  };

  const remove = (alias) => {
    const result = removeAlias(alias.from, alias.to);
    if (!result.ok) {
      reportStorage(result);
      return;
    }
    toast.success("Alias removed", { description: `"${alias.from}" and "${alias.to}" no longer match.` });
  };

  return (
    <Card as="section" id={ALIASES_ANCHOR} aria-labelledby={`${panelId}-title`} className="scroll-mt-4">
      <h2 id={`${panelId}-title`} className="m-0">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={panelId}
          onClick={() => setExpanded(!open)}
          className="flex min-h-14 w-full cursor-pointer items-center gap-3 rounded-xl px-4 py-3 text-left transition-colors hover:bg-surface-2"
        >
          <span className="hidden size-9 shrink-0 items-center justify-center rounded-lg bg-surface-2 text-muted sm:flex">
            <ArrowLeftRight className="size-4" aria-hidden="true" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-base font-semibold text-fg">Column aliases</span>
            <span className="block text-sm font-normal text-muted">Teach the app that two column names mean the same column.</span>
          </span>
          <Badge className="shrink-0">{plural(aliases.length, "alias", "aliases")}</Badge>
          <ChevronDown className={cn("size-4 shrink-0 text-muted transition-transform", open && "rotate-180")} aria-hidden="true" />
        </button>
      </h2>

      {open ? (
        <div id={panelId} className="flex flex-col gap-4 border-t border-line px-4 py-4">
          <p className="max-w-2xl text-sm text-muted">
            When a new file calls a column &ldquo;Cust Name&rdquo; but your template expects &ldquo;Customer&rdquo;, an alias lets
            the template find it without fixing the mapping by hand. Aliases apply to <strong className="font-medium text-fg">every template</strong>{" "}
            and to batch runs, and they work in both directions. Choosing &ldquo;Remember these matches&rdquo; in the Fix mapping
            dialog saves them here too.
          </p>

          {aliases.length ? (
            <ul aria-label="Saved aliases" className="flex flex-col divide-y divide-line rounded-lg border border-line">
              {aliases.map((alias) => (
                <li key={`${alias.from}\u0000${alias.to}`} className="flex min-w-0 items-center gap-2 py-1.5 pr-1.5 pl-3">
                  <p className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-0.5 text-sm text-fg">
                    <span className="min-w-0 font-medium break-words">{alias.from}</span>
                    <ArrowLeftRight className="size-3.5 shrink-0 text-muted" aria-hidden="true" />
                    <span className="sr-only">matches</span>
                    <span className="min-w-0 font-medium break-words">{alias.to}</span>
                  </p>
                  <IconButton
                    label={`Remove alias ${alias.from} = ${alias.to}`}
                    icon={Trash2}
                    variant="dangerGhost"
                    onClick={() => remove(alias)}
                  />
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState
              className="rounded-lg border border-dashed border-line"
              title="No aliases yet"
              description="Add one below, or tick “Remember these matches” when you fix a mapping."
            />
          )}

          <form onSubmit={add} noValidate className="flex flex-col gap-3">
            <h3 className="text-sm font-semibold text-fg">Add alias</h3>
            <div className="grid gap-3 sm:grid-cols-[1fr_auto_1fr] sm:items-start">
              <Field label="Column name" hint="As a template expects it, e.g. Customer" error={error || undefined}>
                {(props) => (
                  <Input
                    {...props}
                    ref={fromRef}
                    value={from}
                    list={knownColumns.length ? columnListId : undefined}
                    maxLength={ALIAS_MAX_LENGTH}
                    autoComplete="off"
                    onChange={(event) => {
                      setFrom(event.target.value);
                      if (error) setError("");
                    }}
                  />
                )}
              </Field>
              <span className="hidden h-10 items-center text-muted sm:mt-6.5 sm:flex" aria-hidden="true">
                <ArrowLeftRight className="size-4" />
              </span>
              <Field label="Same column as" hint="As a file names it, e.g. Cust Name">
                {(props) => (
                  <Input
                    {...props}
                    value={to}
                    maxLength={ALIAS_MAX_LENGTH}
                    autoComplete="off"
                    onChange={(event) => {
                      setTo(event.target.value);
                      if (error) setError("");
                    }}
                  />
                )}
              </Field>
            </div>
            {knownColumns.length ? (
              <datalist id={columnListId}>
                {knownColumns.map((name) => (
                  <option key={name} value={name} />
                ))}
              </datalist>
            ) : null}
            <div>
              <Button type="submit" icon={Plus} disabled={!from.trim() || !to.trim()}>
                Add alias
              </Button>
            </div>
          </form>
        </div>
      ) : null}
    </Card>
  );
}
