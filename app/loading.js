// Route-level loading fallback: a quiet skeleton in the shape of a page
// (heading, a line of text, a few cards). No client code.
export default function Loading() {
  return (
    <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-8 px-4 py-6 sm:px-6 sm:py-10">
      <div role="status" className="flex flex-col gap-8">
        <span className="sr-only">Loading</span>
        <div aria-hidden="true" className="flex max-w-2xl flex-col gap-3">
          <div className="skeleton h-8 w-4/5" />
          <div className="skeleton h-4 w-3/5" />
          <div className="mt-2 flex gap-2.5">
            <div className="skeleton h-12 w-44 rounded-lg" />
            <div className="skeleton h-12 w-44 rounded-lg" />
          </div>
        </div>
        <div aria-hidden="true" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2].map((item) => (
            <div key={item} className="rounded-xl border border-line bg-surface p-4">
              <div className="skeleton h-4 w-2/3" />
              <div className="skeleton mt-3 h-3 w-full" />
              <div className="skeleton mt-2 h-3 w-1/2" />
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}
