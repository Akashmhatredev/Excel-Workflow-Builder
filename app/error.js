"use client"; // Error boundaries must be Client Components.

import { RotateCw, TriangleAlert } from "lucide-react";
import { useEffect } from "react";
import { Button } from "@/components/ui";
import ButtonLink from "@/components/ui/ButtonLink";

/**
 * Error boundary for every page (the header and footer stay in place).
 * `retry` re-renders the failed segment (Next.js 16.3+); `reset` is the older
 * prop and is kept as a fallback.
 */
export default function ErrorPage({ error, retry, reset }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  // A value thrown in a Client Component arrives as-is and may not be an Error.
  const detail = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  const tryAgain = retry || reset;

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col items-center justify-center px-4 py-16 text-center sm:px-6">
      <span aria-hidden="true" className="flex size-12 items-center justify-center rounded-full bg-danger-soft text-danger">
        <TriangleAlert className="size-6" />
      </span>
      <h1 className="mt-5 text-2xl font-semibold tracking-tight text-fg">Something went wrong</h1>
      <p role="alert" className="mt-2 max-w-md text-sm text-pretty text-muted">
        This page hit an unexpected error. Your saved templates are safe, and the workflow you were building is kept as
        a draft in this browser.
      </p>
      {detail ? (
        <details className="mt-4 w-full max-w-md rounded-lg border border-line bg-surface text-left text-sm">
          <summary className="cursor-pointer rounded-lg px-3.5 py-2.5 font-medium text-fg">Technical details</summary>
          <pre className="max-h-48 overflow-auto border-t border-line px-3.5 py-3 font-mono text-xs break-words whitespace-pre-wrap text-muted">
            {detail}
          </pre>
        </details>
      ) : null}
      <div className="mt-6 flex w-full max-w-xs flex-col gap-2.5 sm:w-auto sm:max-w-none sm:flex-row">
        {tryAgain ? (
          <Button variant="primary" icon={RotateCw} onClick={() => tryAgain()}>
            Try again
          </Button>
        ) : null}
        <ButtonLink href="/">Go to home</ButtonLink>
      </div>
    </main>
  );
}
