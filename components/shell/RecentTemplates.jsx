"use client";

import { ArrowRight, LayoutTemplate } from "lucide-react";
import Link from "next/link";
import { useMemo } from "react";
import TemplateCard from "@/components/TemplateCard";
import { Card, EmptyState } from "@/components/ui";
import ButtonLink from "@/components/ui/ButtonLink";
import { useTemplateStore } from "@/store/useTemplateStore";

const LIMIT = 3;

/** ISO timestamps sort correctly as strings. */
function newestFirst(a, b) {
  const dateA = String(a.updatedAt || a.createdAt || "");
  const dateB = String(b.updatedAt || b.createdAt || "");
  return dateA > dateB ? -1 : dateA < dateB ? 1 : 0;
}

/**
 * "Recent templates" on the landing page: the latest few saved templates.
 * Templates live in localStorage, so nothing but a skeleton is shown until the
 * store has hydrated (an empty state before that would be a lie).
 */
export default function RecentTemplates() {
  const templates = useTemplateStore((state) => state.templates);
  const hasHydrated = useTemplateStore((state) => state.hasHydrated);
  // Derived here, never inside the selector (zustand 5 needs stable selector results).
  const recent = useMemo(() => templates.slice().sort(newestFirst).slice(0, LIMIT), [templates]);

  return (
    <section aria-labelledby="recent-templates-heading" className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between gap-4">
        <h2 id="recent-templates-heading" className="text-base font-semibold text-fg">
          Recent templates
        </h2>
        {hasHydrated && templates.length > 0 ? (
          <Link
            href="/templates"
            className="tap-target inline-flex items-center gap-1 rounded-sm text-sm font-medium text-brand underline-offset-4 hover:underline"
          >
            {templates.length > LIMIT ? `View all ${templates.length}` : "Manage templates"}
            <ArrowRight className="size-3.5" aria-hidden="true" />
          </Link>
        ) : null}
      </div>

      {!hasHydrated ? (
        <div role="status" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <span className="sr-only">Loading templates</span>
          {[0, 1, 2].map((item) => (
            <div key={item} aria-hidden="true" className="rounded-xl border border-line bg-surface p-4">
              <div className="skeleton h-4 w-2/3" />
              <div className="skeleton mt-3 h-3 w-full" />
              <div className="skeleton mt-2 h-3 w-1/2" />
            </div>
          ))}
        </div>
      ) : recent.length === 0 ? (
        <Card>
          <EmptyState
            icon={LayoutTemplate}
            title="No templates yet"
            description="Save a workflow as a template and next month's file takes one upload. You can also import a template file."
            action={
              <ButtonLink href="/templates" iconRight={ArrowRight}>
                Go to templates
              </ButtonLink>
            }
          />
        </Card>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {recent.map((template) => (
            <li key={template.id} className="min-w-0">
              <TemplateCard template={template} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
