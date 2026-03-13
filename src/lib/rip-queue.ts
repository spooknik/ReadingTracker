import { access } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { prisma } from "@/lib/prisma";
import { getRipperOutputRoot, getRipperSiteRuntimeInfo } from "@/lib/ripper-sites";

const MAX_OUTPUT_LOG_LENGTH = 240000;
const DEFAULT_COMMAND_TIMEOUT_MS = 1000 * 60 * 60 * 2;

const queueState = globalThis as unknown as {
  ripQueueProcessing: boolean | undefined;
};

function trimOutputLog(value: string): string {
  if (value.length <= MAX_OUTPUT_LOG_LENGTH) {
    return value;
  }

  return value.slice(value.length - MAX_OUTPUT_LOG_LENGTH);
}

function getCommandTimeoutMs(): number {
  const configured = Number.parseInt(process.env.RIP_COMMAND_TIMEOUT_MS || "", 10);
  if (Number.isInteger(configured) && configured > 0) {
    return configured;
  }

  return DEFAULT_COMMAND_TIMEOUT_MS;
}

async function runCommand(command: string, args: string[]): Promise<{
  code: number;
  output: string;
}> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: process.cwd(),
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let outputLog = "";

    const append = (chunk: Buffer | string) => {
      outputLog += chunk.toString();
      outputLog = trimOutputLog(outputLog);
    };

    child.stdout.on("data", append);
    child.stderr.on("data", append);

    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
      setTimeout(() => {
        child.kill("SIGKILL");
      }, 2500);
    }, getCommandTimeoutMs());

    child.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });

    child.on("close", (code) => {
      clearTimeout(timeout);
      resolve({
        code: code ?? 1,
        output: trimOutputLog(outputLog),
      });
    });
  });
}

export async function enqueueRipJob(
  seriesRipId: string,
  kind: "SYNC" | "VERIFY" = "SYNC",
): Promise<{
  queued: boolean;
  jobId: string | null;
  reason: string | null;
}> {
  const existingActive = await prisma.ripJob.findFirst({
    where: {
      seriesRipId,
      status: {
        in: ["QUEUED", "RUNNING"],
      },
    },
    select: { id: true },
  });

  if (existingActive) {
    return {
      queued: false,
      jobId: null,
      reason: "A rip job is already queued or running",
    };
  }

  const job = await prisma.ripJob.create({
    data: {
      seriesRipId,
      kind,
      status: "QUEUED",
    },
  });

  triggerRipQueueProcessing();

  return {
    queued: true,
    jobId: job.id,
    reason: null,
  };
}

async function claimNextQueuedJob() {
  const nextJob = await prisma.ripJob.findFirst({
    where: { status: "QUEUED" },
    orderBy: { createdAt: "asc" },
    include: {
      seriesRip: {
        include: {
          series: true,
        },
      },
    },
  });

  if (!nextJob) {
    return null;
  }

  const now = new Date();
  const claimed = await prisma.ripJob.updateMany({
    where: {
      id: nextJob.id,
      status: "QUEUED",
    },
    data: {
      status: "RUNNING",
      startedAt: now,
      finishedAt: null,
      error: null,
      outputLog: null,
    },
  });

  if (claimed.count === 0) {
    return null;
  }

  await prisma.seriesRip.update({
    where: { id: nextJob.seriesRipId },
    data: {
      status: "RUNNING",
      lastError: null,
    },
  });

  return nextJob;
}

async function executeRipJob(job: NonNullable<Awaited<ReturnType<typeof claimNextQueuedJob>>>) {
  let outputLog = "";

  try {
    const runtime = getRipperSiteRuntimeInfo(job.seriesRip.site || "");
    if (!runtime) {
      throw new Error(`Unsupported ripper site configuration: ${job.seriesRip.site}`);
    }

    if (!job.seriesRip.normalizedUrl) {
      throw new Error("Missing normalized URL for rip job");
    }

    const outputRoot = getRipperOutputRoot();
    const commandArgs: string[] = [
      runtime.ripperScriptPath,
      job.kind === "VERIFY" ? "verify" : "update",
      job.seriesRip.normalizedUrl,
      "--output",
      outputRoot,
    ];

    const commandResult = await runCommand("node", commandArgs);
    outputLog += commandResult.output;

    if (commandResult.code !== 0) {
      throw new Error(`Ripper exited with code ${commandResult.code}`);
    }

    if (!job.seriesRip.manifestPath) {
      throw new Error("Series rip is missing manifest path");
    }

    await access(path.resolve(job.seriesRip.manifestPath));

    await prisma.ripJob.update({
      where: { id: job.id },
      data: {
        status: "SUCCEEDED",
        finishedAt: new Date(),
        error: null,
        outputLog: trimOutputLog(outputLog),
      },
    });

    await prisma.seriesRip.update({
      where: { id: job.seriesRipId },
      data: {
        status: "READY",
        lastError: null,
        lastSyncedAt: new Date(),
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown rip job error";

    await prisma.ripJob.update({
      where: { id: job.id },
      data: {
        status: "FAILED",
        finishedAt: new Date(),
        error: message,
        outputLog: trimOutputLog(outputLog),
      },
    });

    await prisma.seriesRip.update({
      where: { id: job.seriesRipId },
      data: {
        status: "FAILED",
        lastError: message,
      },
    });
  }
}

export async function processQueuedRipJobs(maxJobs = 1): Promise<number> {
  let processed = 0;

  while (processed < maxJobs) {
    const job = await claimNextQueuedJob();
    if (!job) {
      break;
    }

    await executeRipJob(job);
    processed += 1;
  }

  return processed;
}

export function triggerRipQueueProcessing() {
  if (queueState.ripQueueProcessing) {
    return;
  }

  queueState.ripQueueProcessing = true;

  void (async () => {
    try {
      while (true) {
        const processed = await processQueuedRipJobs(1);
        if (processed === 0) {
          break;
        }
      }
    } finally {
      queueState.ripQueueProcessing = false;
    }
  })();
}
