import { Badge } from "@/components/ui";
import { cn } from "@/lib/cn";
import { formatClock, formatFull, formatRows, outputLabel, relativeTime, runKind, runTime, runTitle } from "./format";

/**
 * One run history entry: kind icon, template name, time, kind + source file name, and the
 * output files with their row counts.
 *
 * time: "relative" ("5 minutes ago", needs `now`) or "clock" ("14:05", for lists grouped by day).
 * maxOutputs: show at most this many output chips, then "+N more".
 * actions: a node rendered on the right (the history page's remove button).
 */
export default function RunItem({ entry, now = 0, time: timeMode = "relative", maxOutputs = Infinity, actions, className }) {
  const kind = runKind(entry.kind);
  const Icon = kind.icon;
  const time = runTime(entry);
  const outputs = Array.isArray(entry.outputs) ? entry.outputs : [];
  const shown = outputs.slice(0, maxOutputs);
  const hidden = outputs.length - shown.length;
  const timeText = timeMode === "clock" ? formatClock(time) : relativeTime(time, now) || formatFull(time);

  return (
    <div className={cn("flex items-start gap-3", className)}>
      <span
        aria-hidden="true"
        className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg bg-surface-2 text-muted"
      >
        <Icon className="size-[1.125rem]" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
          <p className="min-w-0 font-medium break-words text-fg">{runTitle(entry)}</p>
          <time dateTime={entry.at} title={formatFull(time)} className="shrink-0 text-xs text-muted tabular-nums">
            {timeText}
          </time>
        </div>
        <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted">
          <Badge>{kind.label}</Badge>
          {entry.fileName ? (
            <span className="min-w-0 break-all">
              <span className="sr-only">Source file: </span>
              {entry.fileName}
            </span>
          ) : null}
        </p>
        {shown.length ? (
          <ul aria-label="Outputs" className="mt-2 flex flex-wrap gap-1.5">
            {shown.map((output, index) => {
              const rows = formatRows(output.rowCount);
              return (
                <li
                  key={`${index}-${output.name}`}
                  className="inline-flex max-w-full min-w-0 items-center gap-1.5 rounded-md border border-line px-2 py-0.5 text-xs"
                >
                  <span className="min-w-0 truncate font-medium text-fg">{outputLabel(output)}</span>
                  {rows ? (
                    <span className="shrink-0 text-muted tabular-nums">
                      <span className="sr-only">, </span>
                      {rows}
                    </span>
                  ) : null}
                </li>
              );
            })}
            {hidden > 0 ? (
              <li className="inline-flex items-center px-1 py-0.5 text-xs text-muted">+{hidden} more</li>
            ) : null}
          </ul>
        ) : null}
      </div>
      {actions || null}
    </div>
  );
}
