import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";

/**
 * GET /api/export
 *
 * Exports all app data as JSON for backup/migration.
 * Includes: users, series (with metadata), and all user progress.
 */
export async function GET() {
  // Ensure the requester is authenticated
  await getCurrentUser();

  const users = await prisma.user.findMany({
    orderBy: { createdAt: "asc" },
  });

  const series = await prisma.series.findMany({
    include: {
      userSeries: {
        include: {
          user: {
            select: { email: true, displayName: true },
          },
        },
      },
      createdBy: {
        select: { email: true, displayName: true },
      },
      rip: {
        include: {
          jobs: {
            orderBy: { createdAt: "asc" },
          },
        },
      },
      readerProgress: {
        include: {
          user: {
            select: { email: true, displayName: true },
          },
        },
      },
    },
    orderBy: { createdAt: "asc" },
  });

  const exportData = {
    exportedAt: new Date().toISOString(),
    version: 1,
    users: users.map((u) => ({
      email: u.email,
      displayName: u.displayName,
      createdAt: u.createdAt,
    })),
    series: series.map((s) => ({
      title: s.title,
      malId: s.malId,
      imageUrl: s.imageUrl,
      synopsis: s.synopsis,
      mediaType: s.mediaType,
      totalChapters: s.totalChapters,
      totalVolumes: s.totalVolumes,
      link: s.link,
      createdBy: s.createdBy.email,
      createdAt: s.createdAt,
      userProgress: s.userSeries.map((us) => ({
        userEmail: us.user.email,
        userName: us.user.displayName,
        status: us.status,
        currentChapter: us.currentChapter,
        rating: us.rating,
        notes: us.notes,
        joinedAt: us.joinedAt,
        updatedAt: us.updatedAt,
      })),
      rip: s.rip
        ? {
            site: s.rip.site,
            normalizedUrl: s.rip.normalizedUrl,
            outputDir: s.rip.outputDir,
            manifestPath: s.rip.manifestPath,
            status: s.rip.status,
            lastError: s.rip.lastError,
            lastSyncedAt: s.rip.lastSyncedAt,
            createdAt: s.rip.createdAt,
            updatedAt: s.rip.updatedAt,
            jobs: s.rip.jobs.map((job) => ({
              kind: job.kind,
              status: job.status,
              startedAt: job.startedAt,
              finishedAt: job.finishedAt,
              error: job.error,
              createdAt: job.createdAt,
              updatedAt: job.updatedAt,
            })),
          }
        : null,
      readerProgress: s.readerProgress.map((progress) => ({
        userEmail: progress.user.email,
        userName: progress.user.displayName,
        chapterSlug: progress.chapterSlug,
        pageIndex: progress.pageIndex,
        createdAt: progress.createdAt,
        updatedAt: progress.updatedAt,
      })),
    })),
  };

  return new NextResponse(JSON.stringify(exportData, null, 2), {
    headers: {
      "Content-Type": "application/json",
      "Content-Disposition": `attachment; filename="readingtracker-export-${new Date().toISOString().slice(0, 10)}.json"`,
    },
  });
}
