import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { getSeriesRipPaths, resolveRipperSite } from "@/lib/ripper-sites";
import { enqueueRipJob, triggerRipQueueProcessing } from "@/lib/rip-queue";
import { isReaderEnabled } from "@/lib/reader-flags";
import { loadRipManifestProgress } from "@/lib/reader-manifest";

async function getManifestProgress(manifestPath: string | null): Promise<Awaited<ReturnType<typeof loadRipManifestProgress>>> {
  if (!manifestPath) {
    return null;
  }

  try {
    return await loadRipManifestProgress(manifestPath);
  } catch {
    return null;
  }
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!isReaderEnabled()) {
    return NextResponse.json(
      { error: "Reader is disabled" },
      { status: 400 },
    );
  }

  triggerRipQueueProcessing();

  const { id } = await params;
  await getCurrentUser();

  const series = await prisma.series.findUnique({
    where: { id },
    include: {
      rip: {
        include: {
          jobs: {
            orderBy: { createdAt: "desc" },
            take: 5,
          },
        },
      },
    },
  });

  if (!series) {
    return NextResponse.json({ error: "Series not found" }, { status: 404 });
  }

  if (series.rip) {
    const progress = await getManifestProgress(series.rip.manifestPath);
    const hasActiveJob = series.rip.jobs.some((job) => {
      return job.status === "QUEUED" || job.status === "RUNNING";
    });

    let status = series.rip.status;
    let lastError = series.rip.lastError;
    let lastSyncedAt = series.rip.lastSyncedAt;

    if (
      progress &&
      progress.completedChapters > 0 &&
      !hasActiveJob &&
      status !== "READY" &&
      status !== "UNSUPPORTED"
    ) {
      status = "READY";
      lastError = null;
      lastSyncedAt = lastSyncedAt || new Date();

      try {
        await prisma.seriesRip.update({
          where: { id: series.rip.id },
          data: {
            status: "READY",
            lastError: null,
            lastSyncedAt,
          },
        });
      } catch {
        // Silently fail
      }
    }

    return NextResponse.json({
      supported: status !== "UNSUPPORTED",
      status,
      site: series.rip.site,
      normalizedUrl: series.rip.normalizedUrl,
      outputDir: series.rip.outputDir,
      manifestPath: series.rip.manifestPath,
      lastError,
      lastSyncedAt,
      progress,
      jobs: series.rip.jobs.map((job) => {
        return {
          id: job.id,
          kind: job.kind,
          status: job.status,
          startedAt: job.startedAt,
          finishedAt: job.finishedAt,
          error: job.error,
          createdAt: job.createdAt,
        };
      }),
    });
  }

  const resolved = resolveRipperSite(series.link || "");

  if (!resolved) {
    return NextResponse.json({
      supported: false,
      status: "UNSUPPORTED",
      site: null,
      normalizedUrl: null,
      outputDir: null,
      manifestPath: null,
      lastError: null,
      lastSyncedAt: null,
      progress: null,
      jobs: [],
    });
  }

  const paths = getSeriesRipPaths(resolved);

  return NextResponse.json({
    supported: true,
    status: "PENDING",
    site: resolved.site,
    normalizedUrl: resolved.normalizedSeriesUrl,
    outputDir: paths.outputDir,
    manifestPath: paths.manifestPath,
    lastError: null,
    lastSyncedAt: null,
    progress: null,
    jobs: [],
  });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!isReaderEnabled()) {
    return NextResponse.json(
      { error: "Reader is disabled" },
      { status: 400 },
    );
  }

  const { id } = await params;
  await getCurrentUser();

  const body = await request.json().catch(() => {
    return {};
  });
  const kind = body.kind === "VERIFY" ? "VERIFY" : "SYNC";

  const series = await prisma.series.findUnique({ where: { id } });
  if (!series) {
    return NextResponse.json({ error: "Series not found" }, { status: 404 });
  }

  const resolved = resolveRipperSite(series.link || "");
  if (!resolved) {
    return NextResponse.json(
      { error: "Series link is not supported for ripping" },
      { status: 400 },
    );
  }

  const paths = getSeriesRipPaths(resolved);

  const seriesRip = await prisma.seriesRip.upsert({
    where: { seriesId: series.id },
    create: {
      seriesId: series.id,
      site: resolved.site,
      normalizedUrl: resolved.normalizedSeriesUrl,
      outputDir: paths.outputDir,
      manifestPath: paths.manifestPath,
      status: "PENDING",
      lastError: null,
    },
    update: {
      site: resolved.site,
      normalizedUrl: resolved.normalizedSeriesUrl,
      outputDir: paths.outputDir,
      manifestPath: paths.manifestPath,
      status: "PENDING",
      lastError: null,
    },
  });

  const queued = await enqueueRipJob(seriesRip.id, kind);

  if (!queued.queued) {
    return NextResponse.json(
      {
        queued: false,
        message: queued.reason,
      },
      { status: 409 },
    );
  }

  const job = await prisma.ripJob.findUnique({ where: { id: queued.jobId || "" } });
  if (!job) {
    return NextResponse.json({ error: "Failed to queue rip job" }, { status: 500 });
  }

  return NextResponse.json(
    {
      queued: true,
      job: {
        id: job.id,
        kind: job.kind,
        status: job.status,
        createdAt: job.createdAt,
      },
    },
    { status: 201 },
  );
}
