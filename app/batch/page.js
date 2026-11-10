import { Suspense } from "react";
import BatchView from "@/components/batch/BatchView";

export const metadata = {
  title: "Batch",
  description: "Apply one template to several Excel or CSV files at once and download every result in one zip. Nothing leaves your browser.",
};

/** Shown in the prerendered HTML until the client part (which reads ?template=) takes over. */
function BatchSkeleton() {
  return (
    <div role="status" className="grid gap-4 lg:grid-cols-2">
      <span className="sr-only">Loading batch mode</span>
      {[0, 1].map((item) => (
        <div key={item} aria-hidden="true" className="h-56 animate-pulse rounded-xl border border-line bg-surface-2" />
      ))}
    </div>
  );
}

// Batch mode (owner: X4). The interactive part lives in components/batch/BatchView.jsx.
export default function BatchPage() {
  return (
    <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 p-4 sm:p-6">
      <header className="min-w-0">
        <h1 className="text-2xl font-semibold text-fg">Batch mode</h1>
        <p className="mt-1 max-w-2xl text-sm text-muted">
          Apply one template to several files at once, for example every branch&rsquo;s monthly export. Each file is read and
          processed in your browser, one at a time, and every result lands in a single zip. Nothing is uploaded.
        </p>
      </header>
      <Suspense fallback={<BatchSkeleton />}>
        <BatchView />
      </Suspense>
    </main>
  );
}
