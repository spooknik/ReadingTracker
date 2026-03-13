import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { SeriesDetail } from "@/components/series-detail";

interface SeriesPageProps {
  params: Promise<{ id: string }>;
}

export default async function SeriesPage({ params }: SeriesPageProps) {
  const { id } = await params;
  const currentUser = await getCurrentUser();

  const series = await prisma.series.findUnique({
    where: { id },
    include: {
      userSeries: {
        include: { user: true },
      },
      createdBy: true,
      rip: {
        include: {
          jobs: {
            orderBy: { createdAt: "desc" },
            take: 1,
          },
        },
      },
    },
  });

  if (!series) {
    notFound();
  }

  const allUsers = await prisma.user.findMany({
    orderBy: { createdAt: "asc" },
  });

  return (
    <SeriesDetail
      series={series}
      allUsers={allUsers}
      currentUserId={currentUser.id}
    />
  );
}
