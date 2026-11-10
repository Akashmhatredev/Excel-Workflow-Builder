import { AlertCircle, AlertTriangle, CircleCheck } from "lucide-react";
import IssueList from "@/components/mapping/IssueList";
import { plural } from "@/components/upload/format";
import { Badge } from "@/components/ui";

/**
 * One-line validation summary for the Mapping step. `general` holds the issues
 * that do not belong to a single field or rule, so they are listed here.
 */
export default function IssueSummary({ fieldCount, errors, warnings, general }) {
  const clean = !errors && !warnings;
  return (
    <div role="status" aria-live="polite" className="flex flex-col gap-2">
      <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted">
        <span>{plural(fieldCount, "field")}</span>
        {errors ? (
          <Badge tone="danger">
            <AlertCircle className="size-3.5" aria-hidden="true" />
            {plural(errors, "error")}
          </Badge>
        ) : null}
        {warnings ? (
          <Badge tone="warning">
            <AlertTriangle className="size-3.5" aria-hidden="true" />
            {plural(warnings, "warning")}
          </Badge>
        ) : null}
        {clean && fieldCount ? (
          <Badge tone="brand">
            <CircleCheck className="size-3.5" aria-hidden="true" />
            No issues
          </Badge>
        ) : null}
        {errors ? <span>Each one is shown on the field or rule it belongs to.</span> : null}
      </p>
      <IssueList issues={general} />
    </div>
  );
}
