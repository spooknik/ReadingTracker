"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { StatusBadge, MediaTypeBadge } from "./badges";
import type { ReadingStatus } from "@/generated/prisma/client";

interface UserData {
  id: string;
  email: string;
  displayName: string;
}

interface UserSeriesData {
  id: string;
  userId: string;
  seriesId: string;
  status: ReadingStatus;
  currentChapter: number;
  rating: number | null;
  notes: string | null;
  user: UserData;
}

interface SeriesData {
  id: string;
  malId: number | null;
  title: string;
  imageUrl: string | null;
  synopsis: string | null;
  mediaType: string;
  totalChapters: number | null;
  totalVolumes: number | null;
  link: string | null;
  createdBy: UserData;
  userSeries: UserSeriesData[];
}

const STATUSES = [
  { value: "READING", label: "Reading" },
  { value: "COMPLETED", label: "Completed" },
  { value: "ON_HOLD", label: "On Hold" },
  { value: "DROPPED", label: "Dropped" },
  { value: "PLAN_TO_READ", label: "Plan to Read" },
];

interface SeriesDetailProps {
  series: SeriesData;
  allUsers: UserData[];
  currentUserId: string;
}

export function SeriesDetail({
  series,
  allUsers,
  currentUserId,
}: SeriesDetailProps) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [joining, setJoining] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const currentUserSeries = series.userSeries.find(
    (us) => us.userId === currentUserId
  );
  const isTracking = !!currentUserSeries;

  async function handleJoin() {
    setJoining(true);
    setError("");
    try {
      const res = await fetch(`/api/series/${series.id}`, {
        method: "POST",
      });
      if (!res.ok) {
        const data = await res.json();
        setError(data.error || "Failed to join");
        return;
      }
      router.refresh();
    } catch {
      setError("Failed to join series");
    } finally {
      setJoining(false);
    }
  }

  async function handleDelete() {
    setDeleting(true);
    setError("");
    try {
      const res = await fetch(`/api/series/${series.id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const data = await res.json();
        setError(data.error || "Failed to delete");
        return;
      }
      router.push("/");
      router.refresh();
    } catch {
      setError("Failed to delete series");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* Back button */}
      <button
        onClick={() => router.back()}
        className="flex items-center gap-1 text-sm text-muted hover:text-foreground"
      >
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" />
        </svg>
        Back
      </button>

      {/* Header with cover */}
      <div className="flex gap-4">
        <div className="relative h-36 w-24 flex-shrink-0 overflow-hidden rounded-xl bg-slate-200 shadow-md dark:bg-slate-700">
          {series.imageUrl ? (
            <Image
              src={series.imageUrl}
              alt={series.title}
              fill
              className="object-cover"
              sizes="96px"
            />
          ) : (
            <div className="flex h-full items-center justify-center text-xs text-muted">
              No image
            </div>
          )}
        </div>
        <div className="flex flex-col gap-2">
          <h1 className="text-xl font-bold leading-tight">{series.title}</h1>
          <div className="flex flex-wrap gap-2">
            <MediaTypeBadge type={series.mediaType as Parameters<typeof MediaTypeBadge>[0]["type"]} />
            {series.totalChapters && (
              <span className="text-xs text-muted">
                {series.totalChapters} chapters
              </span>
            )}
          </div>
          {series.link && (
            <a
              href={series.link}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 text-sm text-primary hover:underline"
              onClick={(e) => e.stopPropagation()}
            >
              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 0 0 3 8.25v10.5A2.25 2.25 0 0 0 5.25 21h10.5A2.25 2.25 0 0 0 18 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
              </svg>
              Read online
            </a>
          )}
          <p className="text-xs text-muted">
            Added by {series.createdBy.displayName}
          </p>
        </div>
      </div>

      {/* Synopsis */}
      {series.synopsis && (
        <div className="rounded-xl border border-card-border bg-card p-4">
          <h2 className="mb-2 text-sm font-semibold">Synopsis</h2>
          <p className="text-sm leading-relaxed text-secondary line-clamp-6">
            {series.synopsis}
          </p>
        </div>
      )}

      {error && (
        <div className="rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-400">
          {error}
        </div>
      )}

      {/* Join button if not tracking */}
      {!isTracking && (
        <button
          onClick={handleJoin}
          disabled={joining}
          className="w-full rounded-lg bg-primary py-3 text-sm font-medium text-white transition-colors hover:bg-primary-hover disabled:opacity-50"
        >
          {joining ? "Joining..." : "Start Tracking"}
        </button>
      )}

      {/* User progress cards */}
      <div className="space-y-3">
        <h2 className="text-sm font-semibold">Progress</h2>
        {allUsers.map((user) => {
          const userSeries = series.userSeries.find(
            (us) => us.userId === user.id
          );
          const isCurrentUser = user.id === currentUserId;

          if (!userSeries) {
            return (
              <div
                key={user.id}
                className="rounded-xl border border-card-border bg-card p-4 opacity-50"
              >
                <p className="text-sm text-muted">
                  {user.displayName} — Not tracking
                </p>
              </div>
            );
          }

          return (
            <UserProgressCard
              key={user.id}
              user={user}
              userSeries={userSeries}
              seriesId={series.id}
              totalChapters={series.totalChapters}
              isCurrentUser={isCurrentUser}
            />
          );
        })}
      </div>

      {/* Delete series */}
      <div className="border-t border-card-border pt-4">
        {!confirmDelete ? (
          <button
            onClick={() => setConfirmDelete(true)}
            className="w-full rounded-lg border border-red-300 py-2.5 text-sm font-medium text-red-600 transition-colors hover:bg-red-50 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-900/20"
          >
            Remove from Library
          </button>
        ) : (
          <div className="space-y-2">
            <p className="text-center text-sm text-red-600 dark:text-red-400">
              Delete <strong>{series.title}</strong> for all users?
            </p>
            <div className="flex gap-2">
              <button
                onClick={handleDelete}
                disabled={deleting}
                className="flex-1 rounded-lg bg-red-600 py-2.5 text-sm font-medium text-white transition-colors hover:bg-red-700 disabled:opacity-50"
              >
                {deleting ? "Deleting..." : "Yes, delete"}
              </button>
              <button
                onClick={() => setConfirmDelete(false)}
                className="flex-1 rounded-lg border border-card-border py-2.5 text-sm font-medium transition-colors hover:bg-slate-50 dark:hover:bg-slate-800"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function UserProgressCard({
  user,
  userSeries,
  seriesId,
  totalChapters,
  isCurrentUser,
}: {
  user: UserData;
  userSeries: UserSeriesData;
  seriesId: string;
  totalChapters: number | null;
  isCurrentUser: boolean;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [chapter, setChapter] = useState(userSeries.currentChapter);
  const [status, setStatus] = useState(userSeries.status);
  const [rating, setRating] = useState(userSeries.rating ?? 0);
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    setSaving(true);
    try {
      const res = await fetch(`/api/series/${seriesId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          currentChapter: chapter,
          status,
          rating: rating || null,
        }),
      });
      if (res.ok) {
        setEditing(false);
        router.refresh();
      }
    } catch {
      // Silently fail — user can retry
    } finally {
      setSaving(false);
    }
  }

  async function handleQuickIncrement() {
    const newChapter = userSeries.currentChapter + 1;
    try {
      await fetch(`/api/series/${seriesId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentChapter: newChapter }),
      });
      router.refresh();
    } catch {
      // Silently fail
    }
  }

  const chapterText = totalChapters
    ? `${userSeries.currentChapter}/${totalChapters}`
    : `Ch. ${userSeries.currentChapter}`;

  const progressPercent = totalChapters
    ? Math.min(100, Math.round((userSeries.currentChapter / totalChapters) * 100))
    : null;

  return (
    <div
      className={`rounded-xl border bg-card p-4 ${
        isCurrentUser ? "border-primary/30" : "border-card-border"
      }`}
    >
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className={`text-sm font-semibold ${isCurrentUser ? "text-primary" : ""}`}>
            {user.displayName}
          </span>
          {isCurrentUser && (
            <span className="rounded-full bg-primary px-1.5 py-0.5 text-[10px] font-medium text-white">
              You
            </span>
          )}
        </div>
        <StatusBadge status={userSeries.status} />
      </div>

      {/* Progress bar */}
      {progressPercent !== null && (
        <div className="mb-2 h-2 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700">
          <div
            className="h-full rounded-full bg-primary transition-all"
            style={{ width: `${progressPercent}%` }}
          />
        </div>
      )}

      <div className="flex items-center justify-between text-sm">
        <span className="tabular-nums">{chapterText}</span>
        {userSeries.rating && (
          <span className="text-amber-500 font-medium">{userSeries.rating}/10</span>
        )}
      </div>

      {/* Edit controls for current user */}
      {isCurrentUser && !editing && (
        <div className="mt-3 flex gap-2">
          <button
            onClick={handleQuickIncrement}
            className="flex-1 rounded-lg border border-card-border py-2 text-xs font-medium transition-colors hover:bg-slate-50 dark:hover:bg-slate-800"
          >
            +1 Chapter
          </button>
          <button
            onClick={() => setEditing(true)}
            className="flex-1 rounded-lg border border-card-border py-2 text-xs font-medium transition-colors hover:bg-slate-50 dark:hover:bg-slate-800"
          >
            Edit
          </button>
        </div>
      )}

      {isCurrentUser && editing && (
        <div className="mt-3 space-y-3 border-t border-card-border pt-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs text-muted">Chapter</label>
              <input
                type="number"
                min={0}
                value={chapter}
                onChange={(e) => setChapter(parseInt(e.target.value) || 0)}
                className="w-full rounded-lg border border-card-border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-muted">Rating (1-10)</label>
              <input
                type="number"
                min={0}
                max={10}
                value={rating}
                onChange={(e) => setRating(parseInt(e.target.value) || 0)}
                className="w-full rounded-lg border border-card-border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
              />
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs text-muted">Status</label>
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value as ReadingStatus)}
              className="w-full rounded-lg border border-card-border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
            >
              {STATUSES.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </div>
          <div className="flex gap-2">
            <button
              onClick={handleSave}
              disabled={saving}
              className="flex-1 rounded-lg bg-primary py-2 text-xs font-medium text-white transition-colors hover:bg-primary-hover disabled:opacity-50"
            >
              {saving ? "Saving..." : "Save"}
            </button>
            <button
              onClick={() => {
                setEditing(false);
                setChapter(userSeries.currentChapter);
                setStatus(userSeries.status);
                setRating(userSeries.rating ?? 0);
              }}
              className="flex-1 rounded-lg border border-card-border py-2 text-xs font-medium transition-colors hover:bg-slate-50 dark:hover:bg-slate-800"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
