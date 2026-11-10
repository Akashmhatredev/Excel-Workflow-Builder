"use client"; // Error boundaries must be Client Components.

import { useEffect } from "react";
import { useTheme } from "@/components/shell/theme";
import { buttonClass } from "@/components/ui/styles";
import "./globals.css";

/**
 * Last-resort boundary: shown when the root layout itself fails. It replaces
 * the whole document, so it brings its own <html> and <body>, imports the
 * stylesheet again and re-applies the saved theme (the layout's inline theme
 * script does not run here). It uses nothing else from the app on purpose:
 * no header, no stores, no fonts beyond the system stack.
 */
export default function GlobalError({ error, retry, reset }) {
  const { resolvedTheme } = useTheme();

  useEffect(() => {
    console.error(error);
  }, [error]);

  const tryAgain = retry || reset;

  return (
    <html lang="en" className={resolvedTheme === "dark" ? "dark h-full antialiased" : "h-full antialiased"}>
      <body className="flex min-h-full flex-col font-sans">
        <title>Something went wrong | Excel Workflow Builder</title>
        <main className="mx-auto flex w-full max-w-md flex-1 flex-col items-center justify-center px-4 py-16 text-center">
          <h1 className="text-2xl font-semibold tracking-tight text-fg">Something went wrong</h1>
          <p role="alert" className="mt-2 text-sm text-pretty text-muted">
            The app could not start. Your saved templates are still in this browser. Try again, or reload the page.
          </p>
          <div className="mt-6 flex w-full max-w-xs flex-col gap-2.5 sm:w-auto sm:max-w-none sm:flex-row">
            {tryAgain ? (
              <button type="button" className={buttonClass({ variant: "primary" })} onClick={() => tryAgain()}>
                Try again
              </button>
            ) : null}
            {/* A full page load on purpose: client-side navigation may be what is broken. */}
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
            <a href="/" className={buttonClass({ variant: "secondary" })}>
              Reload the app
            </a>
          </div>
        </main>
      </body>
    </html>
  );
}
