"use client";

import { FolderDown, LayoutTemplate, Plus, Search, SearchX, Sparkles, Upload } from "lucide-react";
import Link from "next/link";
import { useMemo, useRef, useState } from "react";
import TemplateCard from "@/components/TemplateCard";
import { importTemplateFiles, importTemplateText } from "@/components/templates/importer";
import { Button, Card, EmptyState, Field, Input, Modal, Notice } from "@/components/ui";
import { downloadJSON } from "@/lib/download";
import { normalizeName } from "@/lib/schema";
import { storageUsage } from "@/lib/storage";
import { bundleFileName, serializeTemplates } from "@/lib/templates";
import { toast } from "@/lib/toast";
import { useTemplateStore } from "@/store/useTemplateStore";

const SAMPLE_URL = "/samples/sample-template.json";
const SEARCH_FROM = 4; // show the search box from this many templates

const plural = (count, word) => `${count} ${word}${count === 1 ? "" : "s"}`;

function updatedTime(template) {
  const time = Date.parse(template.updatedAt);
  return Number.isFinite(time) ? time : 0;
}

function formatUsage(bytes) {
  if (bytes < 1024) return "less than 1 KB";
  if (bytes < 1024 * 1024) return `about ${Math.round(bytes / 1024)} KB`;
  return `about ${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function listNames(templates) {
  const names = templates.slice(0, 3).map((template) => `"${template.name}"`);
  const more = templates.length - names.length;
  return more > 0 ? `${names.join(", ")} and ${more} more` : names.join(", ");
}

/** What went wrong (or was skipped) in an import, file by file. */
function ImportReport({ report }) {
  return (
    <div className="flex flex-col gap-4">
      {report.added.length ? (
        <Notice tone="success" title={`Imported ${plural(report.added.length, "template")}`}>
          {listNames(report.added)}
        </Notice>
      ) : null}
      {report.problems.map((problem, index) => (
        <section key={`${problem.source}-${index}`} className="min-w-0">
          <h3 className="text-sm font-semibold break-words text-fg">{problem.source}</h3>
          <ul className="mt-1.5 flex list-disc flex-col gap-1 pl-5 text-sm break-words text-muted">
            {[...problem.errors, ...problem.warnings].map((message, i) => (
              <li key={i}>{message}</li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function LoadingGrid() {
  return (
    <div role="status" className="grid gap-4 md:grid-cols-2">
      <span className="sr-only">Loading your templates</span>
      {[0, 1].map((item) => (
        <div key={item} aria-hidden="true" className="h-44 animate-pulse rounded-xl border border-line bg-surface-2" />
      ))}
    </div>
  );
}

/** The Templates page (owner: Agent D): browse, search, import and export saved templates. */
export default function TemplatesView() {
  const templates = useTemplateStore((state) => state.templates);
  const hasHydrated = useTemplateStore((state) => state.hasHydrated);
  const fileInputRef = useRef(null);

  const [query, setQuery] = useState("");
  const [importing, setImporting] = useState(false);
  const [loadingSample, setLoadingSample] = useState(false);
  const [report, setReport] = useState(null); // { added, problems } shown in the import dialog

  const sorted = useMemo(() => [...templates].sort((a, b) => updatedTime(b) - updatedTime(a)), [templates]);
  const needle = normalizeName(query);
  const visible = useMemo(() => {
    if (!needle) return sorted;
    return sorted.filter((template) =>
      normalizeName(`${template.name} ${template.description} ${(template.tags || []).join(" ")}`).includes(needle),
    );
  }, [sorted, needle]);
  const usage = useMemo(() => (hasHydrated && templates.length ? storageUsage() : 0), [hasHydrated, templates]);

  const showSearch = templates.length >= SEARCH_FROM || Boolean(query);

  /** Toast what was added; open the dialog when something failed or was skipped. */
  const announce = ({ added, reports }) => {
    const problems = reports.filter((item) => item.errors.length || item.skipped);
    if (added.length && !problems.length) {
      const notes = reports.flatMap((item) => item.warnings);
      toast.success(`Imported ${plural(added.length, "template")}`, {
        description: [listNames(added), ...notes].join(" "),
      });
    }
    if (problems.length) setReport({ added, problems });
  };

  const pickFiles = () => {
    if (fileInputRef.current) fileInputRef.current.click();
  };

  const onFilesPicked = async (event) => {
    const input = event.target;
    const files = Array.from(input.files || []);
    input.value = ""; // picking the same file again must fire "change" again
    if (!files.length) return;
    setImporting(true);
    try {
      announce(await importTemplateFiles(files));
    } catch {
      toast.error("The import failed", { description: "The selected files could not be read. Please try again." });
    } finally {
      setImporting(false);
    }
  };

  const loadSample = async () => {
    setLoadingSample(true);
    try {
      const response = await fetch(SAMPLE_URL, { cache: "no-store" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const result = importTemplateText(await response.text());
      announce({ added: result.added, reports: [{ source: "Sample template", ...result }] });
    } catch {
      toast.error("The sample template could not be loaded", { description: "Check your connection and try again." });
    } finally {
      setLoadingSample(false);
    }
  };

  const exportAll = () => {
    try {
      const fileName = bundleFileName();
      downloadJSON(serializeTemplates(sorted), fileName);
      toast.success(`Exported ${plural(sorted.length, "template")}`, { description: fileName });
    } catch {
      toast.error("Could not export the templates", { description: "The download could not be started. Please try again." });
    }
  };

  let content;
  if (!hasHydrated) {
    content = <LoadingGrid />;
  } else if (!templates.length) {
    content = (
      <Card>
        <EmptyState
          icon={LayoutTemplate}
          title="No templates yet"
          description="A template remembers how you shaped a file: the sheet, the columns, the transforms, the filters and the outputs. Save one from a workflow, import a template file, or start with the sample."
          action={
            <div className="flex flex-wrap items-center justify-center gap-2">
              <Button variant="primary" icon={Upload} loading={importing} onClick={pickFiles}>
                Import a template
              </Button>
              <Button icon={Sparkles} loading={loadingSample} onClick={loadSample}>
                Load the sample template
              </Button>
            </div>
          }
        />
      </Card>
    );
  } else if (!visible.length) {
    content = (
      <Card>
        <EmptyState
          icon={SearchX}
          title="No templates match your search"
          description={`Nothing matches "${query.trim()}". Search looks at names and descriptions.`}
          action={<Button onClick={() => setQuery("")}>Clear search</Button>}
        />
      </Card>
    );
  } else {
    content = (
      <ul className="grid gap-4 md:grid-cols-2">
        {visible.map((template) => (
          <li key={template.id} className="grid min-w-0">
            <TemplateCard template={template} />
          </li>
        ))}
      </ul>
    );
  }

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 p-4 sm:p-6">
      <header className="flex flex-wrap items-start justify-between gap-x-6 gap-y-4">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold text-fg">Templates</h1>
          <p className="mt-1 max-w-xl text-sm text-muted">
            Workflows you saved to reuse on the next file. A template holds settings only, never your spreadsheet data.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {hasHydrated && templates.length > 1 ? (
            <Button variant="ghost" icon={FolderDown} onClick={exportAll}>
              Export all
            </Button>
          ) : null}
          <Button icon={Upload} loading={importing} onClick={pickFiles}>
            Import from JSON
          </Button>
          <Link
            href="/workflow"
            className="inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-lg bg-brand px-4 text-sm font-medium whitespace-nowrap text-brand-fg transition-colors hover:bg-brand-hover"
          >
            <Plus className="size-4" aria-hidden="true" />
            New workflow
          </Link>
        </div>
      </header>

      <input
        ref={fileInputRef}
        type="file"
        accept=".json,application/json"
        multiple
        hidden
        tabIndex={-1}
        aria-hidden="true"
        onChange={onFilesPicked}
      />

      {showSearch ? (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <Field label="Search templates" hideLabel className="w-full sm:max-w-sm">
            {(props) => (
              <div className="relative">
                <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" aria-hidden="true" />
                <Input
                  {...props}
                  type="search"
                  value={query}
                  placeholder="Search templates"
                  autoComplete="off"
                  className="pl-9"
                  onChange={(event) => setQuery(event.target.value)}
                />
              </div>
            )}
          </Field>
          <p role="status" className="text-sm text-muted">
            {needle ? `Showing ${visible.length} of ${plural(templates.length, "template")}` : plural(templates.length, "template")}
          </p>
        </div>
      ) : null}

      {content}

      {hasHydrated && templates.length ? (
        <p className="text-xs text-muted">
          Templates are stored in this browser only ({formatUsage(usage)} of browser storage in use). Export them as JSON to keep a
          backup or to move them to another computer.
        </p>
      ) : null}

      <Modal
        open={report !== null}
        onClose={() => setReport(null)}
        title={report && report.added.length ? "Imported with problems" : "Could not import"}
        description={
          report && report.added.length
            ? "Some templates were added. The entries below were not."
            : "Nothing was added. Fix the problems below and try again."
        }
        footer={
          <Button variant="primary" onClick={() => setReport(null)}>
            Close
          </Button>
        }
      >
        {report ? <ImportReport report={report} /> : null}
      </Modal>
    </main>
  );
}
