import Link from "next/link";

// Landing / dashboard (owner: Agent E). Minimal version.
export default function HomePage() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-4 p-6">
      <h1 className="text-2xl font-semibold">Excel Workflow Builder</h1>
      <p className="text-muted">Your data never leaves your browser.</p>
      <div className="flex gap-3">
        <Link className="text-brand underline" href="/workflow">
          New workflow
        </Link>
        <Link className="text-brand underline" href="/templates">
          Templates
        </Link>
      </div>
    </main>
  );
}
