import { ReadingStatus, MediaType } from "@/generated/prisma/client";

export const STATUS_CONFIG: Record<
  ReadingStatus,
  { label: string; color: string; bgColor: string }
> = {
  READING: { label: "Reading", color: "text-blue-700 dark:text-blue-400", bgColor: "bg-blue-100 dark:bg-blue-900/40" },
  COMPLETED: { label: "Completed", color: "text-green-700 dark:text-green-400", bgColor: "bg-green-100 dark:bg-green-900/40" },
  ON_HOLD: { label: "On Hold", color: "text-amber-700 dark:text-amber-400", bgColor: "bg-amber-100 dark:bg-amber-900/40" },
  DROPPED: { label: "Dropped", color: "text-red-700 dark:text-red-400", bgColor: "bg-red-100 dark:bg-red-900/40" },
  PLAN_TO_READ: { label: "Plan to Read", color: "text-slate-600 dark:text-slate-400", bgColor: "bg-slate-100 dark:bg-slate-800" },
};

export const MEDIA_TYPE_LABELS: Record<MediaType, string> = {
  MANGA: "Manga",
  MANHWA: "Manhwa",
  MANHUA: "Manhua",
  LIGHT_NOVEL: "Light Novel",
  BOOK: "Book",
};

export function StatusBadge({ status }: { status: ReadingStatus }) {
  const config = STATUS_CONFIG[status];
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${config.color} ${config.bgColor}`}
    >
      {config.label}
    </span>
  );
}

export function MediaTypeBadge({ type }: { type: MediaType }) {
  return (
    <span className="inline-flex items-center rounded-full bg-primary-light px-2 py-0.5 text-xs font-medium text-primary">
      {MEDIA_TYPE_LABELS[type]}
    </span>
  );
}
