"use client";

import { Download } from "lucide-react";
import Link from "next/link";
import { formatBytes, formatCount, listNames, plural } from "@/components/batch/format";
import { Badge, Button, Card, Notice, SectionHeader } from "@/components/ui";

function statusOf(entry) {
  if (entry.skipped) return { tone: "neutral", label: "Not processed" };
  if (!entry.ok && !entry.outputs.length) return { tone: "danger", label: "Failed" };
  if (!entry.ok) return { tone: "danger", label: "Partly built" };
  if (entry.missing && entry.missing.length) return { tone: "warning", label: "Missing columns" };
  return { tone: "brand", label: "Done" };
}

/** The summary at the top: what happened, in one sentence. */
function Summary({ result }) {
  const { summary, cancelled, bytes } = result;
  const missingNote = summary.withMissingColumns
    ? ` ${plural(summary.withMissingColumns, "file")} ${summary.withMissingColumns === 1 ? "is" : "are"} missing columns: those cells are empty.`
    : "";
  if (cancelled) {
    return (
      <Notice tone="warning" title="Batch stopped">
        {summary.succeeded} of {plural(summary.files, "file")} were processed before you stopped it. No zip was made: run the batch
        again to get the results.
      </Notice>
    );
  }
  if (!bytes) {
    return (
      <Notice tone="error" title="No file could be processed">
        Nothing was built, so there is no zip. The reasons are listed below.
      </Notice>
    );
  }
  if (summary.failed) {
    return (
      <Notice tone="warning" title={`${summary.succeeded} of ${plural(summary.files, "file")} processed`}>
        {plural(summary.failed, "file")} had problems; the zip holds everything that could be built.{missingNote}
      </Notice>
    );
  }
  return (
    <Notice tone={summary.withMissingColumns ? "warning" : "success"} title={`All ${plural(summary.files, "file")} processed`}>
      The zip has one folder per file.{missingNote}
    </Notice>
  );
}

/**
 * Results of a batch run: a summary, the Download button and one table row per file.
 *   { result (from runBatch), templateName, onDownload() }
 */
export default function BatchResults({ result, templateName, onDownload }) {
  return (
    <Card as="section" aria-labelledby="batch-results-heading" className="flex min-w-0 flex-col gap-4 p-4 sm:p-5">
      <SectionHeader
        title={<span id="batch-results-heading">Results</span>}
        description={`"${templateName}" on ${plural(result.summary.files, "file")}.`}
        actions={
          result.bytes ? (
            <Button variant="primary" icon={Download} onClick={onDownload}>
              Download zip ({formatBytes(result.bytes.length)})
            </Button>
          ) : null
        }
      />

      <Summary result={result} />

      <div className="overflow-x-auto rounded-lg border border-line">
        <table className="w-full min-w-[42rem] text-left text-sm">
          <caption className="sr-only">Results per file</caption>
          <thead className="bg-surface-2 text-xs text-muted">
            <tr>
              <th scope="col" className="px-3 py-2 font-medium">
                File
              </th>
              <th scope="col" className="px-3 py-2 font-medium">
                Status
              </th>
              <th scope="col" className="px-3 py-2 text-right font-medium">
                Rows read
              </th>
              <th scope="col" className="px-3 py-2 font-medium">
                Outputs
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {result.results.map((entry, index) => {
              const status = statusOf(entry);
              return (
                <tr key={`${entry.fileName}-${index}`} className="align-top">
                  <th scope="row" className="max-w-[14rem] px-3 py-2.5 font-medium break-words text-fg">
                    {entry.fileName}
                    {entry.sheetNames && entry.sheetNames.length ? (
                      <span className="block text-xs font-normal text-muted">
                        {entry.sheetNames.length === 1 ? "Sheet" : "Sheets"} {entry.sheetNames.join(", ")}
                      </span>
                    ) : null}
                  </th>
                  <td className="max-w-[20rem] px-3 py-2.5">
                    <Badge tone={status.tone}>{status.label}</Badge>
                    {entry.missing && entry.missing.length ? (
                      <p className="mt-1.5 text-xs text-warning">
                        Missing: {listNames(entry.missing)}. Those cells are empty.{" "}
                        <Link href="/templates#column-aliases" className="font-medium underline underline-offset-2">
                          Add an alias
                        </Link>{" "}
                        if the file names a column differently.
                      </p>
                    ) : null}
                    {entry.error ? <p className="mt-1.5 text-xs break-words text-danger">{entry.error}</p> : null}
                    {entry.warnings && entry.warnings.length ? (
                      <ul className="mt-1.5 flex flex-col gap-0.5 text-xs break-words text-muted">
                        {entry.warnings.map((warning, i) => (
                          <li key={i}>{warning}</li>
                        ))}
                      </ul>
                    ) : null}
                  </td>
                  <td className="px-3 py-2.5 text-right text-fg tabular-nums">
                    {Number.isFinite(entry.rowCount) ? formatCount(entry.rowCount) : <span className="text-muted">-</span>}
                  </td>
                  <td className="px-3 py-2.5">
                    {entry.outputs.length ? (
                      <ul className="flex flex-col gap-0.5">
                        {entry.outputs.map((output) => (
                          <li key={output.fileName} className="text-fg">
                            <span className="break-words">{output.fileName}</span>{" "}
                            <span className="text-xs text-muted">{plural(output.rowCount, "row")}</span>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <span className="text-muted">None</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
