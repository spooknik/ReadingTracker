import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { MediaType, ReadingStatus } from "@/generated/prisma/client";

// Map MAL media_type to our MediaType enum
function mapMediaType(malType?: string): MediaType {
  switch (malType) {
    case "manga":
      return "MANGA";
    case "manhwa":
      return "MANHWA";
    case "manhua":
      return "MANHUA";
    case "light_novel":
      return "LIGHT_NOVEL";
    default:
      return "MANGA";
  }
}

// Add a series from MAL search result
export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  const body = await request.json();

  const {
    malId,
    title,
    imageUrl,
    synopsis,
    mediaType,
    totalChapters,
    totalVolumes,
    link,
    status,
  } = body;

  if (!title) {
    return NextResponse.json({ error: "Title is required" }, { status: 400 });
  }

  try {
    // Check if series with this MAL ID already exists
    let series = malId
      ? await prisma.series.findUnique({ where: { malId } })
      : null;

    if (!series) {
      series = await prisma.series.create({
        data: {
          malId: malId || null,
          title,
          imageUrl: imageUrl || null,
          synopsis: synopsis || null,
          mediaType: malId ? mapMediaType(mediaType) : (mediaType as MediaType) || "MANGA",
          totalChapters: totalChapters || null,
          totalVolumes: totalVolumes || null,
          link: link || null,
          createdById: user.id,
        },
      });
    }

    // Check if user already tracks this series
    const existingUserSeries = await prisma.userSeries.findUnique({
      where: {
        userId_seriesId: {
          userId: user.id,
          seriesId: series.id,
        },
      },
    });

    if (existingUserSeries) {
      return NextResponse.json(
        { error: "You are already tracking this series", series },
        { status: 409 }
      );
    }

    // Add user tracking
    await prisma.userSeries.create({
      data: {
        userId: user.id,
        seriesId: series.id,
        status: (status as ReadingStatus) || "PLAN_TO_READ",
        currentChapter: 0,
      },
    });

    return NextResponse.json({ series }, { status: 201 });
  } catch (error) {
    console.error("Error adding series:", error);
    return NextResponse.json(
      { error: "Failed to add series" },
      { status: 500 }
    );
  }
}
