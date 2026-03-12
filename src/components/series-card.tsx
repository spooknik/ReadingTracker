import Link from "next/link";
import Image from "next/image";
import { Series, User, UserSeries } from "@/generated/prisma/client";
import { StatusBadge, MediaTypeBadge } from "./badges";

type SeriesWithRelations = Series & {
  userSeries: (UserSeries & { user: User })[];
  createdBy: User;
};

interface SeriesCardProps {
  series: SeriesWithRelations;
  allUsers: User[];
  currentUserId: string;
}

export function SeriesCard({ series, allUsers, currentUserId }: SeriesCardProps) {
  // Map user progress for quick lookup
  const userProgressMap = new Map(
    series.userSeries.map((us) => [us.userId, us])
  );

  const currentUserProgress = userProgressMap.get(currentUserId);
  const isTracking = !!currentUserProgress;

  return (
    <Link
      href={`/series/${series.id}`}
      className="block rounded-xl border border-card-border bg-card p-4 transition-all hover:border-primary/30 hover:shadow-md active:scale-[0.99]"
    >
      <div className="flex gap-3">
        {/* Cover image */}
        <div className="relative h-24 w-16 flex-shrink-0 overflow-hidden rounded-lg bg-slate-200 dark:bg-slate-700">
          {series.imageUrl ? (
            <Image
              src={series.imageUrl}
              alt={series.title}
              fill
              className="object-cover"
              sizes="64px"
            />
          ) : (
            <div className="flex h-full items-center justify-center text-xs text-muted">
              No img
            </div>
          )}
        </div>

        {/* Content */}
        <div className="flex min-w-0 flex-1 flex-col">
          {/* Title row */}
          <div className="mb-1 flex items-start justify-between gap-2">
            <h3 className="truncate text-sm font-semibold leading-tight">
              {series.title}
            </h3>
            <MediaTypeBadge type={series.mediaType} />
          </div>

          {/* Chapter count */}
          {series.totalChapters && (
            <p className="mb-2 text-xs text-muted">
              {series.totalChapters} chapters
            </p>
          )}

          {/* User progress rows */}
          <div className="mt-auto space-y-1">
            {allUsers.map((user) => {
              const progress = userProgressMap.get(user.id);
              if (!progress) return null;

              const isCurrentUser = user.id === currentUserId;
              const chapterText = series.totalChapters
                ? `${progress.currentChapter}/${series.totalChapters}`
                : `Ch. ${progress.currentChapter}`;

              return (
                <div
                  key={user.id}
                  className={`flex items-center justify-between rounded-md px-2 py-1 text-xs ${
                    isCurrentUser
                      ? "bg-primary-light"
                      : "bg-slate-50 dark:bg-slate-800"
                  }`}
                >
                  <span className={`font-medium ${isCurrentUser ? "text-primary" : ""}`}>
                    {user.displayName}
                  </span>
                  <div className="flex items-center gap-2">
                    <span className="tabular-nums">{chapterText}</span>
                    <StatusBadge status={progress.status} />
                    {progress.rating && (
                      <span className="text-amber-500">{progress.rating}/10</span>
                    )}
                  </div>
                </div>
              );
            })}

            {/* Show "Not tracking" for users who haven't joined */}
            {allUsers.map((user) => {
              if (userProgressMap.has(user.id)) return null;
              return (
                <div
                  key={user.id}
                  className="flex items-center justify-between rounded-md bg-slate-50 px-2 py-1 text-xs dark:bg-slate-800"
                >
                  <span className="text-muted">{user.displayName}</span>
                  <span className="text-muted italic">Not tracking</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Reading link indicator */}
      {series.link && (
        <div className="mt-2 flex items-center gap-1 text-xs text-primary">
          <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M13.19 8.688a4.5 4.5 0 0 1 1.242 7.244l-4.5 4.5a4.5 4.5 0 0 1-6.364-6.364l1.757-1.757m9.86-2.063a4.5 4.5 0 0 0-1.242-7.244l-4.5-4.5a4.5 4.5 0 0 0-6.364 6.364l1.757 1.757" />
          </svg>
          <span className="truncate">Has reading link</span>
        </div>
      )}
    </Link>
  );
}
