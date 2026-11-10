import { ShieldCheck } from "lucide-react";
import { cn } from "@/lib/cn";

/** The promise the whole app is built around: files are processed locally. */
export default function PrivacyNote({ className }) {
  return (
    <p className={cn("flex items-center justify-center gap-1.5 text-center text-sm text-muted", className)}>
      <ShieldCheck className="size-4 shrink-0 text-brand" aria-hidden="true" />
      <span>
        <span className="font-medium text-fg">Your data never leaves your browser.</span> The file is read and processed on this
        device only.
      </span>
    </p>
  );
}
