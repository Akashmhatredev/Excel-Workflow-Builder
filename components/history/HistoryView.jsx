"use client";

import { ArrowRight, History, ShieldCheck, Trash2, X } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { Button, Card, ConfirmDialog, EmptyState, IconButton } from "@/components/ui";
import ButtonLink from "@/components/ui/ButtonLink";
import { HISTORY_LIMIT, clearHistory, removeHistoryEntry } from "@/lib/history";
import { toast } from "@/lib/toast";
import { dayLabel, formatClock, groupByDay, plural, runTime, runTitle } from "./format";
import { useHistory, useHydrated, useNow } from "./hooks";
import RunItem from "./RunItem";

/**
 * /history: the whole run log grouped by day, newest first. Remove one run or clear them all.
 * The log itself (lib/history.js) holds only names, dates and row counts.
 */
export default function HistoryView() {
  const entries = useHistory();
  const hydrated = useHydrated();
  const now = useNow();
  const groups = useMemo(() => groupByDay(entries), [entries]);
  const [confirmClear, setConfirmClear] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const headingRef = useRef(null);
  const listRef = useRef(null);

  const focusAfterRemoval = (neighbourId) => {
    // After React has re-rendered without the removed row.
    window.requestAnimationFrame(() => {
      const target = neighbourId
        ? listRef.current && listRef.current.querySelector(`[data-remove-run="${CSS.escape(neighbourId)}"]`)
        : null;
      if (target) target.focus();
      else if (headingRef.current) headingRef.current.focus();
    });
  };

  const removeEntry = (entry) => {
    const index = entries.findIndex((item) => item.id === entry.id);
    const neighbour = entries[index + 1] || entries[index - 1] || null;
    removeHistoryEntry(entry.id);
    setAnnouncement(`Removed ${runTitle(entry)} from ${formatClock(runTime(entry))}.`);
    focusAfterRemoval(neighbour ? neighbour.id : null);
  };

  const confirmClearHistory = () => {
    const count = entries.length;
    clearHistory();
    setConfirmClear(false);
    toast.success("History cleared", { description: `${plural(count, "run")} removed from this device.` });
    focusAfterRemoval(null);
  };

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-6 px-4 py-6 sm:px-6 sm:py-10">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h1
            ref={headingRef}
            tabIndex={-1}
            className="text-2xl font-semibold tracking-tight text-fg sm:text-3xl"
          >
            Run history
          </h1>
          <p className="mt-1 text-sm text-pretty text-muted">
            Every download is listed here: the template, the source file, the outputs and how many rows each had.
          </p>
        </div>
        {hydrated && entries.length ? (
          <Button
            variant="dangerGhost"
            icon={Trash2}
            onClick={() => setConfirmClear(true)}
            className="self-start sm:shrink-0"
          >
            Clear history
          </Button>
        ) : null}
      </div>

      <p className="flex items-start gap-2 text-sm text-muted">
        <ShieldCheck className="mt-0.5 size-4 shrink-0 text-brand" aria-hidden="true" />
        <span>
          <span className="font-medium text-fg">History stores only names, dates and row counts, never data.</span> It
          stays in this browser and keeps the latest {HISTORY_LIMIT} runs.
        </span>
      </p>

      <p role="status" className="sr-only">
        {announcement}
      </p>

      {!hydrated ? (
        <div role="status" className="flex flex-col gap-3">
          <span className="sr-only">Loading history</span>
          {[0, 1, 2].map((item) => (
            <div key={item} aria-hidden="true" className="rounded-xl border border-line bg-surface p-4">
              <div className="skeleton h-4 w-1/3" />
              <div className="skeleton mt-3 h-3 w-2/3" />
              <div className="skeleton mt-2 h-3 w-1/2" />
            </div>
          ))}
        </div>
      ) : entries.length === 0 ? (
        <Card>
          <EmptyState
            icon={History}
            title="No runs yet"
            description="Each time you download output files, a ZIP, a report image or a PDF, it is listed here with its row counts."
            action={
              <ButtonLink href="/workflow" variant="primary" iconRight={ArrowRight}>
                Start a workflow
              </ButtonLink>
            }
          />
        </Card>
      ) : (
        <div ref={listRef} className="flex flex-col gap-6">
          <p className="text-sm text-muted">{plural(entries.length, "run")}</p>
          {groups.map((group) => {
            const headingId = `history-day-${group.key}`;
            return (
              <section key={group.key} aria-labelledby={headingId} className="flex flex-col gap-2">
                <h2 id={headingId} className="text-sm font-semibold text-fg">
                  {dayLabel(group.time, now)}{" "}
                  <span className="font-normal text-muted">({plural(group.entries.length, "run")})</span>
                </h2>
                <Card>
                  <ul className="divide-y divide-line">
                    {group.entries.map((entry) => (
                      <li key={entry.id} className="py-3 pr-2 pl-4 sm:py-4">
                        <RunItem
                          entry={entry}
                          now={now}
                          time="clock"
                          actions={
                            <IconButton
                              icon={X}
                              size="sm"
                              label={`Remove ${runTitle(entry)}, ${formatClock(runTime(entry))}, from history`}
                              data-remove-run={entry.id}
                              onClick={() => removeEntry(entry)}
                              className="tap-target -mt-1 text-muted usable-hover:text-danger"
                            />
                          }
                        />
                      </li>
                    ))}
                  </ul>
                </Card>
              </section>
            );
          })}
        </div>
      )}

      <ConfirmDialog
        open={confirmClear}
        title="Clear history?"
        message={`This removes all ${plural(entries.length, "run")} from this device. Templates, drafts and your files are not affected.`}
        confirmLabel="Clear history"
        tone="danger"
        onConfirm={confirmClearHistory}
        onCancel={() => setConfirmClear(false)}
      />
    </div>
  );
}
