"use client";

import { Layers, LayoutTemplate, Play, Plus, ShieldCheck, Square } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import BatchResults from "@/components/batch/BatchResults";
import FileQueue from "@/components/batch/FileQueue";
import { listNames, localDate, plural } from "@/components/batch/format";
import { Badge, Button, Card, Checkbox, EmptyState, Field, Notice, SectionHeader, Select } from "@/components/ui";
import ButtonLink from "@/components/ui/ButtonLink";
import { BATCH_MAX_FILES, isSpreadsheetFile, runBatch } from "@/lib/batch";
import { downloadBytes } from "@/lib/download";
import { logRun } from "@/lib/history";
import { collectColumnRefs, createId, isLookupConfigured, outputFileName } from "@/lib/schema";
import { groupTemplatesByFolder } from "@/lib/templates";
import { toast } from "@/lib/toast";
import { useTemplateStore } from "@/store/useTemplateStore";
import { useWorkflowStore } from "@/store/useWorkflowStore";

const CURRENT = "__current__";

const fileKey = (file) => `${file.name}\u0000${file.size}\u0000${file.lastModified}`;
const byName = (a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base", numeric: true });

function updatedTime(template) {
  const time = Date.parse(template.updatedAt);
  return Number.isFinite(time) ? time : 0;
}

function phaseText(progress) {
  if (!progress) return "";
  if (progress.phase === "reading") return "Reading the file";
  if (progress.phase === "loading") return "Loading the sheet and matching columns";
  if (progress.phase === "building") {
    const count = progress.outputCount || 1;
    return `Building "${progress.outputName || "output"}"${count > 1 ? ` (${(progress.outputIndex || 0) + 1} of ${count})` : ""}`;
  }
  if (progress.phase === "zipping") return "Zipping the results";
  return "";
}

function percentOf(progress) {
  if (!progress || !progress.total) return 0;
  if (progress.phase === "zipping") return 98;
  let within = 0.05;
  if (progress.phase === "loading") within = 0.25;
  if (progress.phase === "building") within = 0.35 + 0.65 * ((progress.outputIndex || 0) / Math.max(1, progress.outputCount || 1));
  return Math.min(97, Math.round(((progress.index + within) / progress.total) * 100));
}

/** What the chosen template will do: sheet, columns it needs, outputs. */
function DefinitionSummary({ definition }) {
  const refs = useMemo(() => collectColumnRefs(definition), [definition]);
  const sheets = definition.source.sheetNames;
  const outputs = definition.outputs;
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-line bg-surface-2 p-3 text-sm">
      <p className="text-muted">
        {sheets.length ? `Reads the sheet ${listNames(sheets)}` : "Reads the first sheet with data"}
        {definition.source.headerRow > 1 ? `, with the column names in row ${definition.source.headerRow}` : ""}
        {sheets.length ? " (or the first sheet with data when a file has no such sheet)." : "."}
      </p>
      {refs.length ? (
        <p className="text-muted">
          Needs {plural(refs.length, "column")}: <span className="text-fg">{listNames(refs, 8)}</span>.
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-muted">Builds</span>
        {outputs.length ? (
          outputs.map((output) => (
            <Badge key={output.id} tone="brand">
              {outputFileName(output)}
            </Badge>
          ))
        ) : (
          <span className="text-fg">nothing yet</span>
        )}
        <span className="text-muted">for every file.</span>
      </div>
    </div>
  );
}

/**
 * Batch mode (owner: X4): pick a template (or the workflow being built), queue several files,
 * run them one at a time in the worker, then download one zip with a folder per file.
 * `?template=<id>` preselects a template (the "Run on several files" card action).
 */
export default function BatchView() {
  const searchParams = useSearchParams();
  const requestedId = searchParams ? searchParams.get("template") : null;

  const templates = useTemplateStore((state) => state.templates);
  const hasHydrated = useTemplateStore((state) => state.hasHydrated);
  const workflowDefinition = useWorkflowStore((state) => state.definition);
  const workflowTemplateName = useWorkflowStore((state) => state.templateName);
  const lookupStatus = useWorkflowStore((state) => state.lookupStatus);
  const lookupFile = useWorkflowStore((state) => state.lookupFile);

  const [choice, setChoice] = useState(null); // a template id, CURRENT, or null (use the default)
  const [queue, setQueue] = useState([]); // [{ id, file }]
  const [joinLookup, setJoinLookup] = useState(true);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(null);
  const [run, setRun] = useState(null); // { result, templateName, logged }
  const abortRef = useRef(null);

  // Leaving the page stops a running batch after its current step.
  useEffect(() => {
    const controllerRef = abortRef;
    return () => {
      if (controllerRef.current) controllerRef.current.abort();
    };
  }, []);

  const currentUsable = workflowDefinition.fields.length > 0 && workflowDefinition.outputs.length > 0;
  const recent = useMemo(() => [...templates].sort((a, b) => updatedTime(b) - updatedTime(a)), [templates]);
  const groups = useMemo(() => groupTemplatesByFolder([...templates].sort(byName)), [templates]);
  const hasFolders = groups.some((group) => group.folder);

  let selectedId = "";
  if (choice === CURRENT && currentUsable) selectedId = CURRENT;
  else if (choice && choice !== CURRENT && templates.some((template) => template.id === choice)) selectedId = choice;
  else if (requestedId && templates.some((template) => template.id === requestedId)) selectedId = requestedId;
  else if (recent.length) selectedId = recent[0].id;
  else if (currentUsable) selectedId = CURRENT;

  const selectedTemplate = selectedId && selectedId !== CURRENT ? templates.find((template) => template.id === selectedId) : null;
  const definition = selectedId === CURRENT ? workflowDefinition : selectedTemplate ? selectedTemplate.definition : null;
  const templateName =
    selectedId === CURRENT
      ? workflowTemplateName
        ? `${workflowTemplateName} (current workflow)`
        : "Current workflow"
      : selectedTemplate
        ? selectedTemplate.name
        : "";

  const lookupConfigured = Boolean(definition && isLookupConfigured(definition.lookup));
  const lookupReady = lookupStatus === "ready" && Boolean(lookupFile);
  const useLookup = lookupConfigured && lookupReady && joinLookup;
  const hasOutputs = Boolean(definition && definition.outputs.length);
  const canRun = Boolean(definition) && hasOutputs && queue.length > 0 && !running;

  const addFiles = (incoming) => {
    const keys = new Set(queue.map((entry) => fileKey(entry.file)));
    const accepted = [];
    const rejected = [];
    let duplicates = 0;
    for (const file of incoming) {
      if (!isSpreadsheetFile(file)) {
        rejected.push(file.name);
        continue;
      }
      const key = fileKey(file);
      if (keys.has(key)) {
        duplicates += 1;
        continue;
      }
      keys.add(key);
      accepted.push(file);
    }
    const room = Math.max(0, BATCH_MAX_FILES - queue.length);
    const kept = accepted.slice(0, room);
    if (kept.length) setQueue((current) => [...current, ...kept.map((file) => ({ id: createId("file"), file }))]);
    if (rejected.length) {
      toast.warning(`${plural(rejected.length, "file was", "files were")} skipped`, {
        description: `${listNames(rejected, 3)} ${rejected.length === 1 ? "is not a" : "are not"} spreadsheet${rejected.length === 1 ? "" : "s"}. Use .xlsx, .xls, .xlsm, .csv or .tsv files.`,
      });
    }
    if (accepted.length > kept.length) {
      toast.warning(`At most ${BATCH_MAX_FILES} files per batch`, {
        description: `${plural(accepted.length - kept.length, "file was", "files were")} not added. Run the rest as a second batch.`,
      });
    }
    if (duplicates) toast.info(`${plural(duplicates, "file is", "files are")} already in the list`);
  };

  const removeFile = (id) => setQueue((current) => current.filter((entry) => entry.id !== id));
  const clearFiles = () => setQueue([]);

  const start = async () => {
    if (!canRun) return;
    const controller = new AbortController();
    abortRef.current = controller;
    const files = queue.map((entry) => entry.file);
    const name = templateName;
    setRunning(true);
    setRun(null);
    setProgress({ index: 0, total: files.length, fileName: files[0].name, phase: "reading" });
    try {
      const result = await runBatch({
        files,
        definition,
        zipName: `${name} batch ${localDate()}`,
        useLookup,
        signal: controller.signal,
        onProgress: setProgress,
      });
      if (controller.signal.aborted && abortRef.current !== controller) return; // the page was left
      setRun({ result, templateName: name, logged: false });
      const { summary } = result;
      if (result.cancelled) toast.info("Batch stopped", { description: `${summary.succeeded} of ${plural(summary.files, "file")} were processed.` });
      else if (!result.bytes) toast.error("No file could be processed", { description: "See the results for the reasons." });
      else if (summary.failed) toast.warning("Batch finished with problems", { description: `${summary.succeeded} of ${plural(summary.files, "file")} processed.` });
      else toast.success("Batch finished", { description: `${plural(summary.files, "file")} processed. Download the zip below.` });
    } catch (error) {
      toast.error("The batch could not run", { description: (error && error.message) || "Please try again." });
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      setRunning(false);
      setProgress(null);
    }
  };

  const stop = () => {
    if (abortRef.current) abortRef.current.abort();
  };

  const download = () => {
    if (!run || !run.result.bytes) return;
    try {
      downloadBytes(run.result.bytes, run.result.fileName, run.result.mime);
    } catch {
      toast.error("The download could not be started", { description: "Please try again." });
      return;
    }
    if (!run.logged) {
      logRun({
        kind: "batch",
        templateName: run.templateName,
        fileName: plural(run.result.summary.files, "file"),
        outputs: run.result.summary.outputs,
      });
      setRun({ ...run, logged: true });
    }
    toast.success("Zip downloaded", { description: run.result.fileName });
  };

  if (!hasHydrated) {
    return (
      <div role="status" className="grid gap-4 lg:grid-cols-2">
        <span className="sr-only">Loading your templates</span>
        {[0, 1].map((item) => (
          <div key={item} aria-hidden="true" className="h-56 animate-pulse rounded-xl border border-line bg-surface-2" />
        ))}
      </div>
    );
  }

  if (!templates.length && !currentUsable) {
    return (
      <Card>
        <EmptyState
          icon={Layers}
          title="No templates yet"
          description="Batch mode applies a saved template to several files at once. Build a workflow and save it as a template, or import a template file, then come back here."
          action={
            <div className="flex flex-wrap items-center justify-center gap-2">
              <ButtonLink href="/workflow" variant="primary" icon={Plus}>
                Start a workflow
              </ButtonLink>
              <ButtonLink href="/templates" icon={LayoutTemplate}>
                Go to templates
              </ButtonLink>
            </div>
          }
        />
      </Card>
    );
  }

  const percent = percentOf(progress);

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 lg:grid-cols-2">
        <Card as="section" aria-labelledby="batch-template-heading" className="flex min-w-0 flex-col gap-4 p-4 sm:p-5">
          <SectionHeader
            title={<span id="batch-template-heading">1. Choose a template</span>}
            description="The same settings are applied to every file."
          />
          <Field label="Template">
            {(props) => (
              <Select {...props} value={selectedId} disabled={running} onChange={(event) => setChoice(event.target.value)}>
                {currentUsable ? (
                  <optgroup label="Not saved yet">
                    <option value={CURRENT}>
                      {workflowTemplateName ? `Current workflow (from "${workflowTemplateName}")` : "Current workflow"}
                    </option>
                  </optgroup>
                ) : null}
                {hasFolders || currentUsable
                  ? groups.map((group) => (
                      <optgroup key={group.folder.toLowerCase() || "\u0000"} label={group.folder || (hasFolders ? "No folder" : "Saved templates")}>
                        {group.templates.map((template) => (
                          <option key={template.id} value={template.id}>
                            {template.name}
                          </option>
                        ))}
                      </optgroup>
                    ))
                  : groups.flatMap((group) =>
                      group.templates.map((template) => (
                        <option key={template.id} value={template.id}>
                          {template.name}
                        </option>
                      )),
                    )}
              </Select>
            )}
          </Field>

          {!templates.length ? (
            <Notice tone="info" title="No saved templates">
              Batch mode will use the workflow you are building. Save it as a template to reuse it later.
            </Notice>
          ) : null}

          {definition ? <DefinitionSummary definition={definition} /> : null}

          {definition && !hasOutputs ? (
            <Notice tone="warning" title="This template has no outputs">
              Open it in the workflow and add an output in the Outputs step, then save it again.
            </Notice>
          ) : null}

          {lookupConfigured ? (
            lookupReady ? (
              <Checkbox
                label={`Merge the lookup file "${lookupFile.name}" into every file`}
                description="It is the lookup file loaded in the workflow."
                checked={joinLookup}
                disabled={running}
                onChange={setJoinLookup}
              />
            ) : (
              <Notice tone="info" title="This template merges a lookup file">
                Batch mode can only use a lookup file that is loaded in the workflow. None is loaded, so the lookup columns will be
                reported as missing.
              </Notice>
            )
          ) : null}
        </Card>

        <Card as="section" aria-labelledby="batch-files-heading" className="flex min-w-0 flex-col gap-4 p-4 sm:p-5">
          <SectionHeader
            title={<span id="batch-files-heading">2. Add files</span>}
            description="Files with renamed columns are matched by name, ignoring case, and by your saved column aliases."
          />
          <FileQueue entries={queue} onAdd={addFiles} onRemove={removeFile} onClear={clearFiles} disabled={running} />
        </Card>
      </div>

      <Card as="section" aria-labelledby="batch-run-heading" className="flex min-w-0 flex-col gap-4 p-4 sm:p-5">
        <SectionHeader
          title={<span id="batch-run-heading">3. Run</span>}
          actions={
            // Stop lives in the progress panel, not here: a click meant for Stop that lands just as the
            // run ends must never start the batch again.
            <Button variant="primary" icon={Play} loading={running} disabled={!canRun} onClick={start}>
              {running ? "Running" : queue.length ? `Run on ${plural(queue.length, "file")}` : "Run batch"}
            </Button>
          }
        />
        <p className="flex items-start gap-2 text-sm text-muted">
          <ShieldCheck className="mt-0.5 size-4 shrink-0 text-brand" aria-hidden="true" />
          <span>
            Each file is processed in your browser, one at a time, so memory stays low even for big batches. Nothing is uploaded.
            The zip has one folder per file with every output inside.
          </span>
        </p>

        {running && progress ? (
          <div className="flex flex-col gap-2 rounded-lg border border-line p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p role="status" className="min-w-0 text-sm font-medium break-words text-fg">
                {progress.phase === "zipping"
                  ? `Zipping the results of ${plural(progress.total, "file")}`
                  : `File ${Math.min(progress.index + 1, progress.total)} of ${progress.total}: ${progress.fileName}`}
              </p>
              <Button size="sm" icon={Square} className="tap-target" disabled={progress.phase === "zipping"} onClick={stop}>
                Stop
              </Button>
            </div>
            <div
              role="progressbar"
              aria-label="Batch progress"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={percent}
              className="h-2 overflow-hidden rounded-full bg-surface-2"
            >
              <div className="h-full rounded-full bg-brand transition-[width] duration-300" style={{ width: `${percent}%` }} />
            </div>
            <p className="text-xs text-muted">{phaseText(progress)}</p>
          </div>
        ) : null}

        {!running && !queue.length ? <p className="text-sm text-muted">Add at least one file to run the batch.</p> : null}
      </Card>

      {run ? <BatchResults result={run.result} templateName={run.templateName} onDownload={download} /> : null}
    </div>
  );
}
