import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { getSeriesRipPaths, resolveRipperSite } from "@/lib/ripper-sites";
import { enqueueRipJob, triggerRipQueueProcessing } from "@/lib/rip-queue";
import { isReaderEnabled } from "@/lib/reader-flags";

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
    return NextResponse.json({
      supported: series.rip.status !== "UNSUPPORTED",
      status: series.rip.status,
      site: series.rip.site,
      normalizedUrl: series.rip.normalizedUrl,
      outputDir: series.rip.outputDir,
      manifestPath: series.rip.manifestPath,
      lastError: series.rip.lastError,
      lastSyncedAt: series.rip.lastSyncedAt,
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
