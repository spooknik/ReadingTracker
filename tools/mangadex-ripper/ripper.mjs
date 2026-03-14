#!/usr/bin/env node

import { createHash } from "node:crypto";
import {
  mkdir,
  readFile,
  rename,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const TOOL_VERSION = "0.1.0";
const SITE_NAME = "mangadex";
const SITE_HOSTS = new Set(["mangadex.org", "www.mangadex.org"]);
const TITLE_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const VALID_IMAGE_EXTENSIONS = new Set([
  ".jpg",
  ".jpeg",
  ".png",
  ".webp",
  ".gif",
  ".avif",
]);

const DEFAULT_OPTIONS = {
  outputDir: path.resolve(process.cwd(), "tools/mangadex-ripper/output"),
  concurrency: 3,
  delayMs: 400,
  jitterMs: 250,
  retries: 3,
  timeoutMs: 30000,
  force: false,
  dryRun: false,
  limit: null,
  json: false,
  verbose: false,
};

const DEFAULT_HEADERS = {
  "User-Agent": `ReadingTracker-MangaDexRipper/${TOOL_VERSION}`,
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
};
const API_BASE_URL = "https://api.mangadex.org";
const DEFAULT_TRANSLATED_LANGUAGE = "en";

function printHelp() {
  const lines = [
    "MangaDex standalone ripper",
    "",
    "Usage:",
    "  node tools/mangadex-ripper/ripper.mjs discover <series-url> [options]",
    "  node tools/mangadex-ripper/ripper.mjs download <series-url> [options]",
    "  node tools/mangadex-ripper/ripper.mjs update <series-url> [options]",
    "  node tools/mangadex-ripper/ripper.mjs verify <series-url|series-dir|manifest-path> [options]",
    "",
    "Options:",
    "  --output <dir>         Output root directory",
    "  --concurrency <n>      Image download concurrency (default: 3)",
    "  --delay-ms <n>         Delay before each network request (default: 400)",
    "  --jitter-ms <n>        Random jitter added to delay (default: 250)",
    "  --retries <n>          Retry count for HTTP failures (default: 3)",
    "  --timeout-ms <n>       Per-request timeout (default: 30000)",
    "  --limit <n>            Max chapters to process for download/update",
    "  --force                Re-download chapters/images even if already completed",
    "  --dry-run              Show what would happen without downloading",
    "  --json                 JSON output for discover",
    "  --verbose              More detailed logs",
    "  --help                 Show this help",
  ];

  console.log(lines.join("\n"));
}

function parseCliArgs(argv) {
  const command = argv[2];

  if (!command || command === "--help" || command === "-h") {
    return { command: "help", target: null, options: { ...DEFAULT_OPTIONS } };
  }

  const target = argv[3] || null;
  const options = { ...DEFAULT_OPTIONS };

  let i = 4;
  while (i < argv.length) {
    const arg = argv[i];

    switch (arg) {
      case "--output":
        ensureNextArg(argv, i, arg);
        options.outputDir = path.resolve(argv[i + 1]);
        i += 2;
        break;
      case "--concurrency":
        ensureNextArg(argv, i, arg);
        options.concurrency = parsePositiveInt(argv[i + 1], arg);
        i += 2;
        break;
      case "--delay-ms":
        ensureNextArg(argv, i, arg);
        options.delayMs = parseNonNegativeInt(argv[i + 1], arg);
        i += 2;
        break;
      case "--jitter-ms":
        ensureNextArg(argv, i, arg);
        options.jitterMs = parseNonNegativeInt(argv[i + 1], arg);
        i += 2;
        break;
      case "--retries":
        ensureNextArg(argv, i, arg);
        options.retries = parseNonNegativeInt(argv[i + 1], arg);
        i += 2;
        break;
      case "--timeout-ms":
        ensureNextArg(argv, i, arg);
        options.timeoutMs = parsePositiveInt(argv[i + 1], arg);
        i += 2;
        break;
      case "--limit":
        ensureNextArg(argv, i, arg);
        options.limit = parsePositiveInt(argv[i + 1], arg);
        i += 2;
        break;
      case "--force":
        options.force = true;
        i += 1;
        break;
      case "--dry-run":
        options.dryRun = true;
        i += 1;
        break;
      case "--json":
        options.json = true;
        i += 1;
        break;
      case "--verbose":
        options.verbose = true;
        i += 1;
        break;
      case "--help":
      case "-h":
        return { command: "help", target: null, options };
      default:
        throw new Error(`Unknown option: ${arg}`);
    }
  }

  return { command, target, options };
}

function ensureNextArg(argv, index, optionName) {
  if (index + 1 >= argv.length) {
    throw new Error(`${optionName} requires a value`);
  }
}

function parsePositiveInt(value, optionName) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${optionName} must be a positive integer`);
  }
  return parsed;
}

function parseNonNegativeInt(value, optionName) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`${optionName} must be a non-negative integer`);
  }
  return parsed;
}

function isHttpUrl(value) {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function normalizeSeriesUrl(input) {
  if (!isHttpUrl(input)) {
    throw new Error(`Invalid URL: ${input}`);
  }

  const url = new URL(input);
  if (!SITE_HOSTS.has(url.hostname)) {
    throw new Error(`Unsupported host: ${url.hostname}`);
  }

  const pathParts = url.pathname.split("/").filter(Boolean);
  if (pathParts.length < 2 || pathParts[0] !== "title") {
    throw new Error("Series URL must look like https://mangadex.org/title/<title-id>/<optional-slug>");
  }

  const titleId = pathParts[1];
  if (!TITLE_ID_PATTERN.test(titleId)) {
    throw new Error("Series URL is missing a valid MangaDex title UUID");
  }

  const titleSlug = pathParts[2];
  return titleSlug
    ? `https://mangadex.org/title/${titleId}/${titleSlug}`
    : `https://mangadex.org/title/${titleId}`;
}

