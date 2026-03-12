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
    })),
  };

  return new NextResponse(JSON.stringify(exportData, null, 2), {
    headers: {
      "Content-Type": "application/json",
      "Content-Disposition": `attachment; filename="readingtracker-export-${new Date().toISOString().slice(0, 10)}.json"`,
    },
  });
}
