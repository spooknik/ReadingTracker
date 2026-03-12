export default function Loading() {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="h-8 w-24 animate-pulse rounded-lg bg-slate-200 dark:bg-slate-700" />
        <div className="h-5 w-16 animate-pulse rounded-lg bg-slate-200 dark:bg-slate-700" />
      </div>
      {[1, 2, 3].map((i) => (
        <div
          key={i}
          className="rounded-xl border border-card-border bg-card p-4"
        >
          <div className="flex gap-3">
            <div className="h-24 w-16 animate-pulse rounded-lg bg-slate-200 dark:bg-slate-700" />
            <div className="flex-1 space-y-2">
              <div className="h-4 w-3/4 animate-pulse rounded bg-slate-200 dark:bg-slate-700" />
              <div className="h-3 w-1/4 animate-pulse rounded bg-slate-200 dark:bg-slate-700" />
              <div className="h-6 w-full animate-pulse rounded bg-slate-200 dark:bg-slate-700" />
              <div className="h-6 w-full animate-pulse rounded bg-slate-200 dark:bg-slate-700" />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
