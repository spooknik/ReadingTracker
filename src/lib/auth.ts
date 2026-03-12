import { headers } from "next/headers";
import { prisma } from "@/lib/prisma";
import { User } from "@/generated/prisma/client";

/**
 * Get the current user from request headers.
 * Creates the user in the database if they don't exist yet.
 *
 * This should be called in server components and API routes.
 */
export async function getCurrentUser(): Promise<User> {
  const headersList = await headers();
  const email = headersList.get("x-user-email");

  if (!email) {
    throw new Error("No authenticated user found");
  }

  // Upsert: find existing user or create new one
  const user = await prisma.user.upsert({
    where: { email },
    update: {},
    create: {
      email,
      displayName: email.split("@")[0], // Default display name from email prefix
    },
  });

  return user;
}
