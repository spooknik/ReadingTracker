import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { findChapterIndexBySlug, loadReaderManifest } from "@/lib/reader-manifest";
import { isReaderEnabled } from "@/lib/reader-flags";

export async function GET(
  _request: NextRequest,
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

  const progress = await prisma.readerProgress.findUnique({
    where: {
      userId_seriesId: {
        userId: user.id,
        seriesId: id,
      },
    },
  });

  if (!progress) {
    return NextResponse.json({
      chapterSlug: null,
      pageIndex: 0,
      updatedAt: null,
    });
  }

  return NextResponse.json({
    chapterSlug: progress.chapterSlug,
    pageIndex: progress.pageIndex,
    updatedAt: progress.updatedAt,
  });
}

export async function PUT(
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
  const body = await request.json();

  const chapterSlug =
    typeof body.chapterSlug === "string" && body.chapterSlug.trim().length > 0
      ? body.chapterSlug.trim()
      : null;
  const pageIndexValue = Number.parseInt(String(body.pageIndex ?? 0), 10);
  const pageIndex = Number.isInteger(pageIndexValue) && pageIndexValue >= 0 ? pageIndexValue : 0;

  const series = await prisma.series.findUnique({
    where: { id },
    include: {
      rip: true,
    },
  });
  if (!series) {
    return NextResponse.json({ error: "Series not found" }, { status: 404 });
  }

  const userSeries = await prisma.userSeries.findUnique({
    where: {
      userId_seriesId: {
        userId: user.id,
        seriesId: id,
      },
    },
  });

  if (!userSeries) {
    return NextResponse.json(
      { error: "You are not tracking this series" },
      { status: 404 },
    );
  }

  const progress = await prisma.readerProgress.upsert({
    where: {
      userId_seriesId: {
        userId: user.id,
        seriesId: id,
      },
    },
    create: {
      userId: user.id,
      seriesId: id,
      chapterSlug,
      pageIndex,
    },
    update: {
      chapterSlug,
      pageIndex,
    },
  });

  if (
    chapterSlug &&
    series.rip &&
    series.rip.status === "READY" &&
    typeof series.rip.manifestPath === "string"
  ) {
    try {
      const manifest = await loadReaderManifest(series.rip.manifestPath);
      const chapterIndex = findChapterIndexBySlug(manifest.chapters, chapterSlug);
      if (chapterIndex >= 0) {
        const chapter = manifest.chapters[chapterIndex];

        const chapterNumber =
          chapter.chapterNumber !== null && Number.isFinite(chapter.chapterNumber)
            ? Math.floor(chapter.chapterNumber)
            : null;

        if (chapterNumber !== null && chapterNumber >= 0) {
          const shouldPromoteToReading =
            userSeries.status === "PLAN_TO_READ" && chapterNumber > 0;

          if (chapterNumber > userSeries.currentChapter || shouldPromoteToReading) {
            await prisma.userSeries.update({
              where: { id: userSeries.id },
              data: {
                currentChapter:
                  chapterNumber > userSeries.currentChapter
                    ? chapterNumber
                    : userSeries.currentChapter,
                status: shouldPromoteToReading ? "READING" : userSeries.status,
              },
            });
          }
        }
      }
    } catch {
      // Ignore manifest parsing/update failures for progress saves.
    }
  }

  return NextResponse.json({
    chapterSlug: progress.chapterSlug,
    pageIndex: progress.pageIndex,
    updatedAt: progress.updatedAt,
  });
}
