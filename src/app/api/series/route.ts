import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { MediaType, ReadingStatus } from "@/generated/prisma/client";
import { getRipperLinkError, getSeriesRipPaths, resolveRipperSite } from "@/lib/ripper-sites";
import { enqueueRipJob } from "@/lib/rip-queue";
import { isAutoRipEnabled, isReaderEnabled } from "@/lib/reader-flags";

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

/**
 * Extract MAL ID from a MAL URL if provided.
 * Supports formats like:
 *   https://myanimelist.net/manga/188486
 *   https://myanimelist.net/manga/188486/Title_Name
 */
function extractMalId(malLink?: string | null): number | null {
  if (!malLink) return null;
  const match = malLink.match(/myanimelist\.net\/manga\/(\d+)/);
  return match ? parseInt(match[1], 10) : null;
}

// Add a series from MAL search result or manual entry
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
    malLink,
    notes,
    status,
  } = body;

  const normalizedLink = typeof link === "string" ? link.trim() : "";
  const linkValue = normalizedLink.length > 0 ? normalizedLink : null;

  if (!title) {
    return NextResponse.json({ error: "Title is required" }, { status: 400 });
  }

  // For manual entries, try to extract MAL ID from a provided MAL link
  const resolvedMalId = malId || extractMalId(malLink);

  try {
    // Check if series with this MAL ID already exists
    let series = resolvedMalId
      ? await prisma.series.findUnique({ where: { malId: resolvedMalId } })
      : null;

    if (!series) {
      series = await prisma.series.create({
        data: {
          malId: resolvedMalId || null,
          title,
          imageUrl: imageUrl || null,
          synopsis: synopsis || null,
          mediaType: malId ? mapMediaType(mediaType) : (mediaType as MediaType) || "MANGA",
          totalChapters: totalChapters || null,
          totalVolumes: totalVolumes || null,
          link: linkValue,
          createdById: user.id,
        },
      });
    } else if (!series.link && linkValue) {
      series = await prisma.series.update({
        where: { id: series.id },
        data: { link: linkValue },
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

    if (linkValue && isReaderEnabled()) {
      const resolvedRipperSite = resolveRipperSite(linkValue);
      if (resolvedRipperSite) {
        const ripPaths = getSeriesRipPaths(resolvedRipperSite);

        const seriesRip = await prisma.seriesRip.upsert({
          where: { seriesId: series.id },
          create: {
            seriesId: series.id,
            site: resolvedRipperSite.site,
            normalizedUrl: resolvedRipperSite.normalizedSeriesUrl,
            outputDir: ripPaths.outputDir,
            manifestPath: ripPaths.manifestPath,
            status: "PENDING",
          },
          update: {
            site: resolvedRipperSite.site,
            normalizedUrl: resolvedRipperSite.normalizedSeriesUrl,
            outputDir: ripPaths.outputDir,
            manifestPath: ripPaths.manifestPath,
            status: "PENDING",
            lastError: null,
          },
        });

        if (isAutoRipEnabled()) {
          await enqueueRipJob(seriesRip.id, "SYNC");
        }
      } else {
        const unsupportedReason = getRipperLinkError(linkValue) || "Series link is unsupported for ripping";

        await prisma.seriesRip.upsert({
          where: { seriesId: series.id },
          create: {
            seriesId: series.id,
            status: "UNSUPPORTED",
            site: null,
            normalizedUrl: null,
            outputDir: null,
            manifestPath: null,
            lastError: unsupportedReason,
          },
          update: {
            status: "UNSUPPORTED",
            site: null,
            normalizedUrl: null,
            outputDir: null,
            manifestPath: null,
            lastError: unsupportedReason,
          },
        });
      }
    }

    // Add user tracking
    await prisma.userSeries.create({
      data: {
        userId: user.id,
        seriesId: series.id,
        status: (status as ReadingStatus) || "PLAN_TO_READ",
        currentChapter: 0,
        notes: notes || null,
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
