import { readFile } from "node:fs/promises";

interface RawManifestImage {
  index?: unknown;
  file?: unknown;
  bytes?: unknown;
  url?: unknown;
}

interface RawManifestChapter {
  slug?: unknown;
  title?: unknown;
  status?: unknown;
  missingFromSource?: unknown;
  chapterOrder?: unknown;
  scene?: unknown;
  episodeId?: unknown;
  releaseDate?: unknown;
  releaseDateText?: unknown;
  url?: unknown;
  images?: unknown;
}

interface RawManifestSeries {
  title?: unknown;
}

interface RawManifest {
  site?: unknown;
  updatedAt?: unknown;
  series?: RawManifestSeries;
  chapters?: unknown;
}

const THUMBNAIL_MAX_DIMENSION = 220;

export interface ReaderManifestImage {
  index: number;
  file: string;
  bytes: number | null;
  url: string | null;
}

export interface ReaderManifestChapter {
  slug: string;
  title: string;
  status: string;
  chapterNumber: number | null;
  imageCount: number;
  images: ReaderManifestImage[];
  releaseDate: string | null;
  releaseDateText: string | null;
  sourceUrl: string | null;
}

export interface ReaderManifestData {
  site: string;
  title: string;
  updatedAt: string | null;
  chapters: ReaderManifestChapter[];
}

export interface RipManifestProgress {
  totalChapters: number;
  completedChapters: number;
  failedChapters: number;
  pendingChapters: number;
  runningChapterSlug: string | null;
  runningChapterIndex: number | null;
}

function asString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string") {
    const parsed = Number.parseFloat(value);
    if (!Number.isNaN(parsed) && Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return null;
}

function parseImageDimension(value: string): number | null {
  const match = value.trim().match(/^(\d{1,5})(?:px)?$/i);
  if (!match) {
    return null;
  }

  const parsed = Number.parseInt(match[1], 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return null;
  }

  return parsed;
}

function isLikelyPlaceholderImageUrl(imageUrl: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(imageUrl);
  } catch {
    return false;
  }

  const pathname = parsed.pathname.toLowerCase();
  return (
    pathname.includes("/wp-content/themes/") &&
    /(?:^|\/)(?:dflazy|placeholder|spacer)\.(?:jpg|jpeg|png|webp|gif|avif)$/.test(pathname)
  );
}

function isLikelyThumbnailVariantUrl(imageUrl: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(imageUrl);
  } catch {
    return false;
  }

  const pathname = parsed.pathname.toLowerCase();
  if (!pathname.includes("/wp-content/uploads/")) {
    return false;
  }

  const fileName = pathname.split("/").pop() || "";
  const fileNameSizeMatch = fileName.match(/-(\d{2,4})x(\d{2,4})(?=\.[a-z0-9]+$)/i);
  if (fileNameSizeMatch) {
    const width = Number.parseInt(fileNameSizeMatch[1], 10);
    const height = Number.parseInt(fileNameSizeMatch[2], 10);
    if (
      Number.isInteger(width) &&
      Number.isInteger(height) &&
      width <= THUMBNAIL_MAX_DIMENSION &&
      height <= THUMBNAIL_MAX_DIMENSION
    ) {
      return true;
    }
  }

  const queryWidthRaw = parsed.searchParams.get("w");
  const queryHeightRaw = parsed.searchParams.get("h");
  if (!queryWidthRaw || !queryHeightRaw) {
    return false;
  }

  const queryWidth = parseImageDimension(queryWidthRaw);
  const queryHeight = parseImageDimension(queryHeightRaw);
  return (
    queryWidth !== null &&
    queryHeight !== null &&
    queryWidth <= THUMBNAIL_MAX_DIMENSION &&
    queryHeight <= THUMBNAIL_MAX_DIMENSION
  );
}

function isLikelyNonChapterImageUrl(imageUrl: string): boolean {
  return isLikelyPlaceholderImageUrl(imageUrl) || isLikelyThumbnailVariantUrl(imageUrl);
}

function parseChapterNumber(chapter: RawManifestChapter, index: number): number | null {
  const chapterOrder = asNumber(chapter.chapterOrder);
  if (chapterOrder !== null && chapterOrder >= 0) {
    return chapterOrder;
  }

  const scene = asNumber(chapter.scene);
  if (scene !== null && scene >= 0) {
    return scene;
  }

  const slug = asString(chapter.slug)?.toLowerCase() || "";
  const title = asString(chapter.title)?.toLowerCase() || "";

  if (slug === "notice" || title === "notice" || title === "notice.") {
    return 0;
  }

  const slugChapterMatch = slug.match(/^chapter-(\d+)(?:-(\d+))?$/i);
  if (slugChapterMatch) {
    const major = Number.parseInt(slugChapterMatch[1], 10);
    if (!Number.isNaN(major)) {
      const minorPart = slugChapterMatch[2];
      if (!minorPart) {
        return major;
      }

      const minor = Number.parseInt(minorPart, 10);
      if (!Number.isNaN(minor)) {
        return major + minor / (10 ** minorPart.length);
      }

      return major;
    }
  }

  const titleChapterMatch = title.match(/^chapter\s*(\d+)(?:\.(\d+))?/i);
  if (titleChapterMatch) {
    const major = Number.parseInt(titleChapterMatch[1], 10);
    if (!Number.isNaN(major)) {
      const minorPart = titleChapterMatch[2];
      if (!minorPart) {
        return major;
      }

      const minor = Number.parseInt(minorPart, 10);
      if (!Number.isNaN(minor)) {
        return major + minor / (10 ** minorPart.length);
      }

      return major;
    }
  }

  const fallbackEpisodeId = asNumber(chapter.episodeId);
  if (fallbackEpisodeId !== null && fallbackEpisodeId > 0 && fallbackEpisodeId < 1000000) {
    return fallbackEpisodeId;
  }

  return index + 1;
}

