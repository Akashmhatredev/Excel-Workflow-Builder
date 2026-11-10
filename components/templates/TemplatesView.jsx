"use client";

import { Check, Folder, FolderDown, LayoutTemplate, Plus, Search, SearchX, Sparkles, Tag, Upload, X } from "lucide-react";
import Link from "next/link";
import { useId, useMemo, useRef, useState } from "react";
import TemplateCard from "@/components/TemplateCard";
import AliasManager from "@/components/templates/AliasManager";
import { importTemplateFiles, importTemplateText } from "@/components/templates/importer";
import SharedTemplateImport from "@/components/templates/SharedTemplateImport";
import { Button, Card, EmptyState, Field, Input, Modal, Notice, Select } from "@/components/ui";
import { downloadJSON } from "@/lib/download";
import { normalizeName } from "@/lib/schema";
import { storageUsage } from "@/lib/storage";
import {
  NO_FOLDER,
  bundleFileName,
  filterTemplates,
  groupTemplatesByFolder,
  serializeTemplates,
  templateFolders,
  templateTags,
} from "@/lib/templates";
import { toast } from "@/lib/toast";
import { useTemplateStore } from "@/store/useTemplateStore";

const SAMPLE_URL = "/samples/sample-template.json";
const SEARCH_FROM = 4; // show the search box from this many templates

/** <select> values of the folder filter. A folder's own value is FOLDER_PREFIX + its name. */
const ALL_FOLDERS = "all";
const LOOSE_FOLDER = "none";
const FOLDER_PREFIX = "folder:";

const plural = (count, word) => `${count} ${word}${count === 1 ? "" : "s"}`;
const sameText = (a, b) => a.toLowerCase() === b.toLowerCase();

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

/** A grid of cards. */
function CardGrid({ templates, showFolder }) {
  return (
    <ul className="grid gap-4 md:grid-cols-2">
      {templates.map((template) => (
        <li key={template.id} className="grid min-w-0">
          <TemplateCard template={template} showFolder={showFolder} />
        </li>
      ))}
    </ul>
  );
}

/** One folder's heading and cards (folder "" = templates without a folder). */
function FolderGroup({ folder, templates }) {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-3">
      <h2 id={headingId} className="flex min-w-0 items-center gap-2 text-sm font-semibold text-fg">
        <Folder className="size-4 shrink-0 text-muted" aria-hidden="true" />
        <span className="truncate">{folder || "No folder"}</span>
        <span className="font-normal text-muted">({templates.length})</span>
      </h2>
      <CardGrid templates={templates} showFolder={false} />
    </section>
  );
}

