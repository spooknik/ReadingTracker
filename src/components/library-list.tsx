"use client";

import { useState, useMemo } from "react";
import { SeriesCard } from "./series-card";
import type { Series, User, UserSeries } from "@/generated/prisma/client";

type SeriesWithRelations = Series & {
  userSeries: (UserSeries & { user: User })[];
  createdBy: User;
};

type SortOption = "recent" | "title" | "title-desc" | "chapters" | "rating" | "status";

const SORT_OPTIONS: { value: SortOption; label: string }[] = [
  { value: "recent", label: "Recently Added" },
  { value: "title", label: "Title A-Z" },
  { value: "title-desc", label: "Title Z-A" },
  { value: "status", label: "My Status" },
  { value: "chapters", label: "Most Chapters" },
  { value: "rating", label: "Highest Rated" },
];

interface LibraryListProps {
  allSeries: SeriesWithRelations[];
  allUsers: User[];
  currentUserId: string;
}

export function LibraryList({ allSeries, allUsers, currentUserId }: LibraryListProps) {
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<SortOption>("recent");

  const filtered = useMemo(() => {
    let list = allSeries;

    // Filter by search
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter((s) =>
        s.title.toLowerCase().includes(q)
      );
    }

    // Sort
    const sorted = [...list];
    switch (sort) {
      case "recent":
        sorted.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
        break;
      case "title":
        sorted.sort((a, b) => a.title.localeCompare(b.title));
        break;
      case "title-desc":
        sorted.sort((a, b) => b.title.localeCompare(a.title));
        break;
      case "chapters":
        sorted.sort((a, b) => (b.totalChapters ?? 0) - (a.totalChapters ?? 0));
        break;
      case "rating": {
        // Sort by current user's rating, then by average rating across all users
        sorted.sort((a, b) => {
          const aRating = a.userSeries.find((us) => us.userId === currentUserId)?.rating ?? 0;
          const bRating = b.userSeries.find((us) => us.userId === currentUserId)?.rating ?? 0;
          if (bRating !== aRating) return bRating - aRating;
          const aAvg = a.userSeries.reduce((sum, us) => sum + (us.rating ?? 0), 0) / (a.userSeries.length || 1);
          const bAvg = b.userSeries.reduce((sum, us) => sum + (us.rating ?? 0), 0) / (b.userSeries.length || 1);
          return bAvg - aAvg;
        });
        break;
      }
      case "status": {
        const statusOrder: Record<string, number> = {
          READING: 0,
          PLAN_TO_READ: 1,
          ON_HOLD: 2,
          COMPLETED: 3,
          DROPPED: 4,
        };
        sorted.sort((a, b) => {
          const aStatus = a.userSeries.find((us) => us.userId === currentUserId)?.status;
          const bStatus = b.userSeries.find((us) => us.userId === currentUserId)?.status;
          const aOrder = aStatus ? (statusOrder[aStatus] ?? 99) : 99;
          const bOrder = bStatus ? (statusOrder[bStatus] ?? 99) : 99;
          if (aOrder !== bOrder) return aOrder - bOrder;
          return a.title.localeCompare(b.title);
        });
        break;
      }
    }

    return sorted;
  }, [allSeries, search, sort, currentUserId]);

  return (
    <div className="space-y-3">
      {/* Search and sort controls */}
      <div className="flex gap-2">
        <div className="relative flex-1">
          <svg
            className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={2}
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z"
            />
          </svg>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search library..."
            className="w-full rounded-lg border border-card-border bg-card py-2 pl-9 pr-3 text-sm outline-none focus:border-primary focus:ring-1 focus:ring-primary"
          />
        </div>
        <select
          value={sort}
          onChange={(e) => setSort(e.target.value as SortOption)}
          className="rounded-lg border border-card-border bg-card px-3 py-2 text-sm outline-none focus:border-primary"
        >
          {SORT_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>

      {/* Results count */}
      {search.trim() && (
        <p className="text-xs text-muted">
          {filtered.length} of {allSeries.length} series
        </p>
      )}

      {/* Series list */}
      {filtered.length === 0 ? (
        <div className="rounded-xl border border-dashed border-card-border bg-card p-8 text-center">
          {search.trim() ? (
            <>
              <p className="text-sm text-muted">No series matching &ldquo;{search}&rdquo;</p>
              <button
                onClick={() => setSearch("")}
                className="mt-2 text-sm text-primary hover:underline"
              >
                Clear search
              </button>
            </>
          ) : (
            <p className="text-sm text-muted">No series in your library yet.</p>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((series) => (
            <SeriesCard
              key={series.id}
              series={series}
              allUsers={allUsers}
              currentUserId={currentUserId}
            />
          ))}
        </div>
      )}
    </div>
  );
}
