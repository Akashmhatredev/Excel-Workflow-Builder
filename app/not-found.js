import { ArrowRight, Compass, LayoutTemplate } from "lucide-react";
import ButtonLink from "@/components/ui/ButtonLink";

export const metadata = { title: "Page not found" };

// Shipped with every route (it also handles unmatched URLs), so it stays a
// Server Component with plain links: no client code.
export default function NotFound() {
  return (
    <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col items-center justify-center px-4 py-16 text-center sm:px-6">
      <span aria-hidden="true" className="flex size-12 items-center justify-center rounded-full bg-surface-2 text-muted">
        <Compass className="size-6" />
      </span>
      <p className="mt-5 font-mono text-sm text-muted">404</p>
      <h1 className="mt-1 text-2xl font-semibold tracking-tight text-fg">Page not found</h1>
      <p className="mt-2 max-w-md text-sm text-pretty text-muted">
        There is nothing at this address. Your templates and any workflow in progress are still saved in this browser.
      </p>
      <div className="mt-6 flex w-full max-w-xs flex-col gap-2.5 sm:w-auto sm:max-w-none sm:flex-row">
        <ButtonLink href="/" variant="primary">
          Go to home
        </ButtonLink>
        <ButtonLink href="/workflow" iconRight={ArrowRight}>
          Open the workflow
        </ButtonLink>
        <ButtonLink href="/templates" icon={LayoutTemplate}>
          Templates
        </ButtonLink>
      </div>
    </main>
  );
}
