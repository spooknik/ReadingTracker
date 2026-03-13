"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
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
  rip?: {
    status: string;
    site: string | null;
    lastError: string | null;
    lastSyncedAt: string | Date | null;
    jobs: Array<{
      id: string;
      status: string;
      kind: string;
      createdAt: string | Date;
      finishedAt: string | Date | null;
      error: string | null;
    }>;
  } | null;
}

interface RipStatusResponse {
  supported: boolean;
  status: string;
  site: string | null;
  lastError: string | null;
  lastSyncedAt: string | null;
  progress?: {
    totalChapters: number;
    completedChapters: number;
    failedChapters: number;
    pendingChapters: number;
    runningChapterSlug: string | null;
    runningChapterIndex: number | null;
  } | null;
  jobs: Array<{
    id: string;
    kind: string;
    status: string;
    createdAt: string;
    startedAt: string | null;
    finishedAt: string | null;
    error: string | null;
  }>;
}

const STATUSES = [
  { value: "READING", label: "Reading" },
  { value: "COMPLETED", label: "Completed" },
  { value: "ON_HOLD", label: "On Hold" },
  { value: "DROPPED", label: "Dropped" },
  { value: "PLAN_TO_READ", label: "Plan to Read" },
];

const MEDIA_TYPES = [
  { value: "MANGA", label: "Manga" },
  { value: "MANHWA", label: "Manhwa" },
  { value: "MANHUA", label: "Manhua" },
  { value: "LIGHT_NOVEL", label: "Light Novel" },
  { value: "BOOK", label: "Book" },
];

interface SeriesDetailProps {
  series: SeriesData;
  allUsers: UserData[];
  currentUserId: string;
  readerEnabled: boolean;
}

