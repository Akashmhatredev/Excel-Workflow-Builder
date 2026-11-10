import { ShieldCheck } from "lucide-react";
import { cn } from "@/lib/cn";

/** The one-line privacy promise. `detail` adds the reason behind it. */
export default function PrivacyNote({ detail = false, className }) {
  return (
    <p className={cn("flex items-start gap-2 text-sm text-muted", className)}>
      <ShieldCheck className="mt-0.5 size-4 shrink-0 text-brand" aria-hidden="true" />
      <span>
        <span className="font-medium text-fg">Your data never leaves your browser.</span>
        {detail ? " Files are read and processed on this device; nothing is uploaded." : null}
      </span>
    </p>
  );
}
