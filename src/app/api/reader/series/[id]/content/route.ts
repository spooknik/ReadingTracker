import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { isReaderEnabled } from "@/lib/reader-flags";
import {
  findBestChapterSlugForProgress,
  findChapterIndexBySlug,
  loadReaderManifest,
} from "@/lib/reader-manifest";

interface ReaderImageResponse {
  url: string;
  index: number;
  bytes: number | null;
}

interface ReaderChapterResponse {
  slug: string;
  title: string;
  chapterNumber: number | null;
  imageCount: number;
  images: ReaderImageResponse[];
}

interface ReaderManifestResponse {
  site: string;
  title: string;
  updatedAt: string | null;
  chapters: ReaderChapterResponse[];
  currentChapterSlug: string;
  currentPageIndex: number;
  hasPrevious: boolean;
  hasNext: boolean;
  previousChapterSlug: string | null;
  nextChapterSlug: string | null;
}

function clampPageIndex(pageIndex: number, max: number): number {
  if (!Number.isInteger(pageIndex) || pageIndex < 0) {
    return 0;
  }

  if (pageIndex >= max) {
    return Math.max(0, max - 1);
  }

  return pageIndex;
}

function buildReaderResponse(
  seriesId: string,
  manifest: Awaited<ReturnType<typeof loadReaderManifest>>,
  chapterSlug: string,
  pageIndex: number,
): ReaderManifestResponse {
  const chapterIndex = findChapterIndexBySlug(manifest.chapters, chapterSlug);
  if (chapterIndex < 0) {
    throw new Error("Requested chapter not found in manifest");
  }

  const chapter = manifest.chapters[chapterIndex];
  const clampedPageIndex = clampPageIndex(pageIndex, chapter.images.length);

  const images: ReaderImageResponse[] = chapter.images.map((image) => {
    return {
      index: image.index,
      bytes: image.bytes,
      url: `/api/reader/series/${seriesId}/image?chapter=${encodeURIComponent(chapter.slug)}&file=${encodeURIComponent(image.file)}`,
    };
  });

  return {
    site: manifest.site,
    title: manifest.title,
    updatedAt: manifest.updatedAt,
    chapters: [
      {
        slug: chapter.slug,
        title: chapter.title,
        chapterNumber: chapter.chapterNumber,
        imageCount: chapter.imageCount,
        images,
      },
    ],
    currentChapterSlug: chapter.slug,
    currentPageIndex: clampedPageIndex,
    hasPrevious: chapterIndex > 0,
    hasNext: chapterIndex < manifest.chapters.length - 1,
    previousChapterSlug: chapterIndex > 0 ? manifest.chapters[chapterIndex - 1].slug : null,
    nextChapterSlug:
      chapterIndex < manifest.chapters.length - 1 ? manifest.chapters[chapterIndex + 1].slug : null,
  };
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!isReaderEnabled()) {
    return NextResponse.json(
      { error: "Reader is disabled" },
      { status: 400 },
    );
  }

  const { id } = await params;
  const user = await getCurrentUser();

  const series = await prisma.series.findUnique({
    where: { id },
    include: {
      rip: true,
      userSeries: {
        where: {
          userId: user.id,
        },
      },
      readerProgress: {
        where: {
          userId: user.id,
        },
        take: 1,
      },
    },
  });

  if (!series) {
    return NextResponse.json({ error: "Series not found" }, { status: 404 });
  }

  if (series.userSeries.length === 0) {
    return NextResponse.json(
      { error: "You are not tracking this series" },
      { status: 403 },
    );
  }

  if (!series.rip || series.rip.status !== "READY" || !series.rip.manifestPath) {
    return NextResponse.json(
      { error: "Ripped content is not ready for this series" },
      { status: 409 },
    );
  }

  let manifest;
  try {
    manifest = await loadReaderManifest(series.rip.manifestPath);
  } catch (error) {
    return NextResponse.json(
      {
        error: "Failed to load reader manifest",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 },
    );
  }

  if (manifest.chapters.length === 0) {
    return NextResponse.json(
      { error: "Manifest has no readable chapters" },
      { status: 409 },
    );
  }

  const chapterParam = request.nextUrl.searchParams.get("chapter");
  const pageParam = request.nextUrl.searchParams.get("page");
  const progress = series.readerProgress[0] || null;
  const userSeries = series.userSeries[0];

  const preferredChapter =
    (typeof chapterParam === "string" && chapterParam.trim().length > 0
      ? chapterParam.trim()
      : null) ||
    progress?.chapterSlug ||
    findBestChapterSlugForProgress(manifest.chapters, userSeries.currentChapter);

  const preferredPageFromQuery =
    pageParam !== null ? Number.parseInt(pageParam, 10) : Number.NaN;
  const preferredPage =
    Number.isInteger(preferredPageFromQuery) && preferredPageFromQuery >= 0
      ? preferredPageFromQuery
      : progress?.pageIndex ?? 0;

  const chapterExists = findChapterIndexBySlug(manifest.chapters, preferredChapter);
  const activeChapterSlug = chapterExists >= 0 ? preferredChapter : manifest.chapters[0].slug;

  let responsePayload: ReaderManifestResponse;
  try {
    responsePayload = buildReaderResponse(id, manifest, activeChapterSlug, preferredPage);
  } catch (error) {
    return NextResponse.json(
      {
        error: "Failed to build reader payload",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 },
    );
  }

  return NextResponse.json(responsePayload);
}