/** The Templates page (owner: Agent D / X4): browse, search, filter, import, export and share saved templates. */
export default function TemplatesView() {
  const templates = useTemplateStore((state) => state.templates);
  const hasHydrated = useTemplateStore((state) => state.hasHydrated);
  const fileInputRef = useRef(null);

  const [query, setQuery] = useState("");
  const [folderChoice, setFolderChoice] = useState(null); // null = all, "" = no folder, otherwise a folder name
  const [tagChoice, setTagChoice] = useState([]); // selected tags; a template must carry all of them
  const [importing, setImporting] = useState(false);
  const [loadingSample, setLoadingSample] = useState(false);
  const [report, setReport] = useState(null); // { added, problems } shown in the import dialog

  const sorted = useMemo(() => [...templates].sort((a, b) => updatedTime(b) - updatedTime(a)), [templates]);
  const folders = useMemo(() => templateFolders(templates), [templates]);
  const tagStats = useMemo(() => templateTags(templates), [templates]);
  const folderCounts = useMemo(() => {
    const counts = new Map();
    for (const template of templates) {
      const key = (template.folder || "").toLowerCase();
      counts.set(key, (counts.get(key) || 0) + 1);
    }
    return counts;
  }, [templates]);
  const looseCount = folderCounts.get("") || 0;

  // A choice that no longer exists (its last template was deleted or moved) quietly falls back to "all".
  const activeFolder =
    folderChoice === null
      ? null
      : folderChoice === NO_FOLDER
        ? looseCount && folders.length
          ? NO_FOLDER
          : null
        : folders.find((name) => sameText(name, folderChoice)) ?? null;
  const activeTags = useMemo(
    () => tagStats.map((entry) => entry.tag).filter((tag) => tagChoice.some((chosen) => sameText(chosen, tag))),
    [tagStats, tagChoice],
  );
  const needle = normalizeName(query);
  const visible = useMemo(
    () => filterTemplates(sorted, { query: needle, folder: activeFolder, tags: activeTags }),
    [sorted, needle, activeFolder, activeTags],
  );
  const grouped = activeFolder === null && folders.length > 0;
  const groups = useMemo(() => (grouped ? groupTemplatesByFolder(visible) : []), [grouped, visible]);
  const usage = useMemo(() => (hasHydrated && templates.length ? storageUsage() : 0), [hasHydrated, templates]);

  const filtering = Boolean(needle) || activeFolder !== null || activeTags.length > 0;
  const showSearch = templates.length >= SEARCH_FROM || Boolean(query);
  const showFolderFilter = folders.length > 0;
  const showTagFilter = tagStats.length > 0 && templates.length > 1;
  const showToolbar = hasHydrated && templates.length > 0 && (showSearch || showFolderFilter || showTagFilter || filtering);

  const folderValue =
    activeFolder === null ? ALL_FOLDERS : activeFolder === NO_FOLDER ? LOOSE_FOLDER : `${FOLDER_PREFIX}${activeFolder}`;
  const onFolderSelect = (value) => {
    if (value === ALL_FOLDERS) setFolderChoice(null);
    else if (value === LOOSE_FOLDER) setFolderChoice(NO_FOLDER);
    else setFolderChoice(value.slice(FOLDER_PREFIX.length));
  };
  const toggleTag = (tag) =>
    setTagChoice((current) =>
      current.some((chosen) => sameText(chosen, tag)) ? current.filter((chosen) => !sameText(chosen, tag)) : [...current, tag],
    );
  const clearFilters = () => {
    setQuery("");
    setFolderChoice(null);
    setTagChoice([]);
  };

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
    const parts = [];
    if (needle) parts.push(`matches "${query.trim()}"`);
    if (activeFolder !== null) parts.push(activeFolder ? `is in the folder "${activeFolder}"` : "is outside every folder");
    if (activeTags.length) parts.push(`is tagged ${activeTags.map((tag) => `"${tag}"`).join(" and ")}`);
    content = (
      <Card>
        <EmptyState
          icon={SearchX}
          title="No templates match"
          description={`No template ${parts.join(" and ")}. Search looks at names, descriptions, tags and folders.`}
          action={<Button onClick={clearFilters}>Clear filters</Button>}
        />
      </Card>
    );
  } else if (grouped) {
    content = (
      <div className="flex flex-col gap-8">
        {groups.map((group) => (
          <FolderGroup key={group.folder.toLowerCase() || "\u0000"} folder={group.folder} templates={group.templates} />
        ))}
      </div>
    );
  } else {
    content = <CardGrid templates={visible} showFolder={activeFolder === null} />;
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

      {showToolbar ? (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-end gap-x-4 gap-y-3">
            {showSearch ? (
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
            ) : null}
            {showFolderFilter ? (
              <Field label="Folder" hideLabel className="w-full sm:w-56">
                {(props) => (
                  <Select {...props} value={folderValue} onChange={(event) => onFolderSelect(event.target.value)}>
                    <option value={ALL_FOLDERS}>All folders ({templates.length})</option>
                    {folders.map((name) => (
                      <option key={name} value={`${FOLDER_PREFIX}${name}`}>
                        {name} ({folderCounts.get(name.toLowerCase()) || 0})
                      </option>
                    ))}
                    {looseCount ? <option value={LOOSE_FOLDER}>No folder ({looseCount})</option> : null}
                  </Select>
                )}
              </Field>
            ) : null}
            <p role="status" className="text-sm text-muted sm:pb-2.5">
              {filtering ? `Showing ${visible.length} of ${plural(templates.length, "template")}` : plural(templates.length, "template")}
            </p>
            {filtering ? (
              <Button variant="ghost" size="sm" icon={X} className="sm:mb-1" onClick={clearFilters}>
                Clear filters
              </Button>
            ) : null}
          </div>

          {showTagFilter ? (
            <div role="group" aria-label="Filter by tag" className="flex flex-wrap items-center gap-1.5">
              <span className="mr-1 text-sm text-muted" aria-hidden="true">
                Tags:
              </span>
              {tagStats.map(({ tag, count }) => {
                const pressed = activeTags.some((active) => sameText(active, tag));
                return (
                  <Button
                    key={tag}
                    size="sm"
                    variant={pressed ? "soft" : "ghost"}
                    icon={pressed ? Check : Tag}
                    aria-pressed={pressed}
                    aria-label={`${tag}, ${plural(count, "template")}`}
                    className={pressed ? "tap-target ring-1 ring-brand/40" : "tap-target border border-line"}
                    onClick={() => toggleTag(tag)}
                  >
                    <span className="max-w-[12rem] truncate">{tag}</span>
                    <span className="text-xs text-muted">{count}</span>
                  </Button>
                );
              })}
            </div>
          ) : null}
        </div>
      ) : null}

      {content}

      {hasHydrated ? <AliasManager /> : null}

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

      <SharedTemplateImport />
    </main>
  );
}
