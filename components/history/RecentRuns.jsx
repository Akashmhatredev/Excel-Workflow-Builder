"use client";

import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { Card } from "@/components/ui";
import { useHistory, useNow } from "./hooks";
import RunItem from "./RunItem";

const LIMIT = 5;

/**
 * "Recent runs" on the landing page: the latest downloads from lib/history.js.
 * The log lives in localStorage, so like "Continue where you left off" it renders nothing on
 * the server and in the hydration render, and nothing at all until there is a first run
 * (the History page has the empty state).
 */
export default function RecentRuns() {
  const entries = useHistory();
  const now = useNow();
  if (!entries.length) return null;
  const recent = entries.slice(0, LIMIT);

  return (
    <section aria-labelledby="recent-runs-heading" className="flex animate-fade-in flex-col gap-3">
      <div className="flex items-baseline justify-between gap-4">
        <h2 id="recent-runs-heading" className="text-base font-semibold text-fg">
          Recent runs
        </h2>
        <Link
          href="/history"
          className="tap-target inline-flex items-center gap-1 rounded-sm text-sm font-medium text-brand underline-offset-4 hover:underline"
        >
          {entries.length > LIMIT ? `View all ${entries.length}` : "View history"}
          <ArrowRight className="size-3.5" aria-hidden="true" />
        </Link>
      </div>
      <Card>
        <ul className="divide-y divide-line">
          {recent.map((entry) => (
            <li key={entry.id} className="p-4">
              <RunItem entry={entry} now={now} maxOutputs={4} />
            </li>
          ))}
        </ul>
      </Card>
      <p className="text-xs text-muted">The history keeps only names, dates and row counts, never the data itself.</p>
    </section>
  );
}
