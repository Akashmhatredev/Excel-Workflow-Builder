import { CircleAlert, TriangleAlert } from "lucide-react";
import { cn } from "@/lib/cn";

/** The problems the engine (or the validator) reported, errors and warnings, one line each. */
export default function IssueList({ issues, label = "Problems with this output", className }) {
  if (!issues || !issues.length) return null;
  return (
    <ul className={cn("flex flex-col gap-1.5", className)} aria-label={label}>
      {issues.map((issue, index) => {
        const error = issue.level === "error";
        const Icon = error ? CircleAlert : TriangleAlert;
        return (
          <li
            key={`${issue.code ?? "issue"}-${issue.id ?? ""}-${index}`}
            className={cn(
              "flex items-start gap-2 rounded-md px-3 py-2 text-sm",
              error ? "bg-danger-soft text-danger" : "bg-warning-soft text-warning",
            )}
          >
            <Icon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <span className="min-w-0 text-fg">
              <span className="sr-only">{error ? "Error: " : "Warning: "}</span>
              {issue.message}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
