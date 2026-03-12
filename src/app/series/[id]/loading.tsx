export default function SeriesLoading() {
  return (
    <div className="space-y-6">
      <div className="h-5 w-16 animate-pulse rounded bg-slate-200 dark:bg-slate-700" />
      <div className="flex gap-4">
        <div className="h-36 w-24 animate-pulse rounded-xl bg-slate-200 dark:bg-slate-700" />
        <div className="flex-1 space-y-3">
          <div className="h-6 w-3/4 animate-pulse rounded bg-slate-200 dark:bg-slate-700" />
          <div className="h-4 w-1/3 animate-pulse rounded bg-slate-200 dark:bg-slate-700" />
          <div className="h-4 w-1/2 animate-pulse rounded bg-slate-200 dark:bg-slate-700" />
        </div>
      </div>
      <div className="h-24 animate-pulse rounded-xl bg-slate-200 dark:bg-slate-700" />
      <div className="space-y-3">
        <div className="h-5 w-20 animate-pulse rounded bg-slate-200 dark:bg-slate-700" />
        <div className="h-32 animate-pulse rounded-xl bg-slate-200 dark:bg-slate-700" />
        <div className="h-32 animate-pulse rounded-xl bg-slate-200 dark:bg-slate-700" />
      </div>
    </div>
  );
}
