import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";

// Join a series (create user_series entry)
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const user = await getCurrentUser();

  try {
    const series = await prisma.series.findUnique({ where: { id } });
    if (!series) {
      return NextResponse.json({ error: "Series not found" }, { status: 404 });
    }

    const existing = await prisma.userSeries.findUnique({
      where: {
        userId_seriesId: { userId: user.id, seriesId: id },
      },
    });

    if (existing) {
      return NextResponse.json(
        { error: "Already tracking this series" },
        { status: 409 }
      );
    }

    const userSeries = await prisma.userSeries.create({
      data: {
        userId: user.id,
        seriesId: id,
        status: "PLAN_TO_READ",
        currentChapter: 0,
      },
    });

    return NextResponse.json({ userSeries }, { status: 201 });
  } catch (error) {
    console.error("Error joining series:", error);
    return NextResponse.json(
      { error: "Failed to join series" },
      { status: 500 }
    );
  }
}

// Update user progress on a series
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const user = await getCurrentUser();
  const body = await request.json();

  const { status, currentChapter, rating, notes } = body;

  try {
    const userSeries = await prisma.userSeries.findUnique({
      where: {
        userId_seriesId: { userId: user.id, seriesId: id },
      },
    });

    if (!userSeries) {
      return NextResponse.json(
        { error: "You are not tracking this series" },
        { status: 404 }
      );
    }

    const updateData: Record<string, unknown> = {};
    if (status !== undefined) updateData.status = status;
    if (currentChapter !== undefined) updateData.currentChapter = currentChapter;
    if (rating !== undefined) updateData.rating = rating;
    if (notes !== undefined) updateData.notes = notes;

    const updated = await prisma.userSeries.update({
      where: { id: userSeries.id },
      data: updateData,
    });

    return NextResponse.json({ userSeries: updated });
  } catch (error) {
    console.error("Error updating progress:", error);
    return NextResponse.json(
      { error: "Failed to update progress" },
      { status: 500 }
    );
  }
}

// Delete a series (only the creator can delete, removes all user_series too via cascade)
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const user = await getCurrentUser();

  try {
    const series = await prisma.series.findUnique({ where: { id } });
    if (!series) {
      return NextResponse.json({ error: "Series not found" }, { status: 404 });
    }

    if (series.createdById !== user.id) {
      // Allow any user to delete — small trusted group
      // If you want creator-only delete, uncomment:
      // return NextResponse.json({ error: "Only the creator can delete this series" }, { status: 403 });
    }

    await prisma.series.delete({ where: { id } });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting series:", error);
    return NextResponse.json(
      { error: "Failed to delete series" },
      { status: 500 }
    );
  }
}

// Update series metadata (link, etc.)
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  await getCurrentUser(); // Ensure authenticated
  const body = await request.json();

  const { link, totalChapters } = body;

  try {
    const updateData: Record<string, unknown> = {};
    if (link !== undefined) updateData.link = link;
    if (totalChapters !== undefined) updateData.totalChapters = totalChapters;

    const series = await prisma.series.update({
      where: { id },
      data: updateData,
    });

    return NextResponse.json({ series });
  } catch (error) {
    console.error("Error updating series:", error);
    return NextResponse.json(
      { error: "Failed to update series" },
      { status: 500 }
    );
  }
}
