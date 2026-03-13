import { NextResponse } from "next/server";
import { processQueuedRipJobs } from "@/lib/rip-queue";

export async function POST(request: Request) {
  const configuredSecret = process.env.RIP_WORKER_SECRET;
  const isProduction = process.env.NODE_ENV === "production";

  if (isProduction && !configuredSecret) {
    return NextResponse.json({ error: "Worker secret is not configured" }, { status: 503 });
  }

  if (configuredSecret) {
    const providedSecret = request.headers.get("x-worker-secret");
    if (!providedSecret || providedSecret !== configuredSecret) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  const body = await request.json().catch(() => {
    return {};
  });

  const maxJobsRaw = Number.parseInt(String(body.maxJobs ?? "1"), 10);
  const maxJobs = Number.isInteger(maxJobsRaw) && maxJobsRaw > 0
    ? Math.min(maxJobsRaw, 5)
    : 1;

  const processed = await processQueuedRipJobs(maxJobs);

  return NextResponse.json({
    processed,
  });
}
