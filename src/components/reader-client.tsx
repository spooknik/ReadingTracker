"use client";

import Image from "next/image";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

interface ReaderImage {
  url: string;
  index: number;
  bytes: number | null;
}

interface ReaderChapter {
  slug: string;
  title: string;
  chapterNumber: number | null;
  imageCount: number;
  images: ReaderImage[];
}

interface ReaderContentResponse {
  site: string;
  title: string;
  updatedAt: string | null;
  chapters: ReaderChapter[];
  currentChapterSlug: string;
  currentPageIndex: number;
  hasPrevious: boolean;
  hasNext: boolean;
  previousChapterSlug: string | null;
  nextChapterSlug: string | null;
}

interface RipStatusResponse {
  supported: boolean;
  status: string;
  site: string | null;
  lastError: string | null;
  lastSyncedAt: string | null;
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

interface ReaderClientProps {
  seriesId: string;
  seriesTitle: string;
  ripStatus: string;
}

function formatRipStatus(status: string): string {
  return status
    .replace(/_/g, " ")
    .toLowerCase()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function formatChapterLabel(chapter: ReaderChapter): string {
  if (chapter.chapterNumber !== null) {
    return `Chapter ${chapter.chapterNumber}`;
  }

  return chapter.title;
}

export function ReaderClient({ seriesId, seriesTitle, ripStatus }: ReaderClientProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [content, setContent] = useState<ReaderContentResponse | null>(null);
  const [ripInfo, setRipInfo] = useState<RipStatusResponse | null>(null);
  const [requestingRip, setRequestingRip] = useState(false);

  const imageRefs = useRef<Array<HTMLDivElement | null>>([]);
  const visiblePageRef = useRef<number>(0);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const chapterParam = searchParams.get("chapter");
  const pageParam = searchParams.get("page");

  const activeChapter = content?.chapters[0] || null;
  const totalPages = activeChapter?.images.length || 0;

  const readableRipStatus = useMemo(() => {
    return formatRipStatus(ripStatus);
  }, [ripStatus]);

  const loadRipStatus = useCallback(async () => {
    const response = await fetch(`/api/series/${seriesId}/rip`, {
      method: "GET",
      cache: "no-store",
    });

    if (!response.ok) {
      throw new Error("Failed to load rip status");
    }

    const payload = (await response.json()) as RipStatusResponse;
    setRipInfo(payload);
    return payload;
  }, [seriesId]);

  const loadReaderContent = useCallback(async () => {
    const params = new URLSearchParams();
    if (chapterParam) {
      params.set("chapter", chapterParam);
    }
    if (pageParam) {
      params.set("page", pageParam);
    }

    const response = await fetch(
      `/api/reader/series/${seriesId}/content${params.toString() ? `?${params.toString()}` : ""}`,
      {
        method: "GET",
        cache: "no-store",
      },
    );

    if (!response.ok) {
      const data = await response.json().catch(() => {
        return {};
      });

      const message =
        typeof data.error === "string" && data.error.length > 0
          ? data.error
          : "Failed to load reader content";
      throw new Error(message);
    }

    const payload = (await response.json()) as ReaderContentResponse;
    setContent(payload);
    setError("");

    return payload;
  }, [chapterParam, pageParam, seriesId]);

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      await loadRipStatus();
      await loadReaderContent();
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Failed to load reader");
    } finally {
      setLoading(false);
    }
  }, [loadReaderContent, loadRipStatus]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  useEffect(() => {
    if (!content || !activeChapter) {
      return;
    }

    const currentPageIndex = content.currentPageIndex;
    visiblePageRef.current = currentPageIndex;

    const target = imageRefs.current[currentPageIndex];
    if (target) {
      target.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [content, activeChapter]);

  useEffect(() => {
    if (!activeChapter || activeChapter.images.length === 0) {
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        let bestIndex = visiblePageRef.current;
        let bestRatio = 0;

        for (const entry of entries) {
          const element = entry.target as HTMLElement;
          const rawIndex = element.dataset.pageIndex;
          const pageIndex = rawIndex ? Number.parseInt(rawIndex, 10) : Number.NaN;
          if (!Number.isInteger(pageIndex)) {
            continue;
          }

          if (entry.intersectionRatio > bestRatio) {
            bestRatio = entry.intersectionRatio;
            bestIndex = pageIndex;
          }
        }

        if (bestRatio > 0.2 && bestIndex !== visiblePageRef.current) {
          visiblePageRef.current = bestIndex;

          if (saveTimerRef.current) {
            clearTimeout(saveTimerRef.current);
          }

          saveTimerRef.current = setTimeout(() => {
            void fetch(`/api/reader/series/${seriesId}/progress`, {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                chapterSlug: activeChapter.slug,
                pageIndex: bestIndex,
              }),
            });
          }, 500);
        }
      },
      {
        threshold: [0.15, 0.35, 0.6, 0.85],
        rootMargin: "0px 0px -20% 0px",
      },
    );

    const nodes = imageRefs.current.filter((node): node is HTMLDivElement => node !== null);
    for (const node of nodes) {
      observer.observe(node);
    }

    return () => {
      observer.disconnect();
    };
  }, [activeChapter, seriesId]);

  useEffect(() => {
    return () => {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
    };
  }, []);

  async function requestRipNow() {
    setRequestingRip(true);
    setError("");

    try {
      const response = await fetch(`/api/series/${seriesId}/rip`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: "SYNC" }),
      });

      if (!response.ok) {
        const data = await response.json().catch(() => {
          return {};
        });

        const message =
          typeof data.error === "string" && data.error.length > 0
            ? data.error
            : typeof data.message === "string" && data.message.length > 0
              ? data.message
              : "Failed to queue rip job";
        setError(message);
      }

      await loadRipStatus();
    } catch {
      setError("Failed to queue rip job");
    } finally {
      setRequestingRip(false);
    }
  }

  async function openPreviousChapter() {
    if (!content?.previousChapterSlug) {
      return;
    }

    const params = new URLSearchParams(searchParams.toString());
    params.set("chapter", content.previousChapterSlug);
    params.set("page", "0");
    router.push(`${pathname}?${params.toString()}`);
  }

  async function openNextChapter() {
    if (!content?.nextChapterSlug) {
      return;
    }

    const params = new URLSearchParams(searchParams.toString());
    params.set("chapter", content.nextChapterSlug);
    params.set("page", "0");
    router.push(`${pathname}?${params.toString()}`);
  }

  return (
    <div className="space-y-4 pb-20">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">{seriesTitle}</h1>
          <p className="text-xs text-muted">
            Reader status: {ripInfo ? formatRipStatus(ripInfo.status) : readableRipStatus}
          </p>
        </div>
        <Link
          href={`/series/${seriesId}`}
          className="rounded-lg border border-card-border px-3 py-2 text-xs font-medium hover:bg-slate-50 dark:hover:bg-slate-800"
        >
          Back to Series
        </Link>
      </div>

      {error && (
        <div className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-300">
          {error}
        </div>
      )}

      {loading && (
        <div className="rounded-xl border border-card-border bg-card p-6 text-sm text-muted">
          Loading reader...
        </div>
      )}

      {!loading && !content && (
        <div className="space-y-3 rounded-xl border border-card-border bg-card p-4">
          <p className="text-sm text-secondary">
            {ripInfo?.supported === false
              ? "This reading link is not supported by the built-in reader yet."
              : "Ripped content is not available yet. You can queue a sync job and refresh once ready."}
          </p>
          <div className="flex flex-wrap gap-2">
            {ripInfo?.supported !== false && (
              <button
                onClick={requestRipNow}
                disabled={requestingRip}
                className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-primary-hover disabled:opacity-50"
              >
                {requestingRip ? "Queueing..." : "Queue Rip Sync"}
              </button>
            )}
            <button
              onClick={() => {
                void loadAll();
              }}
              className="rounded-lg border border-card-border px-4 py-2 text-sm font-medium hover:bg-slate-50 dark:hover:bg-slate-800"
            >
              Refresh Status
            </button>
          </div>
          {ripInfo && ripInfo.jobs.length > 0 && (
            <div className="rounded-lg border border-card-border bg-background p-3 text-xs text-muted">
              Latest job: {formatRipStatus(ripInfo.jobs[0].status)}
              {ripInfo.jobs[0].error ? ` - ${ripInfo.jobs[0].error}` : ""}
            </div>
          )}
        </div>
      )}

      {!loading && content && activeChapter && (
        <>
          <div className="flex items-center justify-between rounded-xl border border-card-border bg-card p-3">
            <div>
              <p className="text-sm font-semibold">{formatChapterLabel(activeChapter)}</p>
              <p className="text-xs text-muted">
                {activeChapter.title} · Page {Math.min(content.currentPageIndex + 1, totalPages)} of {totalPages}
              </p>
            </div>
            <div className="flex gap-2">
              <button
                onClick={openPreviousChapter}
                disabled={!content.hasPrevious}
                className="rounded-lg border border-card-border px-3 py-2 text-xs font-medium disabled:opacity-50"
              >
                Prev
              </button>
              <button
                onClick={openNextChapter}
                disabled={!content.hasNext}
                className="rounded-lg border border-card-border px-3 py-2 text-xs font-medium disabled:opacity-50"
              >
                Next
              </button>
              <button
                onClick={async () => {
                  await loadAll();
                }}
                className="rounded-lg border border-card-border px-3 py-2 text-xs font-medium"
              >
                Refresh
              </button>
            </div>
          </div>

          <div className="space-y-4">
            {activeChapter.images.map((image, index) => (
              <div
                key={image.url}
                className="overflow-hidden rounded-xl border border-card-border bg-card"
                ref={(element) => {
                  imageRefs.current[index] = element;
                }}
                data-page-index={index}
              >
                <Image
                  src={image.url}
                  alt={`${activeChapter.title} page ${index + 1}`}
                  width={1200}
                  height={1700}
                  unoptimized
                  priority={index === 0}
                  className="h-auto w-full"
                />
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
