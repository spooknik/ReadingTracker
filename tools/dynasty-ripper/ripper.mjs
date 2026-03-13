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
const SITE_NAME = "dynasty-scans";
const SITE_HOSTS = new Set(["dynasty-scans.com", "www.dynasty-scans.com"]);
const VALID_IMAGE_EXTENSIONS = new Set([
  ".jpg",
  ".jpeg",
  ".png",
  ".webp",
  ".gif",
  ".avif",
]);

const DEFAULT_OPTIONS = {
  outputDir: path.resolve(process.cwd(), "tools/dynasty-ripper/output"),
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
  "User-Agent": `ReadingTracker-DynastyRipper/${TOOL_VERSION}`,
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
};

function printHelp() {
  const lines = [
    "Dynasty Scans standalone ripper",
    "",
    "Usage:",
    "  node tools/dynasty-ripper/ripper.mjs discover <series-url> [options]",
    "  node tools/dynasty-ripper/ripper.mjs download <series-url> [options]",
    "  node tools/dynasty-ripper/ripper.mjs update <series-url> [options]",
    "  node tools/dynasty-ripper/ripper.mjs verify <series-url|series-dir|manifest-path> [options]",
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
  if (pathParts.length < 2 || pathParts[0] !== "series") {
    throw new Error("Series URL must look like https://dynasty-scans.com/series/<slug>");
  }

  const seriesSlug = pathParts[1];
  return `https://dynasty-scans.com/series/${seriesSlug}`;
}

function extractSeriesSlug(seriesUrl) {
  const url = new URL(seriesUrl);
  const parts = url.pathname.split("/").filter(Boolean);
  return parts[1];
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

function stripTags(value) {
  return normalizeWhitespace(decodeHtmlEntities(value.replace(/<[^>]*>/g, " ")));
}

function extractMetaContent(html, metaSelector) {
  const regex = new RegExp(`<meta\\s+${metaSelector}\\s+content=["']([^"']+)["']`, "i");
  const match = html.match(regex);
  return match ? decodeHtmlEntities(match[1]) : null;
}

function extractSeriesTitle(seriesHtml, fallbackSlug) {
  const headingMatch = seriesHtml.match(
    /<h2[^>]*class=["'][^"']*\btag-title\b[^"']*["'][^>]*>[\s\S]*?<b>([\s\S]*?)<\/b>/i,
  );

  if (headingMatch) {
    const title = stripTags(headingMatch[1]);
    if (title) {
      return title;
    }
  }

  const ogTitle = extractMetaContent(seriesHtml, "property=[\"']og:title[\"']");
  if (ogTitle) {
    return ogTitle.replace(/^Dynasty Reader\s*(?:\u00bb|>)\s*/i, "").trim();
  }

  const titleMatch = seriesHtml.match(/<title>([^<]+)<\/title>/i);
  if (titleMatch) {
    const title = decodeHtmlEntities(titleMatch[1])
      .replace(/^Dynasty Reader\s*(?:\u00bb|>)\s*/i, "")
      .trim();

    if (title) {
      return title;
    }
  }

  return fallbackSlug;
}

function toAbsoluteUrl(value, baseUrl) {
  return new URL(decodeHtmlEntities(value), baseUrl).href;
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function extractAttribute(tag, attributeName) {
  const escaped = escapeRegex(attributeName);
  const regex = new RegExp(`${escaped}\\s*=\\s*(?:\"([^\"]+)\"|'([^']+)'|([^\\s>]+))`, "i");
  const match = tag.match(regex);
  if (!match) {
    return null;
  }

  return decodeHtmlEntities(match[1] ?? match[2] ?? match[3] ?? "");
}

function isLikelyImageUrl(url) {
  const lower = url.toLowerCase();
  return (
    lower.endsWith(".jpg") ||
    lower.endsWith(".jpeg") ||
    lower.endsWith(".png") ||
    lower.endsWith(".webp") ||
    lower.endsWith(".gif") ||
    lower.endsWith(".avif") ||
    /\.(jpg|jpeg|png|webp|gif|avif)\?/.test(lower)
  );
}

function extractChapterSlugFromUrl(chapterUrl) {
  const parsed = new URL(chapterUrl);
  const parts = parsed.pathname.split("/").filter(Boolean);

  if (parts[0] !== "chapters") {
    return null;
  }

  return parts[1] ?? null;
}

function extractChapterLinkFromBlock(blockHtml) {
  const anchorRegex = /<a\b[^>]*>[\s\S]*?<\/a>/gi;
  let anchorMatch;

  while ((anchorMatch = anchorRegex.exec(blockHtml)) !== null) {
    const anchorHtml = anchorMatch[0];
    const className = extractAttribute(anchorHtml, "class") || "";
    if (!/\bname\b/i.test(className)) {
      continue;
    }

    const href = extractAttribute(anchorHtml, "href");
    if (!href) {
      continue;
    }

    const title = stripTags(anchorHtml);
    return {
      href,
      title,
    };
  }

  return null;
}

function normalizeDate(rawDateText) {
  if (!rawDateText) {
    return null;
  }

  const normalized = normalizeWhitespace(rawDateText);
  const match = normalized.match(/^([A-Za-z]+)\s+(\d{1,2})\s+'(\d{2,4})$/);
  if (!match) {
    return null;
  }

  const monthName = match[1].toLowerCase();
  const day = Number.parseInt(match[2], 10);
  const yearRaw = match[3];
  let year = Number.parseInt(yearRaw, 10);

  if (yearRaw.length === 2) {
    year += year >= 70 ? 1900 : 2000;
  }

  const monthLookup = {
    jan: 1,
    january: 1,
    feb: 2,
    february: 2,
    mar: 3,
    march: 3,
    apr: 4,
    april: 4,
    may: 5,
    jun: 6,
    june: 6,
    jul: 7,
    july: 7,
    aug: 8,
    august: 8,
    sep: 9,
    sept: 9,
    september: 9,
    oct: 10,
    october: 10,
    nov: 11,
    november: 11,
    dec: 12,
    december: 12,
  };

  const month = monthLookup[monthName];
  if (!month || day < 1 || day > 31 || year < 1900) {
    return null;
  }

  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function extractChaptersFromSeriesHtml(seriesHtml, seriesUrl) {
  const chapters = [];
  const seen = new Set();

  const chapterListMatch = seriesHtml.match(
    /<dl[^>]*class=["'][^"']*\bchapter-list\b[^"']*["'][^>]*>([\s\S]*?)<\/dl>/i,
  );
  const chapterListHtml = chapterListMatch ? chapterListMatch[1] : seriesHtml;
  const ddRegex = /<dd\b[^>]*>([\s\S]*?)<\/dd>/gi;
  let ddMatch;

  while ((ddMatch = ddRegex.exec(chapterListHtml)) !== null) {
    const block = ddMatch[1];
    const chapterLink = extractChapterLinkFromBlock(block);
    if (!chapterLink) {
      continue;
    }

    const chapterUrl = toAbsoluteUrl(chapterLink.href, seriesUrl);
    const chapterSlug = extractChapterSlugFromUrl(chapterUrl);
    if (!chapterSlug || seen.has(chapterSlug)) {
      continue;
    }

    const smallMatch = block.match(/<small[^>]*>\s*released\s+([\s\S]*?)<\/small>/i);
    const dateText = smallMatch ? stripTags(smallMatch[1]) : null;

    chapters.push({
      slug: chapterSlug,
      url: chapterUrl,
      title: chapterLink.title || chapterSlug,
      releaseDateText: dateText,
      releaseDate: normalizeDate(dateText),
    });

    seen.add(chapterSlug);
  }

  return chapters;
}

function parseChapterNumber(chapterSlug) {
  const match = chapterSlug.match(/_ch(\d+)(?:_(\d+))?$/i);
  if (!match) {
    return null;
  }

  const major = Number.parseInt(match[1], 10);
  if (Number.isNaN(major)) {
    return null;
  }

  const minorPart = match[2];
  if (!minorPart) {
    return major;
  }

  const minor = Number.parseInt(minorPart, 10);
  if (Number.isNaN(minor)) {
    return major;
  }

  return major + minor / (10 ** minorPart.length);
}

function sortChaptersOldestFirst(chapters) {
  if (chapters.length < 2) {
    return chapters;
  }

  const firstNumber = parseChapterNumber(chapters[0].slug);
  const lastNumber = parseChapterNumber(chapters[chapters.length - 1].slug);
  if (firstNumber !== null && lastNumber !== null && firstNumber > lastNumber) {
    return [...chapters].reverse();
  }

  const firstDate = chapters[0].releaseDate ? Date.parse(chapters[0].releaseDate) : Number.NaN;
  const lastDate = chapters[chapters.length - 1].releaseDate
    ? Date.parse(chapters[chapters.length - 1].releaseDate)
    : Number.NaN;

  if (!Number.isNaN(firstDate) && !Number.isNaN(lastDate) && firstDate > lastDate) {
    return [...chapters].reverse();
  }

  return chapters;
}

function extractImageUrlsFromHtmlBlock(htmlBlock, baseUrl) {
  const imgTagRegex = /<img\b[^>]*>/gi;
  const urls = [];
  const seen = new Set();
  let imgMatch;

  while ((imgMatch = imgTagRegex.exec(htmlBlock)) !== null) {
    const imgTag = imgMatch[0];
    const src =
      extractAttribute(imgTag, "src") ||
      extractAttribute(imgTag, "data-src") ||
      extractAttribute(imgTag, "data-lazy-src") ||
      extractAttribute(imgTag, "data-original");

    if (!src || src.startsWith("data:")) {
      continue;
    }

    const absoluteUrl = toAbsoluteUrl(src, baseUrl);
    if (!isHttpUrl(absoluteUrl)) {
      continue;
    }

    if (!isLikelyImageUrl(absoluteUrl)) {
      continue;
    }

    if (seen.has(absoluteUrl)) {
      continue;
    }

    urls.push(absoluteUrl);
    seen.add(absoluteUrl);
  }

  return urls;
}

function extractImageUrlsFromPagesVariable(chapterHtml, chapterUrl) {
  const pagesMatch = chapterHtml.match(/var\s+pages\s*=\s*(\[[\s\S]*?\]);/i);
  if (!pagesMatch) {
    return [];
  }

  let pages;
  try {
    pages = JSON.parse(pagesMatch[1]);
  } catch {
    return [];
  }

  if (!Array.isArray(pages)) {
    return [];
  }

  const urls = [];
  const seen = new Set();

  for (const page of pages) {
    if (!page || typeof page.image !== "string" || page.image.length === 0) {
      continue;
    }

    const absoluteUrl = toAbsoluteUrl(page.image, chapterUrl);
    if (!isHttpUrl(absoluteUrl) || !isLikelyImageUrl(absoluteUrl)) {
      continue;
    }

    if (seen.has(absoluteUrl)) {
      continue;
    }

    urls.push(absoluteUrl);
    seen.add(absoluteUrl);
  }

  return urls;
}

function extractImageUrlsFromReleaseLinks(chapterHtml, chapterUrl) {
  const urls = [];
  const seen = new Set();
  const releaseRegex = /["']((?:https?:\/\/[^"']+)?\/system\/releases\/[^"'<>]+?\.(?:jpg|jpeg|png|webp|gif|avif)(?:\?[^"'<>]*)?)["']/gi;
  let releaseMatch;

  while ((releaseMatch = releaseRegex.exec(chapterHtml)) !== null) {
    const absoluteUrl = toAbsoluteUrl(releaseMatch[1], chapterUrl);
    if (!isHttpUrl(absoluteUrl) || !isLikelyImageUrl(absoluteUrl)) {
      continue;
    }

    if (seen.has(absoluteUrl)) {
      continue;
    }

    urls.push(absoluteUrl);
    seen.add(absoluteUrl);
  }

  return urls;
}

function extractImageUrlsFromChapterHtml(chapterHtml, chapterUrl) {
  const fromPages = extractImageUrlsFromPagesVariable(chapterHtml, chapterUrl);
  if (fromPages.length > 0) {
    return fromPages;
  }

  const fromReleaseLinks = extractImageUrlsFromReleaseLinks(chapterHtml, chapterUrl);
  if (fromReleaseLinks.length > 0) {
    return fromReleaseLinks;
  }

  return extractImageUrlsFromHtmlBlock(chapterHtml, chapterUrl);
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

function buildDefaultManifest(seriesUrl, seriesSlug, seriesTitle) {
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
      url: discovered.url,
      title: discovered.title,
      releaseDate: discovered.releaseDate,
      releaseDateText: discovered.releaseDateText,
      status: existing?.status ?? "pending",
      imageCount: existing?.imageCount ?? 0,
      downloadedAt: existing?.downloadedAt ?? null,
      images: Array.isArray(existing?.images) ? existing.images : [],
      lastError: existing?.lastError ?? null,
      missingFromSource: false,
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

async function discoverSeries(client, seriesUrl) {
  const normalizedSeriesUrl = normalizeSeriesUrl(seriesUrl);
  const seriesSlug = extractSeriesSlug(normalizedSeriesUrl);

  const seriesHtml = await client.fetchText(normalizedSeriesUrl, {
    referer: normalizedSeriesUrl,
  });

  const seriesTitle = extractSeriesTitle(seriesHtml, seriesSlug);
  const chapters = extractChaptersFromSeriesHtml(seriesHtml, normalizedSeriesUrl);

  if (chapters.length === 0) {
    throw new Error("No chapters found. The site may have changed markup.");
  }

  const orderedChapters = sortChaptersOldestFirst(chapters);

  return {
    seriesUrl: normalizedSeriesUrl,
    seriesSlug,
    seriesTitle,
    chapters: orderedChapters,
  };
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
  seriesUrl,
  options,
  logger,
}) {
  await mkdir(chapterDir, { recursive: true });

  const chapterHtml = await client.fetchText(chapter.url, {
    referer: seriesUrl,
  });

  const imageUrls = extractImageUrlsFromChapterHtml(chapterHtml, chapter.url);
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
  const discovery = await discoverSeries(client, target);
  const paths = getSeriesPaths(options, discovery.seriesSlug);
  const defaults = buildDefaultManifest(
    discovery.seriesUrl,
    discovery.seriesSlug,
    discovery.seriesTitle,
  );

  const manifest = await readManifest(paths.manifestPath, defaults);
  manifest.site = SITE_NAME;
  manifest.series = {
    url: discovery.seriesUrl,
    slug: discovery.seriesSlug,
    title: discovery.seriesTitle,
  };
  manifest.chapters = mergeDiscoveredChapters(manifest, discovery.chapters);

  await writeManifest(paths.manifestPath, manifest);

  const output = {
    series: manifest.series,
    chapterCount: discovery.chapters.length,
    manifestPath: paths.manifestPath,
  };

  if (options.json) {
    console.log(JSON.stringify(output, null, 2));
    return;
  }

  console.log(`Discovered ${output.chapterCount} chapters for ${output.series.title}.`);
  console.log(`Manifest saved: ${output.manifestPath}`);
}

async function runDownloadOrUpdate(client, target, options) {
  const discovery = await discoverSeries(client, target);
  const paths = getSeriesPaths(options, discovery.seriesSlug);
  const defaults = buildDefaultManifest(
    discovery.seriesUrl,
    discovery.seriesSlug,
    discovery.seriesTitle,
  );

  const manifest = await readManifest(paths.manifestPath, defaults);
  manifest.site = SITE_NAME;
  manifest.series = {
    url: discovery.seriesUrl,
    slug: discovery.seriesSlug,
    title: discovery.seriesTitle,
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
        seriesUrl: manifest.series.url,
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
