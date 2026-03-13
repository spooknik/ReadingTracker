import { notFound, redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { ReaderClient } from "@/components/reader-client";
import { isReaderEnabled } from "@/lib/reader-flags";

interface ReaderPageProps {
  params: Promise<{ id: string }>;
}

export default async function ReaderPage({ params }: ReaderPageProps) {
  if (!isReaderEnabled()) {
    redirect("/");
  }

  const { id } = await params;
  const user = await getCurrentUser();

  const series = await prisma.series.findUnique({
    where: { id },
    include: {
      userSeries: {
        where: {
          userId: user.id,
        },
      },
      rip: true,
    },
  });

  if (!series) {
    notFound();
  }

  if (series.userSeries.length === 0) {
    redirect(`/series/${id}`);
  }

  return (
    <ReaderClient
      seriesId={series.id}
      seriesTitle={series.title}
    />
  );
}
