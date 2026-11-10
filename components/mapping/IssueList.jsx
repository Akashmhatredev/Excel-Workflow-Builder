import { AlertCircle, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/cn";

/** Inline validation messages: an icon and colour per level, plus the level as text for screen readers. */
export default function IssueList({ issues, id, className }) {
  if (!issues || !issues.length) return null;
  return (
    <ul id={id} className={cn("flex flex-col gap-1", className)}>
      {issues.map((issue, index) => {
        const isError = issue.level === "error";
        const Icon = isError ? AlertCircle : AlertTriangle;
        return (
          <li
            key={`${issue.code || "issue"}-${index}`}
            className={cn("flex items-start gap-1.5 text-xs", isError ? "text-danger" : "text-warning")}
          >
            <Icon className="mt-px size-3.5 shrink-0" aria-hidden="true" />
            <span className="min-w-0 break-words">
              <span className="sr-only">{isError ? "Error: " : "Warning: "}</span>
              {issue.message}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
