import { ArrowRight, Columns3, Download, FileJson, FileSpreadsheet, FileUp, Files, LayoutTemplate } from "lucide-react";
import RecentRuns from "@/components/history/RecentRuns";
import ContinueCard from "@/components/shell/ContinueCard";
import PrivacyNote from "@/components/shell/PrivacyNote";
import RecentTemplates from "@/components/shell/RecentTemplates";
import ButtonLink from "@/components/ui/ButtonLink";

const HOW_IT_WORKS = [
  {
    icon: FileUp,
    title: "Upload",
    text: "Drop in an Excel or CSV export. Pick the sheet and the row that holds the column names.",
  },
  {
    icon: Columns3,
    title: "Map",
    text: "Choose the columns you need, rename them, combine or calculate, and clean up the values.",
  },
  {
    icon: Files,
    title: "Outputs",
    text: "Define one or more files, each with its own columns, filters, grouping and sort order.",
  },
  {
    icon: Download,
    title: "Export",
    text: "Download the files, or export a report image and share it to WhatsApp.",
  },
];

const SAMPLES = [
  {
    href: "/samples/sample-data.xlsx",
    icon: FileSpreadsheet,
    title: "Sample data",
    text: "An Excel workbook to try the four steps with.",
    meta: ".xlsx",
  },
  {
    href: "/samples/sample-template.json",
    icon: FileJson,
    title: "Sample template",
    text: "A ready-made setup for that workbook. Import it on the Templates page.",
    meta: ".json",
  },
];

// Landing / dashboard (owner: Agent E): the first screen of a working tool, not a marketing page.
export default function HomePage() {
  return (
    <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-8 px-4 py-6 sm:gap-10 sm:px-6 sm:py-10">
      <section aria-labelledby="home-heading" className="flex flex-col gap-4">
        <div className="max-w-2xl">
          <h1 id="home-heading" className="text-2xl font-semibold tracking-tight text-balance text-fg sm:text-3xl">
            Turn a raw Excel or CSV dump into clean files and shareable reports.
          </h1>
          <p className="mt-2 text-base text-pretty text-muted">
            Map the columns once, define the outputs you need, and save the setup as a template for the next file.
          </p>
        </div>
        <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center">
          <ButtonLink href="/workflow" variant="primary" size="lg" iconRight={ArrowRight}>
            Start a workflow
          </ButtonLink>
          <ButtonLink href="/templates" size="lg" icon={LayoutTemplate}>
            Browse templates
          </ButtonLink>
        </div>
        <PrivacyNote detail />
      </section>

      <ContinueCard />

      <RecentRuns />

      <RecentTemplates />

      <section aria-labelledby="how-heading" className="flex flex-col gap-3">
        <h2 id="how-heading" className="text-base font-semibold text-fg">
          How it works
        </h2>
        {/* gap-px over a line-coloured background draws the hairlines at every column count. */}
        <ol className="grid gap-px overflow-hidden rounded-xl border border-line bg-line shadow-card sm:grid-cols-2 lg:grid-cols-4">
          {HOW_IT_WORKS.map((step, index) => (
            <li key={step.title} className="flex gap-3 bg-surface p-4">
              <span
                aria-hidden="true"
                className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-surface-2 text-muted"
              >
                <step.icon className="size-[1.125rem]" />
              </span>
              <div className="min-w-0">
                <h3 className="text-sm font-semibold text-fg">
                  <span className="text-muted tabular-nums">{index + 1}.</span> {step.title}
                </h3>
                <p className="mt-1 text-sm text-pretty text-muted">{step.text}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <section aria-labelledby="samples-heading" className="flex flex-col gap-3">
        <div>
          <h2 id="samples-heading" className="text-base font-semibold text-fg">
            Try it with sample files
          </h2>
          <p className="mt-0.5 text-sm text-muted">No spreadsheet at hand? Download these and run through the steps.</p>
        </div>
        <ul className="grid gap-3 sm:grid-cols-2">
          {SAMPLES.map((sample) => (
            <li key={sample.href}>
              <a
                href={sample.href}
                download
                className="group flex h-full items-center gap-3 rounded-xl border border-line bg-surface p-4 shadow-card transition-colors duration-150 hover:border-line-strong hover:bg-surface-2"
              >
                <span
                  aria-hidden="true"
                  className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-surface-2 text-muted transition-colors duration-150 group-hover:bg-surface"
                >
                  <sample.icon className="size-[1.125rem]" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold text-fg">
                    {sample.title} <span className="font-mono text-xs font-normal text-muted">{sample.meta}</span>
                  </span>
                  <span className="mt-0.5 block text-sm text-muted">{sample.text}</span>
                </span>
                <Download className="size-4 shrink-0 text-muted" aria-hidden="true" />
                <span className="sr-only">(download)</span>
              </a>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
