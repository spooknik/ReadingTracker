import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";

export async function PATCH(request: NextRequest) {
  const user = await getCurrentUser();
  const body = await request.json();

  const { displayName } = body;

  if (!displayName || typeof displayName !== "string" || displayName.trim().length === 0) {
    return NextResponse.json(
      { error: "Display name is required" },
      { status: 400 }
    );
  }

  if (displayName.trim().length > 30) {
    return NextResponse.json(
      { error: "Display name must be 30 characters or less" },
      { status: 400 }
    );
  }

  try {
    const updated = await prisma.user.update({
      where: { id: user.id },
      data: { displayName: displayName.trim() },
    });

    return NextResponse.json({ user: updated });
  } catch (error) {
    console.error("Error updating profile:", error);
    return NextResponse.json(
      { error: "Failed to update profile" },
      { status: 500 }
    );
  }
}

export async function DELETE() {
  const user = await getCurrentUser();
  const enabled = process.env.ENABLE_READER === "1";

  if (!enabled) {
    return NextResponse.json(
      { error: "Reader cleanup is disabled" },
      { status: 400 },
    );
  }

  try {
    const unsupportedSeriesIds = await prisma.series.findMany({
      where: {
        userSeries: {
          some: {
            userId: user.id,
          },
        },
        rip: {
          is: {
            status: "UNSUPPORTED",
          },
        },
      },
      select: {
        id: true,
      },
    });

    const seriesIds = unsupportedSeriesIds.map((series) => series.id);

    const removedReaderProgress =
      seriesIds.length > 0
        ? await prisma.readerProgress.deleteMany({
            where: {
              userId: user.id,
              seriesId: {
                in: seriesIds,
              },
            },
          })
        : { count: 0 };

    const resetUnsupportedRips = await prisma.seriesRip.updateMany({
      where: {
        series: {
          userSeries: {
            some: {
              userId: user.id,
            },
          },
        },
        status: "UNSUPPORTED",
      },
      data: {
        normalizedUrl: null,
        outputDir: null,
        manifestPath: null,
      },
    });

    return NextResponse.json({
      removedReaderProgress: removedReaderProgress.count,
      resetUnsupportedRips: resetUnsupportedRips.count,
    });
  } catch (error) {
    console.error("Error cleaning unsupported reader data:", error);
    return NextResponse.json(
      { error: "Failed to cleanup unsupported reader data" },
      { status: 500 },
    );
  }
}