export function SeriesDetail({
  series,
  allUsers,
  currentUserId,
  readerEnabled,
}: SeriesDetailProps) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [joining, setJoining] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [editingSeries, setEditingSeries] = useState(false);
  const [savingSeries, setSavingSeries] = useState(false);
  const [editTitle, setEditTitle] = useState(series.title);
  const [editSynopsis, setEditSynopsis] = useState(series.synopsis || "");
  const [editMediaType, setEditMediaType] = useState(series.mediaType);
  const [editTotalChapters, setEditTotalChapters] = useState(
    series.totalChapters?.toString() || ""
  );
  const [editLink, setEditLink] = useState(series.link || "");
  const [editImageUrl, setEditImageUrl] = useState(series.imageUrl || "");
  const [queueingRip, setQueueingRip] = useState(false);
  const [ripInfo, setRipInfo] = useState<RipStatusResponse | null>(null);

  const currentUserSeries = series.userSeries.find(
    (us) => us.userId === currentUserId
  );
  const isTracking = !!currentUserSeries;
  const currentRipStatus = ripInfo?.status || series.rip?.status || "UNSUPPORTED";
  const ripSupported = ripInfo
    ? ripInfo.supported
    : !series.rip || series.rip.status !== "UNSUPPORTED";
  const ripLastError = ripInfo?.lastError ?? series.rip?.lastError ?? null;
  const ripLastSyncedAt = ripInfo?.lastSyncedAt ?? series.rip?.lastSyncedAt ?? null;
  const ripProgress = ripInfo?.progress || null;
  const latestJobStatus = ripInfo?.jobs[0]?.status || series.rip?.jobs[0]?.status || null;
  const hasActiveRipJob = latestJobStatus === "QUEUED" || latestJobStatus === "RUNNING";
  const isRipBusy = currentRipStatus === "RUNNING" || hasActiveRipJob;
  const hasReadableRipContent = Boolean(
    ripProgress && ripProgress.completedChapters > 0,
  );
  const canOpenReader = Boolean(
    readerEnabled && isTracking && (currentRipStatus === "READY" || hasReadableRipContent),
  );
  const canQueueRip = Boolean(readerEnabled && series.link && ripSupported);
  const canTrackAndOpenReader = Boolean(
    readerEnabled && !isTracking && (currentRipStatus === "READY" || hasReadableRipContent),
  );

  const loadRipStatus = useCallback(async () => {
    if (!readerEnabled || !series.link) {
      return;
    }

    try {
      const response = await fetch(`/api/series/${series.id}/rip`, {
        method: "GET",
        cache: "no-store",
      });

      if (!response.ok) {
        return;
      }

      const payload = (await response.json()) as RipStatusResponse;
      setRipInfo(payload);
    } catch {
      // Silently fail
    }
  }, [readerEnabled, series.id, series.link]);

  useEffect(() => {
    if (!readerEnabled || !series.link) {
      return;
    }

    void loadRipStatus();
  }, [loadRipStatus, readerEnabled, series.link]);

  useEffect(() => {
    if (!readerEnabled || !series.link || !isRipBusy) {
      return;
    }

    const timer = setInterval(() => {
      void loadRipStatus();
    }, 4000);

    return () => {
      clearInterval(timer);
    };
  }, [isRipBusy, loadRipStatus, readerEnabled, series.link]);

  const ripStatusLabel = useMemo(() => {
    if (currentRipStatus === "RUNNING") {
      if (ripProgress && ripProgress.totalChapters > 0) {
        const current = ripProgress.runningChapterIndex || ripProgress.completedChapters + 1;
        return `Ripping chapter ${Math.min(current, ripProgress.totalChapters)} of ${ripProgress.totalChapters}`;
      }

      return "Ripping chapters";
    }

    if (currentRipStatus === "PENDING") {
      return hasActiveRipJob ? "Queued for ripping" : "Ready to sync";
    }

    if (currentRipStatus === "READY" && ripProgress && ripProgress.totalChapters > 0) {
      return `Ready (${ripProgress.completedChapters}/${ripProgress.totalChapters} chapters)`;
    }

    return formatRipStatus(currentRipStatus);
  }, [currentRipStatus, hasActiveRipJob, ripProgress]);

  function formatRipStatus(status: string) {
    return status
      .replace(/_/g, " ")
      .toLowerCase()
      .replace(/\b\w/g, (c) => c.toUpperCase());
  }

  function formatDateForUi(value: string | Date) {
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
      return "Unknown";
    }

    return `${parsed.toISOString().replace("T", " ").replace(".000Z", " UTC")}`;
  }

  async function handleQueueRipNow() {
    setQueueingRip(true);
    setError("");
    try {
      const res = await fetch(`/api/series/${series.id}/rip`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: "SYNC" }),
      });

      const data = await res.json().catch(() => {
        return {};
      });

      if (!res.ok) {
        setError(data.error || data.message || "Failed to queue rip sync");
        return;
      }

      await loadRipStatus();
      router.refresh();
    } catch {
      setError("Failed to queue rip sync");
    } finally {
      setQueueingRip(false);
    }
  }

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

  async function handleTrackAndOpenReader() {
    setJoining(true);
    setError("");

    try {
      const res = await fetch(`/api/series/${series.id}`, {
        method: "POST",
      });

      if (!res.ok && res.status !== 409) {
        const data = await res.json().catch(() => {
          return {};
        });

        setError(data.error || "Failed to start tracking");
        return;
      }

      router.push(`/series/${series.id}/reader`);
      router.refresh();
    } catch {
      setError("Failed to start tracking");
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

  async function handleSaveSeries() {
    if (!editTitle.trim()) {
      setError("Title cannot be empty");
      return;
    }
    setSavingSeries(true);
    setError("");
    try {
      const res = await fetch(`/api/series/${series.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: editTitle.trim(),
          synopsis: editSynopsis,
          mediaType: editMediaType,
          totalChapters: editTotalChapters ? parseInt(editTotalChapters) : null,
          link: editLink,
          imageUrl: editImageUrl,
        }),
      });
      if (!res.ok) {
        const data = await res.json();
        setError(data.error || "Failed to update series");
        return;
      }
      setEditingSeries(false);
      router.refresh();
    } catch {
      setError("Failed to update series");
    } finally {
      setSavingSeries(false);
    }
  }

  function cancelEditSeries() {
    setEditingSeries(false);
    setEditTitle(series.title);
    setEditSynopsis(series.synopsis || "");
    setEditMediaType(series.mediaType);
    setEditTotalChapters(series.totalChapters?.toString() || "");
    setEditLink(series.link || "");
    setEditImageUrl(series.imageUrl || "");
    setError("");
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
          {readerEnabled && series.link && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full border border-card-border px-2 py-1 text-[11px] text-muted">
                Rip: {ripStatusLabel}
                {currentRipStatus === "RUNNING" && (
                  <span className="ml-1 inline-flex h-2 w-2 animate-pulse rounded-full bg-primary" />
                )}
              </span>
              {canOpenReader && (
                <a
                  href={`/series/${series.id}/reader`}
                  className="rounded-full bg-primary px-2.5 py-1 text-[11px] font-medium text-white"
                >
                  Open Reader
                </a>
              )}
              {canTrackAndOpenReader && (
                <button
                  onClick={handleTrackAndOpenReader}
                  disabled={joining}
                  className="rounded-full bg-primary px-2.5 py-1 text-[11px] font-medium text-white disabled:opacity-50"
                >
                  {joining ? "Joining..." : "Track + Open Reader"}
                </button>
              )}
              {canQueueRip && (
                <button
                  onClick={handleQueueRipNow}
                  disabled={queueingRip || isRipBusy}
                  className="rounded-full border border-card-border px-2.5 py-1 text-[11px] font-medium transition-colors hover:bg-slate-50 disabled:opacity-50 dark:hover:bg-slate-800"
                >
                  {queueingRip
                    ? "Queueing..."
                    : isRipBusy
                      ? currentRipStatus === "RUNNING"
                        ? "Ripping..."
                        : "Queued..."
                      : currentRipStatus === "READY"
                        ? "Check for Updates"
                        : "Queue Rip Sync"}
                </button>
              )}
            </div>
          )}
          {readerEnabled && ripLastError && (
            <p className="text-xs text-red-600 dark:text-red-400">Rip error: {ripLastError}</p>
          )}
          {readerEnabled && ripLastSyncedAt && (
            <p className="text-[11px] text-muted">
              Last synced: {formatDateForUi(ripLastSyncedAt)}
            </p>
          )}
          <div className="flex items-center gap-2">
            <p className="text-xs text-muted">
              Added by {series.createdBy.displayName}
            </p>
            {!editingSeries && (
              <button
                onClick={() => setEditingSeries(true)}
                className="text-xs text-primary hover:underline"
              >
                Edit
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Edit series panel */}
      {editingSeries && (
        <div className="space-y-3 rounded-xl border border-primary/30 bg-card p-4">
          <h2 className="text-sm font-semibold">Edit Series</h2>
          <div>
            <label className="mb-1 block text-xs text-muted">Title</label>
            <input
              type="text"
              value={editTitle}
              onChange={(e) => setEditTitle(e.target.value)}
              className="w-full rounded-lg border border-card-border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs text-muted">Type</label>
              <select
                value={editMediaType}
                onChange={(e) => setEditMediaType(e.target.value)}
                className="w-full rounded-lg border border-card-border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
              >
                {MEDIA_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs text-muted">Total Chapters</label>
              <input
                type="number"
                min={0}
                value={editTotalChapters}
                onChange={(e) => setEditTotalChapters(e.target.value)}
                placeholder="Ongoing"
                className="w-full rounded-lg border border-card-border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
              />
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs text-muted">Reading Link</label>
            <input
              type="url"
              value={editLink}
              onChange={(e) => setEditLink(e.target.value)}
              placeholder="https://mangadex.org/..."
              className="w-full rounded-lg border border-card-border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-muted">Cover Image URL</label>
            <input
              type="url"
              value={editImageUrl}
              onChange={(e) => setEditImageUrl(e.target.value)}
              placeholder="https://cdn.myanimelist.net/images/..."
              className="w-full rounded-lg border border-card-border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-muted">Synopsis</label>
            <textarea
              value={editSynopsis}
              onChange={(e) => setEditSynopsis(e.target.value)}
              placeholder="Brief description of the series..."
              rows={3}
              className="w-full rounded-lg border border-card-border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
            />
          </div>
          <div className="flex gap-2">
            <button
              onClick={handleSaveSeries}
              disabled={savingSeries}
              className="flex-1 rounded-lg bg-primary py-2 text-xs font-medium text-white transition-colors hover:bg-primary-hover disabled:opacity-50"
            >
              {savingSeries ? "Saving..." : "Save Changes"}
            </button>
            <button
              onClick={cancelEditSeries}
              className="flex-1 rounded-lg border border-card-border py-2 text-xs font-medium transition-colors hover:bg-slate-50 dark:hover:bg-slate-800"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Synopsis */}
      {series.synopsis && !editingSeries && (
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
  const [notes, setNotes] = useState(userSeries.notes || "");
  const [saving, setSaving] = useState(false);
  const [confirmUntrack, setConfirmUntrack] = useState(false);
  const [untracking, setUntracking] = useState(false);

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
          notes: notes || null,
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

  async function handleUntrack() {
    setUntracking(true);
    try {
      const res = await fetch(`/api/series/${seriesId}?action=untrack`, {
        method: "DELETE",
      });
      if (res.ok) {
        router.refresh();
      }
    } catch {
      // Silently fail — user can retry
    } finally {
      setUntracking(false);
      setConfirmUntrack(false);
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

      {/* Notes */}
      {userSeries.notes && !editing && (
        <p className="mt-2 text-xs leading-relaxed text-secondary">
          {userSeries.notes}
        </p>
      )}

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
          <div>
            <label className="mb-1 block text-xs text-muted">Notes</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Your notes about this series..."
              rows={2}
              className="w-full rounded-lg border border-card-border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
            />
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
                setConfirmUntrack(false);
                setChapter(userSeries.currentChapter);
                setStatus(userSeries.status);
                setRating(userSeries.rating ?? 0);
                setNotes(userSeries.notes || "");
              }}
              className="flex-1 rounded-lg border border-card-border py-2 text-xs font-medium transition-colors hover:bg-slate-50 dark:hover:bg-slate-800"
            >
              Cancel
            </button>
          </div>

          {/* Stop tracking with two-step confirmation */}
          {!confirmUntrack ? (
            <button
              onClick={() => setConfirmUntrack(true)}
              className="w-full rounded-lg border border-red-300 py-2 text-xs font-medium text-red-600 transition-colors hover:bg-red-50 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-900/20"
            >
              Stop Tracking
            </button>
          ) : (
            <div className="space-y-2">
              <p className="text-center text-xs text-red-600 dark:text-red-400">
                Remove your progress for this series?
              </p>
              <div className="flex gap-2">
                <button
                  onClick={handleUntrack}
                  disabled={untracking}
                  className="flex-1 rounded-lg bg-red-600 py-2 text-xs font-medium text-white transition-colors hover:bg-red-700 disabled:opacity-50"
                >
                  {untracking ? "Removing..." : "Yes, stop tracking"}
                </button>
                <button
                  onClick={() => setConfirmUntrack(false)}
                  className="flex-1 rounded-lg border border-card-border py-2 text-xs font-medium transition-colors hover:bg-slate-50 dark:hover:bg-slate-800"
                >
                  Keep
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