function normalizeManifestChapter(
  rawChapter: RawManifestChapter,
  chapterIndex: number,
): ReaderManifestChapter | null {
  const slug = asString(rawChapter.slug);
  if (!slug) {
    return null;
  }

  const title = asString(rawChapter.title) || slug;
  const status = asString(rawChapter.status) || "pending";
  const sourceUrl = asString(rawChapter.url);
  const releaseDate = asString(rawChapter.releaseDate);
  const releaseDateText = asString(rawChapter.releaseDateText);

  const rawImages = Array.isArray(rawChapter.images) ? rawChapter.images : [];
  const images: ReaderManifestImage[] = rawImages
    .map((rawImage, imageIndex) => {
      const candidate = rawImage as RawManifestImage;
      const file = asString(candidate.file);
      if (!file) {
        return null;
      }

      const sourceUrl = asString(candidate.url);
      if (sourceUrl && isLikelyNonChapterImageUrl(sourceUrl)) {
        return null;
      }

      const index = asNumber(candidate.index);
      const bytes = asNumber(candidate.bytes);

      return {
        index: index !== null ? Math.max(1, Math.floor(index)) : imageIndex + 1,
        file,
        bytes: bytes !== null ? Math.max(0, Math.floor(bytes)) : null,
        url: sourceUrl,
      };
    })
    .filter((image): image is ReaderManifestImage => image !== null)
    .sort((a, b) => a.index - b.index);

  if (images.length === 0) {
    return null;
  }

  return {
    slug,
    title,
    status,
    chapterNumber: parseChapterNumber(rawChapter, chapterIndex),
    imageCount: images.length,
    images,
    releaseDate,
    releaseDateText,
    sourceUrl,
  };
}

export async function loadReaderManifest(manifestPath: string): Promise<ReaderManifestData> {
  const rawText = await readFile(manifestPath, "utf8");

  let parsed: RawManifest;
  try {
    parsed = JSON.parse(rawText) as RawManifest;
  } catch {
    throw new Error(`Invalid manifest JSON: ${manifestPath}`);
  }

  const rawChapters = Array.isArray(parsed.chapters) ? parsed.chapters : [];
  const chapters = rawChapters
    .map((chapter, chapterIndex) => {
      return normalizeManifestChapter(chapter as RawManifestChapter, chapterIndex);
    })
    .filter((chapter): chapter is ReaderManifestChapter => chapter !== null)
    .filter((chapter) => chapter.status.toLowerCase() !== "failed");

  return {
    site: asString(parsed.site) || "unknown",
    title: asString(parsed.series?.title) || "Untitled",
    updatedAt: asString(parsed.updatedAt),
    chapters,
  };
}

export function findChapterIndexBySlug(chapters: ReaderManifestChapter[], slug: string): number {
  return chapters.findIndex((chapter) => chapter.slug === slug);
}

export function findBestChapterSlugForProgress(
  chapters: ReaderManifestChapter[],
  currentChapter: number,
): string {
  if (chapters.length === 0) {
    return "";
  }

  if (!Number.isInteger(currentChapter) || currentChapter <= 0) {
    const firstReadable = chapters.find((chapter) => {
      return chapter.chapterNumber !== null && chapter.chapterNumber > 0;
    });
    return firstReadable ? firstReadable.slug : chapters[0].slug;
  }

  for (const chapter of chapters) {
    if (chapter.chapterNumber !== null && chapter.chapterNumber >= currentChapter) {
      return chapter.slug;
    }
  }

  return chapters[chapters.length - 1].slug;
}

export async function loadRipManifestProgress(manifestPath: string): Promise<RipManifestProgress | null> {
  const rawText = await readFile(manifestPath, "utf8");

  let parsed: RawManifest;
  try {
    parsed = JSON.parse(rawText) as RawManifest;
  } catch {
    return null;
  }

  const rawChapters = Array.isArray(parsed.chapters) ? parsed.chapters : [];

  let totalChapters = 0;
  let completedChapters = 0;
  let failedChapters = 0;
  let pendingChapters = 0;
  let runningChapterSlug: string | null = null;
  let runningChapterIndex: number | null = null;
  let visibleChapterIndex = 0;

  for (const chapterCandidate of rawChapters) {
    const chapter = chapterCandidate as RawManifestChapter;
    if (chapter.missingFromSource === true) {
      continue;
    }

    visibleChapterIndex += 1;
    totalChapters += 1;

    const status = (asString(chapter.status) || "pending").toLowerCase();
    if (status === "completed") {
      completedChapters += 1;
      continue;
    }

    if (status === "failed") {
      failedChapters += 1;
      continue;
    }

    pendingChapters += 1;
    if (!runningChapterSlug && status === "downloading") {
      runningChapterSlug = asString(chapter.slug);
      runningChapterIndex = visibleChapterIndex;
    }
  }

  if (totalChapters === 0) {
    return null;
  }

  return {
    totalChapters,
    completedChapters,
    failedChapters,
    pendingChapters,
    runningChapterSlug,
    runningChapterIndex,
  };
}
