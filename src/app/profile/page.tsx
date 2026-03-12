import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { ProfileForm } from "@/components/profile-form";

export default async function ProfilePage() {
  const user = await getCurrentUser();

  const stats = await prisma.userSeries.groupBy({
    by: ["status"],
    where: { userId: user.id },
    _count: { status: true },
  });

  const totalSeries = stats.reduce((sum, s) => sum + s._count.status, 0);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Profile</h1>

      <div className="rounded-xl border border-card-border bg-card p-4">
        <div className="mb-4 flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary text-lg font-bold text-white">
            {user.displayName.charAt(0).toUpperCase()}
          </div>
          <div>
            <p className="font-semibold">{user.displayName}</p>
            <p className="text-xs text-muted">{user.email}</p>
          </div>
        </div>

        <ProfileForm currentName={user.displayName} />
      </div>

      {/* Stats */}
      <div className="rounded-xl border border-card-border bg-card p-4">
        <h2 className="mb-3 text-sm font-semibold">Your Stats</h2>
        <div className="grid grid-cols-2 gap-3">
          <StatBox label="Total Series" value={totalSeries} />
          {stats.map((s) => (
            <StatBox
              key={s.status}
              label={formatStatus(s.status)}
              value={s._count.status}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function StatBox({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg bg-slate-50 p-3 dark:bg-slate-800">
      <p className="text-2xl font-bold">{value}</p>
      <p className="text-xs text-muted">{label}</p>
    </div>
  );
}

function formatStatus(status: string): string {
  return status
    .replace(/_/g, " ")
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}
