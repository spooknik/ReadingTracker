import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { LibraryList } from "@/components/library-list";

export default async function DashboardPage() {
  const currentUser = await getCurrentUser();

  const allSeries = await prisma.series.findMany({
    include: {
      userSeries: {
        include: {
          user: true,
        },
      },
      createdBy: true,
    },
    orderBy: { createdAt: "desc" },
  });

  const allUsers = await prisma.user.findMany({
    orderBy: { createdAt: "asc" },
  });

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Library</h1>
        <span className="text-sm text-muted">
          {allSeries.length} {allSeries.length === 1 ? "series" : "series"}
        </span>
      </div>

      {/* Series list */}
      {allSeries.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-card-border bg-card p-12 text-center">
          <svg className="mb-4 h-12 w-12 text-muted" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.042A8.967 8.967 0 0 0 6 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 0 1 6 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 0 1 6-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0 0 18 18a8.967 8.967 0 0 0-6 2.292m0-14.25v14.25" />
          </svg>
          <h2 className="mb-1 text-lg font-semibold">No series yet</h2>
          <p className="mb-4 text-sm text-muted">
            Start tracking by adding your first manga or manhwa.
          </p>
          <a
            href="/add"
            className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-primary-hover"
          >
            Add your first series
          </a>
        </div>
      ) : (
        <LibraryList
          allSeries={JSON.parse(JSON.stringify(allSeries))}
          allUsers={JSON.parse(JSON.stringify(allUsers))}
          currentUserId={currentUser.id}
        />
      )}
    </div>
  );
}