function extractSeriesId(seriesUrl) {
  const url = new URL(seriesUrl);
  const parts = url.pathname.split("/").filter(Boolean);
  return parts[1];
}

function extractTitleSlug(seriesUrl) {
  const url = new URL(seriesUrl);
  const parts = url.pathname.split("/").filter(Boolean);
  return parts[2] || null;
}

function extractSeriesSlug(seriesUrl) {
  return extractSeriesId(seriesUrl);
}

function sanitizePathSegment(value) {
  return value.replace(/[<>:"/\\|?*\x00-\x1f]/g, "_").trim();
}

function normalizeWhitespace(value) {
  return value.replace(/\s+/g, " ").trim();
}

function decodeHtmlEntities(value) {
  const namedMap = {
    amp: "&",
    lt: "<",
    gt: ">",
    quot: '"',
    apos: "'",
    nbsp: " ",
    raquo: "\u00bb",
  };

  return value.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (full, entity) => {
    if (entity[0] === "#") {
      const isHex = entity[1]?.toLowerCase() === "x";
      const numeric = isHex
        ? Number.parseInt(entity.slice(2), 16)
        : Number.parseInt(entity.slice(1), 10);

      if (!Number.isNaN(numeric)) {
        return String.fromCodePoint(numeric);
      }

      return full;
    }

    const lower = entity.toLowerCase();
    return namedMap[lower] ?? full;
  });
}

function asString(value) {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = normalizeWhitespace(decodeHtmlEntities(value));
  return normalized.length > 0 ? normalized : null;
}

function selectLocalizedString(localizedValue) {
  if (!localizedValue || typeof localizedValue !== "object" || Array.isArray(localizedValue)) {
    return null;
  }

  const preferredLocales = ["en", "en-us", "en-gb", "ja-ro", "ja"];
  for (const locale of preferredLocales) {
    const candidate = asString(localizedValue[locale]);
    if (candidate) {
      return candidate;
    }
  }

  for (const value of Object.values(localizedValue)) {
    const candidate = asString(value);
    if (candidate) {
      return candidate;
    }
  }

  return null;
}

function normalizeReleaseDate(isoDate) {
  if (!isoDate || typeof isoDate !== "string") {
    return null;
  }

  const parsed = Date.parse(isoDate);
  if (Number.isNaN(parsed)) {
    return null;
  }

  return new Date(parsed).toISOString().slice(0, 10);
}

function parseChapterOrder(rawChapterValue) {
  if (typeof rawChapterValue !== "string") {
    return null;
  }

  const normalized = rawChapterValue.trim();
  if (!normalized) {
    return null;
  }

  const direct = Number.parseFloat(normalized);
  if (Number.isFinite(direct)) {
    return direct;
  }

  const match = normalized.match(/(\d+(?:\.\d+)?)/);
  if (!match) {
    return null;
  }

  const parsed = Number.parseFloat(match[1]);
  return Number.isFinite(parsed) ? parsed : null;
}

function buildSeriesTitleFromMangaPayload(attributes, fallbackValue) {
  const preferredTitle = selectLocalizedString(attributes?.title);
  if (preferredTitle) {
    return preferredTitle;
  }

  if (Array.isArray(attributes?.altTitles)) {
    for (const altTitle of attributes.altTitles) {
      const candidate = selectLocalizedString(altTitle);
      if (candidate) {
        return candidate;
      }
    }
  }

  return fallbackValue;
}

function buildChapterTitle(chapterNumber, chapterTitle, fallbackChapterId) {
  if (chapterNumber && chapterTitle) {
    return `Chapter ${chapterNumber}: ${chapterTitle}`;
  }

  if (chapterNumber) {
    return `Chapter ${chapterNumber}`;
  }

  if (chapterTitle) {
    return chapterTitle;
  }

  return `Chapter ${fallbackChapterId.slice(0, 8)}`;
}

function buildChapterFromFeedEntry(entry) {
  if (!entry || typeof entry !== "object") {
    return null;
  }

  const chapterId = asString(entry.id);
  if (!chapterId || !TITLE_ID_PATTERN.test(chapterId)) {
    return null;
  }

  const attributes = entry.attributes;
  if (!attributes || typeof attributes !== "object") {
    return null;
  }

  const chapterNumber = asString(attributes.chapter);
  const chapterTitle = asString(attributes.title);
  const releaseDateText =
    asString(attributes.readableAt) ||
    asString(attributes.publishAt) ||
    asString(attributes.updatedAt) ||
    asString(attributes.createdAt);
  const externalUrl = asString(attributes.externalUrl);

  return {
    slug: `chapter-${chapterId}`,
    chapterId,
    chapterOrder: parseChapterOrder(chapterNumber),
    volume: asString(attributes.volume),
    translatedLanguage: asString(attributes.translatedLanguage),
    externalUrl,
    url: `https://mangadex.org/chapter/${chapterId}`,
    title: buildChapterTitle(chapterNumber, chapterTitle, chapterId),
    releaseDate: normalizeReleaseDate(releaseDateText),
    releaseDateText,
  };
}

function sortChaptersOldestFirst(chapters) {
  if (chapters.length < 2) {
    return chapters;
  }

  return [...chapters].sort((a, b) => {
    const orderA = Number.isFinite(a.chapterOrder) ? a.chapterOrder : null;
    const orderB = Number.isFinite(b.chapterOrder) ? b.chapterOrder : null;
    if (orderA !== null && orderB !== null && orderA !== orderB) {
      return orderA - orderB;
    }

    if (orderA !== null && orderB === null) {
      return -1;
    }

    if (orderA === null && orderB !== null) {
      return 1;
    }

    const dateA = a.releaseDate ? Date.parse(a.releaseDate) : Number.NaN;
    const dateB = b.releaseDate ? Date.parse(b.releaseDate) : Number.NaN;
    if (!Number.isNaN(dateA) && !Number.isNaN(dateB) && dateA !== dateB) {
      return dateA - dateB;
    }

    return a.slug.localeCompare(b.slug, undefined, {
      numeric: true,
      sensitivity: "base",
    });
  });
}

async function sleep(ms) {
  if (ms <= 0) {
    return;
  }

  await new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function getRandomInt(maxInclusive) {
  if (maxInclusive <= 0) {
    return 0;
  }

  return Math.floor(Math.random() * (maxInclusive + 1));
}

function createTimeoutSignal(timeoutMs) {
  if (
    typeof AbortSignal !== "undefined" &&
    typeof AbortSignal.timeout === "function" &&
    Number.isInteger(timeoutMs) &&
    timeoutMs > 0
  ) {
    return AbortSignal.timeout(timeoutMs);
  }

  return undefined;
}

class HttpClient {
  constructor(options) {
    this.options = options;
  }

  async fetchText(url, requestOptions = {}) {
    const response = await this.fetchWithRetry(url, requestOptions);
    return response.text();
  }

  async fetchJson(url, requestOptions = {}) {
    const responseText = await this.fetchText(url, {
      ...requestOptions,
      headers: {
        Accept: "application/json",
        ...(requestOptions.headers || {}),
      },
    });

    try {
      return JSON.parse(responseText);
    } catch {
      throw new Error(`Invalid JSON response for ${url}`);
    }
  }

  async fetchBuffer(url, requestOptions = {}) {
    const response = await this.fetchWithRetry(url, requestOptions);
    const buffer = Buffer.from(await response.arrayBuffer());

    return {
      buffer,
      contentType: response.headers.get("content-type") || "",
      finalUrl: response.url || url,
    };
  }

  async fetchWithRetry(url, requestOptions = {}) {
    const maxAttempts = this.options.retries + 1;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const baseDelay = this.options.delayMs;
      const jitter = getRandomInt(this.options.jitterMs);

      await sleep(baseDelay + jitter);

      const signal = createTimeoutSignal(this.options.timeoutMs);

      const headers = {
        ...DEFAULT_HEADERS,
        ...(requestOptions.headers || {}),
      };

      const fetchOptions = {
        method: requestOptions.method || "GET",
        headers,
        body: requestOptions.body,
        redirect: "follow",
        signal,
      };

      if (requestOptions.referer) {
        fetchOptions.referrer = requestOptions.referer;
      }

      let response;

      try {
        response = await fetch(url, fetchOptions);
      } catch (error) {
        if (attempt === maxAttempts) {
          throw new Error(`Request failed (${url}): ${error.message}`);
        }

        await sleep(250 * attempt + getRandomInt(250));
        continue;
      }

      if (response.ok) {
        return response;
      }

      const isRetryableStatus = [408, 425, 429, 500, 502, 503, 504].includes(response.status);
      if (!isRetryableStatus || attempt === maxAttempts) {
        throw new Error(`HTTP ${response.status} for ${url}`);
      }

      const retryAfter = Number.parseInt(response.headers.get("retry-after") || "", 10);
      if (Number.isInteger(retryAfter) && retryAfter > 0) {
        await sleep(retryAfter * 1000);
      } else {
        await sleep(350 * attempt + getRandomInt(500));
      }
    }

    throw new Error(`Unexpected retry loop exit for ${url}`);
  }
}

async function fetchMangaMetadata(client, mangaId) {
  const endpoint = `${API_BASE_URL}/manga/${mangaId}`;
  const payload = await client.fetchJson(endpoint);

  if (!payload || typeof payload !== "object") {
    throw new Error(`Manga metadata endpoint returned empty payload for ${mangaId}`);
  }

  if (payload.result !== "ok") {
    throw new Error(`Manga metadata endpoint returned non-ok result for ${mangaId}`);
  }

  if (!payload.data || typeof payload.data !== "object") {
    throw new Error(`Manga metadata endpoint missing data payload for ${mangaId}`);
  }

  return payload.data;
}

async function fetchMangaFeedPage(client, { mangaId, offset, limit }) {
  const endpoint = new URL(`${API_BASE_URL}/manga/${mangaId}/feed`);
  endpoint.searchParams.set("limit", String(limit));
  endpoint.searchParams.set("offset", String(offset));
  endpoint.searchParams.set("translatedLanguage[]", DEFAULT_TRANSLATED_LANGUAGE);
  endpoint.searchParams.set("order[chapter]", "asc");
  endpoint.searchParams.set("order[readableAt]", "asc");

  const payload = await client.fetchJson(endpoint.href);
  if (!payload || typeof payload !== "object") {
    throw new Error(`Manga feed endpoint returned empty payload at offset ${offset}`);
  }

  if (payload.result !== "ok") {
    throw new Error(`Manga feed endpoint returned non-ok result at offset ${offset}`);
  }

  if (!Array.isArray(payload.data)) {
    throw new Error(`Manga feed endpoint missing chapter array at offset ${offset}`);
  }

  return payload;
}

async function discoverChaptersViaApi(client, { mangaId, verbose }) {
  const chapters = [];
  const seenChapterIds = new Set();
  const pageSize = 500;
  let offset = 0;
  let total = null;

  for (let requestCount = 0; requestCount < 500; requestCount += 1) {
    const payload = await fetchMangaFeedPage(client, {
      mangaId,
      offset,
      limit: pageSize,
    });

    const data = payload.data;
    const payloadTotal = Number.parseInt(String(payload.total ?? ""), 10);
    if (Number.isInteger(payloadTotal) && payloadTotal >= 0) {
      total = payloadTotal;
    }

    if (verbose) {
      console.log(`Fetched MangaDex feed offset ${offset}: ${data.length} chapter(s)`);
    }

    for (const entry of data) {
      const chapter = buildChapterFromFeedEntry(entry);
      if (!chapter) {
        continue;
      }

      if (seenChapterIds.has(chapter.chapterId)) {
        continue;
      }

      chapters.push(chapter);
      seenChapterIds.add(chapter.chapterId);
    }

    if (data.length === 0) {
      break;
    }

    offset += data.length;
    if (total !== null && offset >= total) {
      break;
    }
  }

  return {
    chapters,
    total,
  };
}

async function discoverSeries(client, seriesUrl, options) {
  const normalizedSeriesUrl = normalizeSeriesUrl(seriesUrl);
  const seriesSlug = extractSeriesSlug(normalizedSeriesUrl);
  const seriesId = extractSeriesId(normalizedSeriesUrl);
  const fallbackTitle = extractTitleSlug(normalizedSeriesUrl) || seriesSlug;

  const mangaData = await fetchMangaMetadata(client, seriesId);
  const seriesTitle = buildSeriesTitleFromMangaPayload(mangaData.attributes || {}, fallbackTitle);
  const chapterDiscovery = await discoverChaptersViaApi(client, {
    mangaId: seriesId,
    verbose: options.verbose,
  });

  if (chapterDiscovery.chapters.length === 0) {
    throw new Error("No chapters found from MangaDex feed endpoint.");
  }

  const orderedChapters = sortChaptersOldestFirst(chapterDiscovery.chapters);

  return {
    seriesUrl: normalizedSeriesUrl,
    seriesSlug,
    seriesTitle,
    seriesId,
    feedTotal: chapterDiscovery.total,
    chapters: orderedChapters,
  };
}

async function fetchChapterImageUrls(client, chapterId) {
  const endpoint = `${API_BASE_URL}/at-home/server/${chapterId}`;
  const payload = await client.fetchJson(endpoint);

  if (!payload || typeof payload !== "object") {
    throw new Error(`At-home endpoint returned empty payload for chapter ${chapterId}`);
  }

  if (payload.result !== "ok") {
    throw new Error(`At-home endpoint returned non-ok result for chapter ${chapterId}`);
  }

  const baseUrl = asString(payload.baseUrl);
  const hash = asString(payload.chapter?.hash);
  const files = Array.isArray(payload.chapter?.data) ? payload.chapter.data : [];

  if (!baseUrl || !hash) {
    throw new Error(`At-home endpoint missing base URL/hash for chapter ${chapterId}`);
  }

  if (files.length === 0) {
    throw new Error(`At-home endpoint returned no image files for chapter ${chapterId}`);
  }

  const normalizedBase = baseUrl.replace(/\/+$/, "");
  const unique = [];
  const seen = new Set();

  for (const fileNameValue of files) {
    const fileName = asString(fileNameValue);
    if (!fileName) {
      continue;
    }

    const imageUrl = `${normalizedBase}/data/${hash}/${fileName}`;
    if (seen.has(imageUrl)) {
      continue;
    }

    unique.push(imageUrl);
    seen.add(imageUrl);
  }

  if (unique.length === 0) {
    throw new Error(`At-home endpoint produced no valid image URLs for chapter ${chapterId}`);
  }

  return unique;
}

function inferFileExtensionFromUrl(imageUrl) {
  const pathname = new URL(imageUrl).pathname.toLowerCase();
  const ext = path.extname(pathname);
  if (VALID_IMAGE_EXTENSIONS.has(ext)) {
    return ext;
  }
  return null;
}

function inferFileExtensionFromContentType(contentType) {
  if (!contentType) {
    return null;
  }

  const normalized = contentType.toLowerCase().split(";")[0].trim();
  const mapping = {
    "image/jpeg": ".jpg",
    "image/jpg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "image/gif": ".gif",
    "image/avif": ".avif",
  };

  return mapping[normalized] ?? null;
}

function padImageIndex(index, total) {
  const width = Math.max(3, String(total).length);
  return String(index).padStart(width, "0");
}

async function fileExistsAndHasContent(filePath) {
  try {
    const stats = await stat(filePath);
    return stats.isFile() && stats.size > 0;
  } catch {
    return false;
  }
}

function buildDefaultManifest(seriesUrl, seriesSlug, seriesTitle, seriesId) {
  const now = new Date().toISOString();
  return {
    version: 1,
    site: SITE_NAME,
    createdAt: now,
    updatedAt: now,
    series: {
      url: seriesUrl,
      slug: seriesSlug,
      title: seriesTitle,
      id: seriesId,
    },
    chapters: [],
  };
}

async function readManifest(manifestPath, defaults) {
  try {
    const raw = await readFile(manifestPath, "utf8");
    const parsed = JSON.parse(raw);

    return {
      ...defaults,
      ...parsed,
      series: {
        ...defaults.series,
        ...(parsed.series || {}),
      },
      chapters: Array.isArray(parsed.chapters) ? parsed.chapters : [],
    };
  } catch {
    return defaults;
  }
}

async function writeManifest(manifestPath, manifest) {
  manifest.updatedAt = new Date().toISOString();

  await mkdir(path.dirname(manifestPath), { recursive: true });
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
}

function mergeDiscoveredChapters(manifest, discoveredChapters) {
  const existingBySlug = new Map(
    manifest.chapters.map((chapter) => {
      return [chapter.slug, chapter];
    }),
  );

  const discoveredSlugs = new Set();
  const merged = [];

  for (const discovered of discoveredChapters) {
    discoveredSlugs.add(discovered.slug);

    const existing = existingBySlug.get(discovered.slug);
    merged.push({
      slug: discovered.slug,
      chapterId: discovered.chapterId,
      chapterOrder: discovered.chapterOrder,
      volume: discovered.volume,
      translatedLanguage: discovered.translatedLanguage,
      externalUrl: discovered.externalUrl,
      url: discovered.url,
      title: discovered.title,
      releaseDate: discovered.releaseDate,
      releaseDateText: discovered.releaseDateText,
      status: existing?.status ?? "pending",
      imageCount: existing?.imageCount ?? 0,
      downloadedAt: existing?.downloadedAt ?? null,
      images: Array.isArray(existing?.images) ? existing.images : [],
      lastError: existing?.lastError ?? null,
      missingFromSource: Boolean(discovered.externalUrl),
    });
  }

  for (const chapter of manifest.chapters) {
    if (discoveredSlugs.has(chapter.slug)) {
      continue;
    }

    merged.push({
      ...chapter,
      missingFromSource: true,
    });
  }

  return merged;
}

function getSeriesPaths(options, seriesSlug) {
  const safeSlug = sanitizePathSegment(seriesSlug);
  const seriesDir = path.join(options.outputDir, SITE_NAME, safeSlug);
  const manifestPath = path.join(seriesDir, "manifest.json");

  return {
    seriesDir,
    manifestPath,
  };
}

async function processWithConcurrency(items, concurrency, worker) {
  if (items.length === 0) {
    return [];
  }

  const results = new Array(items.length);
  const workerCount = Math.max(1, Math.min(concurrency, items.length));
  let nextIndex = 0;

  async function runWorker() {
    while (true) {
      const currentIndex = nextIndex;
      nextIndex += 1;

      if (currentIndex >= items.length) {
        return;
      }

      try {
        const value = await worker(items[currentIndex], currentIndex);
        results[currentIndex] = {
          ok: true,
          value,
        };
      } catch (error) {
        results[currentIndex] = {
          ok: false,
          error,
        };
      }
    }
  }

  await Promise.all(Array.from({ length: workerCount }, () => runWorker()));
  return results;
}

async function downloadSingleImage({
  client,
  imageUrl,
  chapterUrl,
  chapterDir,
  index,
  total,
  existingImage,
  force,
}) {
  const indexPart = padImageIndex(index, total);
  let extension = inferFileExtensionFromUrl(imageUrl) || ".bin";

  if (existingImage?.file) {
    const existingExtension = path.extname(existingImage.file).toLowerCase();
    if (VALID_IMAGE_EXTENSIONS.has(existingExtension)) {
      extension = existingExtension;
    }
  }

  let fileName = existingImage?.file || `${indexPart}${extension}`;
  let filePath = path.join(chapterDir, fileName);

  if (!force && (await fileExistsAndHasContent(filePath))) {
    const fileStats = await stat(filePath);
    return {
      index,
      url: imageUrl,
      file: fileName,
      bytes: fileStats.size,
      sha256: existingImage?.sha256 ?? null,
    };
  }

  const imageResponse = await client.fetchBuffer(imageUrl, {
    referer: chapterUrl,
    headers: {
      Referer: chapterUrl,
      Accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
    },
  });

  if (imageResponse.buffer.length === 0) {
    throw new Error(`Empty image response: ${imageUrl}`);
  }

  if (
    imageResponse.contentType &&
    !imageResponse.contentType.toLowerCase().startsWith("image/")
  ) {
    throw new Error(`Non-image response (${imageResponse.contentType}) for ${imageUrl}`);
  }

  const inferredFromContentType = inferFileExtensionFromContentType(imageResponse.contentType);
  if (
    (!VALID_IMAGE_EXTENSIONS.has(path.extname(fileName).toLowerCase()) || fileName.endsWith(".bin")) &&
    inferredFromContentType
  ) {
    fileName = `${indexPart}${inferredFromContentType}`;
    filePath = path.join(chapterDir, fileName);
  }

  const tempPath = `${filePath}.part`;
  await writeFile(tempPath, imageResponse.buffer);

  try {
    await rename(tempPath, filePath);
  } catch (error) {
    await unlink(tempPath).catch(() => {
      return undefined;
    });
    throw error;
  }

  const sha256 = createHash("sha256").update(imageResponse.buffer).digest("hex");

  return {
    index,
    url: imageResponse.finalUrl || imageUrl,
    file: fileName,
    bytes: imageResponse.buffer.length,
    sha256,
  };
}

async function downloadChapter({
  client,
  chapter,
  chapterDir,
  options,
  logger,
}) {
  await mkdir(chapterDir, { recursive: true });

  const chapterId = asString(chapter.chapterId);
  if (!chapterId) {
    throw new Error(`Missing chapterId for ${chapter.slug}`);
  }

  if (chapter.externalUrl) {
    throw new Error(`Chapter is externally hosted and cannot be downloaded: ${chapter.externalUrl}`);
  }

  const imageUrls = await fetchChapterImageUrls(client, chapterId);
  if (imageUrls.length === 0) {
    throw new Error(`No images found for ${chapter.url}`);
  }

  const existingByIndex = new Map(
    (chapter.images || []).map((image) => {
      return [image.index, image];
    }),
  );

  logger(
    `  ${chapter.slug}: ${imageUrls.length} images (concurrency=${options.concurrency}, force=${options.force})`,
  );

  const jobs = imageUrls.map((imageUrl, index) => {
    return {
      index: index + 1,
      imageUrl,
      existingImage: existingByIndex.get(index + 1) || null,
    };
  });

  const results = await processWithConcurrency(jobs, options.concurrency, async (job) => {
    return downloadSingleImage({
      client,
      imageUrl: job.imageUrl,
      chapterUrl: chapter.url,
      chapterDir,
      index: job.index,
      total: imageUrls.length,
      existingImage: job.existingImage,
      force: options.force,
    });
  });

  const failed = results.filter((result) => !result.ok);
  if (failed.length > 0) {
    const firstError = failed[0].error;
    throw new Error(
      `Failed ${failed.length}/${results.length} image downloads for ${chapter.slug}: ${firstError.message}`,
    );
  }

  const images = results
    .map((result) => result.value)
    .sort((a, b) => a.index - b.index);

  return {
    imageCount: images.length,
    images,
  };
}

function getChaptersToProcess(chapters, options) {
  const eligible = chapters.filter((chapter) => {
    if (chapter.missingFromSource) {
      return false;
    }

    if (options.force) {
      return true;
    }

    return chapter.status !== "completed";
  });

  if (options.limit && eligible.length > options.limit) {
    return eligible.slice(0, options.limit);
  }

  return eligible;
}

function getManifestProgressStats(chapters) {
  const discovered = chapters.filter((chapter) => !chapter.missingFromSource);
  const discoveredCount = discovered.length;
  const completedCount = discovered.filter((chapter) => chapter.status === "completed").length;
  const failedCount = discovered.filter((chapter) => chapter.status === "failed").length;

  return {
    discoveredCount,
    completedCount,
    failedCount,
  };
}

async function runDiscover(client, target, options) {
  const discovery = await discoverSeries(client, target, options);
  const paths = getSeriesPaths(options, discovery.seriesSlug);
  const defaults = buildDefaultManifest(
    discovery.seriesUrl,
    discovery.seriesSlug,
    discovery.seriesTitle,
    discovery.seriesId,
  );

  const manifest = await readManifest(paths.manifestPath, defaults);
  manifest.site = SITE_NAME;
  manifest.series = {
    url: discovery.seriesUrl,
    slug: discovery.seriesSlug,
    title: discovery.seriesTitle,
    id: discovery.seriesId,
  };
  manifest.chapters = mergeDiscoveredChapters(manifest, discovery.chapters);

  await writeManifest(paths.manifestPath, manifest);

  const output = {
    series: manifest.series,
    chapterCount: discovery.chapters.length,
    feedTotal: discovery.feedTotal,
    manifestPath: paths.manifestPath,
  };

  if (options.json) {
    console.log(JSON.stringify(output, null, 2));
    return;
  }

  console.log(`Discovered ${output.chapterCount} chapters for ${output.series.title}.`);
  if (Number.isInteger(output.feedTotal)) {
    console.log(`MangaDex feed total: ${output.feedTotal}`);
  }
  console.log(`Manifest saved: ${output.manifestPath}`);
}

async function runDownloadOrUpdate(client, target, options) {
  const discovery = await discoverSeries(client, target, options);
  const paths = getSeriesPaths(options, discovery.seriesSlug);
  const defaults = buildDefaultManifest(
    discovery.seriesUrl,
    discovery.seriesSlug,
    discovery.seriesTitle,
    discovery.seriesId,
  );

  const manifest = await readManifest(paths.manifestPath, defaults);
  manifest.site = SITE_NAME;
  manifest.series = {
    url: discovery.seriesUrl,
    slug: discovery.seriesSlug,
    title: discovery.seriesTitle,
    id: discovery.seriesId,
  };
  manifest.chapters = mergeDiscoveredChapters(manifest, discovery.chapters);

  await writeManifest(paths.manifestPath, manifest);

  const preRunStats = getManifestProgressStats(manifest.chapters);
  const chaptersToProcess = getChaptersToProcess(manifest.chapters, options);

  console.log(
    `Discovered ${preRunStats.discoveredCount} chapter(s) for ${manifest.series.title}.`,
  );

  if (options.force) {
    console.log(`Force mode enabled: reprocessing ${chaptersToProcess.length} chapter(s).`);
  } else {
    console.log(
      `${preRunStats.completedCount} already completed, ${chaptersToProcess.length} pending.`,
    );
  }

  if (preRunStats.failedCount > 0 && !options.force) {
    console.log(`Including ${preRunStats.failedCount} previously failed chapter(s) for retry.`);
  }

  if (chaptersToProcess.length === 0) {
    console.log("Nothing to download. All discovered chapters are already completed.");
    console.log(`Manifest: ${paths.manifestPath}`);
    return;
  }

  console.log(`Processing ${chaptersToProcess.length} pending chapter(s) into ${paths.seriesDir}`);

  if (options.dryRun) {
    for (const chapter of chaptersToProcess) {
      console.log(`- ${chapter.slug} (${chapter.url})`);
    }

    console.log("Dry run complete. No files were downloaded.");
    return;
  }

  let completed = 0;
  let failed = 0;

  for (const chapter of chaptersToProcess) {
    const chapterDir = path.join(paths.seriesDir, sanitizePathSegment(chapter.slug));

    chapter.status = "downloading";
    chapter.lastError = null;
    await writeManifest(paths.manifestPath, manifest);

    try {
      const downloaded = await downloadChapter({
        client,
        chapter,
        chapterDir,
        options,
        logger: (message) => {
          if (options.verbose) {
            console.log(message);
          }
        },
      });

      chapter.status = "completed";
      chapter.imageCount = downloaded.imageCount;
      chapter.images = downloaded.images;
      chapter.downloadedAt = new Date().toISOString();
      chapter.lastError = null;
      completed += 1;

      console.log(`Downloaded ${chapter.slug} (${downloaded.imageCount} images)`);
    } catch (error) {
      chapter.status = "failed";
      chapter.lastError = error.message;
      failed += 1;

      console.error(`Failed ${chapter.slug}: ${error.message}`);
    }

    await writeManifest(paths.manifestPath, manifest);
  }

  const postRunStats = getManifestProgressStats(manifest.chapters);

  console.log(
    `Done. Completed this run: ${completed}, Failed this run: ${failed}, Total completed: ${postRunStats.completedCount}/${postRunStats.discoveredCount}, Manifest: ${paths.manifestPath}`,
  );
}

function resolveVerifyManifestPath(target, options) {
  if (target.endsWith(".json")) {
    return path.resolve(target);
  }

  if (isHttpUrl(target)) {
    const seriesUrl = normalizeSeriesUrl(target);
    const seriesSlug = extractSeriesSlug(seriesUrl);
    return path.join(options.outputDir, SITE_NAME, sanitizePathSegment(seriesSlug), "manifest.json");
  }

  return path.join(path.resolve(target), "manifest.json");
}

async function runVerify(target, options) {
  const manifestPath = resolveVerifyManifestPath(target, options);
  const raw = await readFile(manifestPath, "utf8");
  const manifest = JSON.parse(raw);

  if (!Array.isArray(manifest.chapters)) {
    throw new Error(`Invalid manifest format: ${manifestPath}`);
  }

  const seriesDir = path.dirname(manifestPath);
  let verifiedChapters = 0;
  let failedChapters = 0;
  let missingFiles = 0;

  for (const chapter of manifest.chapters) {
    if (!Array.isArray(chapter.images) || chapter.images.length === 0) {
      continue;
    }

    const chapterDir = path.join(seriesDir, sanitizePathSegment(chapter.slug));
    let chapterMissing = 0;

    for (const image of chapter.images) {
      const filePath = path.join(chapterDir, image.file);
      const ok = await fileExistsAndHasContent(filePath);
      if (!ok) {
        chapterMissing += 1;
      }
    }

    if (chapterMissing === 0) {
      chapter.status = "completed";
      chapter.lastError = null;
      verifiedChapters += 1;
    } else {
      chapter.status = "failed";
      chapter.lastError = `${chapterMissing} missing image file(s)`;
      failedChapters += 1;
      missingFiles += chapterMissing;
    }
  }

  manifest.updatedAt = new Date().toISOString();
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

  console.log(`Verified chapters: ${verifiedChapters}`);
  console.log(`Failed chapters: ${failedChapters}`);
  console.log(`Missing files: ${missingFiles}`);
  console.log(`Manifest updated: ${manifestPath}`);
}

async function main() {
  const { command, target, options } = parseCliArgs(process.argv);

  if (command === "help") {
    printHelp();
    return;
  }

  if (!target) {
    throw new Error("Missing target. Use --help for usage.");
  }

  const client = new HttpClient(options);

  switch (command) {
    case "discover":
      await runDiscover(client, target, options);
      return;
    case "download":
      await runDownloadOrUpdate(client, target, options);
      return;
    case "update":
      await runDownloadOrUpdate(client, target, options);
      return;
    case "verify":
      await runVerify(target, options);
      return;
    default:
      throw new Error(`Unknown command: ${command}`);
  }
}

main().catch((error) => {
  console.error(`Error: ${error.message}`);
  process.exitCode = 1;
});
