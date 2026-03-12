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
