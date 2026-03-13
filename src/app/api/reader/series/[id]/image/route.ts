import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { loadReaderManifest } from "@/lib/reader-manifest";
import { isReaderEnabled } from "@/lib/reader-flags";

function sanitizePathSegment(value: string): string {
  return value.replace(/[<>:"/\\|?*\x00-\x1f]/g, "_").trim();
}

function guessContentType(fileName: string): string {
  const ext = path.extname(fileName).toLowerCase();
  switch (ext) {
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".png":
      return "image/png";
    case ".webp":
      return "image/webp";
    case ".gif":
      return "image/gif";
    case ".avif":
      return "image/avif";
    default:
      return "application/octet-stream";
  }
}

function isMissingManifestError(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }

  const maybeErrno = error as { code?: string };
  return maybeErrno.code === "ENOENT";
}

export async function GET(
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
  const user = await getCurrentUser();

  const chapterSlug = request.nextUrl.searchParams.get("chapter");
  const fileName = request.nextUrl.searchParams.get("file");

  if (!chapterSlug || !fileName) {
    return NextResponse.json(
      { error: "Missing chapter or file query parameter" },
      { status: 400 },
    );
  }

  if (fileName.includes("/") || fileName.includes("\\")) {
    return NextResponse.json({ error: "Invalid file name" }, { status: 400 });
  }

  const series = await prisma.series.findUnique({
    where: { id },
    include: {
      rip: true,
      userSeries: {
        where: {
          userId: user.id,
        },
      },
    },
  });

  if (!series) {
    return NextResponse.json({ error: "Series not found" }, { status: 404 });
  }

  if (series.userSeries.length === 0) {
    return NextResponse.json(
      { error: "You are not tracking this series" },
      { status: 403 },
    );
  }

  if (!series.rip || series.rip.status !== "READY" || !series.rip.manifestPath) {
    return NextResponse.json(
      { error: "Ripped content is not ready for this series" },
      { status: 409 },
    );
  }

  let manifest;
  try {
    manifest = await loadReaderManifest(series.rip.manifestPath);
  } catch (error) {
    if (isMissingManifestError(error)) {
      return NextResponse.json(
        { error: "Ripped files are missing on disk. Run Check for Updates to rebuild this series." },
        { status: 409 },
      );
    }

    return NextResponse.json(
      { error: "Failed to load reader manifest" },
      { status: 500 },
    );
  }

  const chapter = manifest.chapters.find((candidate) => candidate.slug === chapterSlug);
  if (!chapter) {
    return NextResponse.json({ error: "Chapter not found" }, { status: 404 });
  }

  const image = chapter.images.find((candidate) => candidate.file === fileName);
  if (!image) {
    return NextResponse.json({ error: "Image not found" }, { status: 404 });
  }

  const chapterDir = path.join(
    path.dirname(series.rip.manifestPath),
    sanitizePathSegment(chapter.slug),
  );
  const resolvedChapterDir = path.resolve(chapterDir);
  const absoluteFilePath = path.resolve(chapterDir, fileName);

  if (!absoluteFilePath.startsWith(resolvedChapterDir + path.sep)) {
    return NextResponse.json({ error: "Invalid image path" }, { status: 400 });
  }

  let content: Buffer;
  try {
    content = await readFile(absoluteFilePath);
  } catch {
    return NextResponse.json({ error: "Image file missing" }, { status: 404 });
  }

  return new NextResponse(new Uint8Array(content), {
    headers: {
      "Content-Type": guessContentType(fileName),
      "Cache-Control": "private, max-age=60",
    },
  });
}
