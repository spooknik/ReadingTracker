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
const SITE_NAME = "mangabuddy";
const SITE_HOSTS = new Set([
  "mangabuddy.com",
  "www.mangabuddy.com",
  "m.mangabuddy.com",
]);
const VALID_IMAGE_EXTENSIONS = new Set([
  ".jpg",
  ".jpeg",
  ".png",
  ".webp",
  ".gif",
  ".avif",
]);

const DEFAULT_OPTIONS = {
  outputDir: path.resolve(process.cwd(), "tools/mangabuddy-ripper/output"),
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
  "User-Agent": `ReadingTracker-MangaBuddyRipper/${TOOL_VERSION}`,
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
};

function printHelp() {
  const lines = [
    "MangaBuddy standalone ripper",
    "",
    "Usage:",
    "  node tools/mangabuddy-ripper/ripper.mjs discover <series-url> [options]",
    "  node tools/mangabuddy-ripper/ripper.mjs download <series-url> [options]",
    "  node tools/mangabuddy-ripper/ripper.mjs update <series-url> [options]",
    "  node tools/mangabuddy-ripper/ripper.mjs verify <series-url|series-dir|manifest-path> [options]",
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
  if (pathParts.length === 0) {
    throw new Error("Series URL must look like https://mangabuddy.com/<slug>");
  }

  let seriesSlug;
  if (pathParts[0] === "manga" && pathParts.length >= 2) {
    seriesSlug = pathParts[1];
  } else {
    seriesSlug = pathParts[0];
  }

  if (!seriesSlug) {
    throw new Error("Could not resolve series slug from URL.");
  }

  return `https://mangabuddy.com/${seriesSlug}`;
}

function extractSeriesSlug(seriesUrl) {
  const url = new URL(seriesUrl);
  const parts = url.pathname.split("/").filter(Boolean);
  return parts[0];
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

function normalizeMangaBuddySeriesTitle(raw) {
  if (!raw) {
    return null;
  }

  const normalized = normalizeWhitespace(decodeHtmlEntities(raw));
  return normalized
    .replace(/^Read\s+/i, "")
    .replace(/\s*[-|]\s*MangaBuddy.*$/i, "")
    .trim();
}

function extractSeriesTitle(seriesHtml, fallbackSlug) {
  const pageTitleMatch = seriesHtml.match(/var\s+pageTitle\s*=\s*(["'])([\s\S]*?)\1\s*;/i);
  if (pageTitleMatch) {
    const pageTitle = normalizeWhitespace(decodeHtmlEntities(pageTitleMatch[2]));
    if (pageTitle) {
      return pageTitle;
    }
  }

  const ogTitle = extractMetaContent(seriesHtml, "property=[\"']og:title[\"']");
  const normalizedOgTitle = normalizeMangaBuddySeriesTitle(ogTitle);
  if (normalizedOgTitle) {
    return normalizedOgTitle;
  }

  const titleMatch = seriesHtml.match(/<title>([^<]+)<\/title>/i);
  if (titleMatch) {
    const normalizedTitleTag = normalizeMangaBuddySeriesTitle(titleMatch[1]);
    if (normalizedTitleTag) {
      return normalizedTitleTag;
    }
  }

  const headingMatch = seriesHtml.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  if (headingMatch) {
    const heading = stripTags(headingMatch[1]);
    if (heading) {
      return heading;
    }
  }

  return fallbackSlug;
}

function extractExpectedChapterCount(seriesHtml) {
  const chaptersCountMatch = seriesHtml.match(/CHAPTERS\s*\(([\d,]+)\)/i);
  if (chaptersCountMatch) {
    const parsed = Number.parseInt(chaptersCountMatch[1].replace(/,/g, ""), 10);
    if (Number.isInteger(parsed) && parsed >= 0) {
      return parsed;
    }
  }

  const infoCountMatch = seriesHtml.match(/Chapters:\s*<[^>]*>\s*([\d,]+)\s*</i);
  if (infoCountMatch) {
    const parsed = Number.parseInt(infoCountMatch[1].replace(/,/g, ""), 10);
    if (Number.isInteger(parsed) && parsed >= 0) {
      return parsed;
    }
  }

  return null;
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

function extractQuotedJsVarValue(source, variableName) {
  const variableRegex = new RegExp(`\\bvar\\s+${escapeRegex(variableName)}\\s*=\\s*`, "i");
  const match = variableRegex.exec(source);
  if (!match || match.index === undefined) {
    return null;
  }

  let cursor = match.index + match[0].length;
  while (cursor < source.length && /\s/.test(source[cursor])) {
    cursor += 1;
  }

  const quote = source[cursor];
  if (quote !== '"' && quote !== "'") {
    return null;
  }

  const valueStart = cursor + 1;
  let escaped = false;

  for (let i = valueStart; i < source.length; i += 1) {
    const char = source[i];

    if (escaped) {
      escaped = false;
      continue;
    }

    if (char === "\\") {
      escaped = true;
      continue;
    }

    if (char === quote) {
      return source.slice(valueStart, i);
    }
  }

  return null;
}

function normalizeDate(rawDateText) {
  if (!rawDateText) {
    return null;
  }

  const normalized = normalizeWhitespace(rawDateText);

  if (/^today$/i.test(normalized)) {
    const now = new Date();
    return `${String(now.getUTCFullYear()).padStart(4, "0")}-${String(now.getUTCMonth() + 1).padStart(2, "0")}-${String(now.getUTCDate()).padStart(2, "0")}`;
  }

  if (/^yesterday$/i.test(normalized)) {
    const now = new Date();
    now.setUTCDate(now.getUTCDate() - 1);
    return `${String(now.getUTCFullYear()).padStart(4, "0")}-${String(now.getUTCMonth() + 1).padStart(2, "0")}-${String(now.getUTCDate()).padStart(2, "0")}`;
  }

  const absoluteMatch = normalized.match(/^([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})$/);
  if (absoluteMatch) {
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

    const month = monthLookup[absoluteMatch[1].toLowerCase()];
    const day = Number.parseInt(absoluteMatch[2], 10);
    const year = Number.parseInt(absoluteMatch[3], 10);

    if (month && day >= 1 && day <= 31 && year >= 1900) {
      return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    }
  }

  const relativeMatch = normalized.match(/^([0-9]+)\s+(minute|hour|day|week|month|year)s?\s+ago$/i);
  if (relativeMatch) {
    const amount = Number.parseInt(relativeMatch[1], 10);
    const unit = relativeMatch[2].toLowerCase();
    if (Number.isInteger(amount) && amount >= 0) {
      const date = new Date();

      if (unit === "minute") {
        date.setUTCMinutes(date.getUTCMinutes() - amount);
      } else if (unit === "hour") {
        date.setUTCHours(date.getUTCHours() - amount);
      } else if (unit === "day") {
        date.setUTCDate(date.getUTCDate() - amount);
      } else if (unit === "week") {
        date.setUTCDate(date.getUTCDate() - amount * 7);
      } else if (unit === "month") {
        date.setUTCMonth(date.getUTCMonth() - amount);
      } else if (unit === "year") {
        date.setUTCFullYear(date.getUTCFullYear() - amount);
      }

      return `${String(date.getUTCFullYear()).padStart(4, "0")}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
    }
  }

  return null;
}

function parseChapterOrder(chapterSlug, chapterTitle) {
  if (/^notice$/i.test(chapterSlug) || /^notice\.?$/i.test(chapterTitle)) {
    return 0;
  }

  const slugMatch = chapterSlug.match(/^chapter-(\d+)(?:-(\d+))?$/i);
  if (slugMatch) {
    const major = Number.parseInt(slugMatch[1], 10);
    if (!Number.isNaN(major)) {
      const minorText = slugMatch[2];
      if (!minorText) {
        return major;
      }

      const minor = Number.parseInt(minorText, 10);
      if (!Number.isNaN(minor)) {
        return major + minor / (10 ** minorText.length);
      }

      return major;
    }
  }

  const titleMatch = chapterTitle.match(/^chapter\s*(\d+)(?:\.(\d+))?/i);
  if (titleMatch) {
    const major = Number.parseInt(titleMatch[1], 10);
    if (!Number.isNaN(major)) {
      const minorText = titleMatch[2];
      if (!minorText) {
        return major;
      }

      const minor = Number.parseInt(minorText, 10);
      if (!Number.isNaN(minor)) {
        return major + minor / (10 ** minorText.length);
      }

      return major;
    }
  }

  return null;
}

function extractChapterSlugFromUrl(chapterUrl, seriesSlug) {
  const parsed = new URL(chapterUrl);
  const parts = parsed.pathname.split("/").filter(Boolean);

  if (parts.length >= 3 && parts[0] === "manga" && parts[1] === seriesSlug) {
    return parts[2];
  }

  if (parts.length >= 2 && parts[0] === seriesSlug) {
    return parts[1];
  }

  return null;
}

function extractChaptersFromSeriesHtml(seriesHtml, seriesUrl) {
  const seriesSlug = extractSeriesSlug(seriesUrl);
  const chapters = [];
  const seen = new Set();

  const chapterListMatch = seriesHtml.match(
    /<ul[^>]*id=["'][^"']*chapter-list[^"']*["'][^>]*>([\s\S]*?)<\/ul>/i,
  );
  const chapterListHtml = chapterListMatch ? chapterListMatch[1] : seriesHtml;
  const liRegex = /<li\b[^>]*>([\s\S]*?)<\/li>/gi;
  let liMatch;

  while ((liMatch = liRegex.exec(chapterListHtml)) !== null) {
    const liHtml = liMatch[1];
    const anchorMatch = liHtml.match(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/i);
    if (!anchorMatch) {
      continue;
    }

    const chapterUrl = toAbsoluteUrl(anchorMatch[1], seriesUrl);
    const chapterSlug = extractChapterSlugFromUrl(chapterUrl, seriesSlug);
    if (!chapterSlug || seen.has(chapterSlug)) {
      continue;
    }

    const titleMatch = liHtml.match(
      /<strong[^>]*class=["'][^"']*\bchapter-title\b[^"']*["'][^>]*>([\s\S]*?)<\/strong>/i,
    );
    const chapterTitle = titleMatch ? stripTags(titleMatch[1]) : stripTags(anchorMatch[2]);

    const updateMatch = liHtml.match(
      /<time[^>]*class=["'][^"']*\bchapter-update\b[^"']*["'][^>]*>([\s\S]*?)<\/time>/i,
    );
    const dateText = updateMatch ? stripTags(updateMatch[1]) : null;

    chapters.push({
      slug: chapterSlug,
      chapterOrder: parseChapterOrder(chapterSlug, chapterTitle),
      url: chapterUrl,
      title: chapterTitle || chapterSlug,
      releaseDateText: dateText,
      releaseDate: normalizeDate(dateText),
    });

    seen.add(chapterSlug);
  }

  if (chapters.length > 0) {
    return chapters;
  }

  const fallbackAnchorRegex = new RegExp(
    `<a[^>]*href=["'](/${escapeRegex(seriesSlug)}/[^"']+)["'][^>]*>([\\s\\S]*?)<\\/a>`,
    "gi",
  );
  let anchorMatch;

  while ((anchorMatch = fallbackAnchorRegex.exec(seriesHtml)) !== null) {
    const chapterUrl = toAbsoluteUrl(anchorMatch[1], seriesUrl);
    const chapterSlug = extractChapterSlugFromUrl(chapterUrl, seriesSlug);
    if (!chapterSlug || seen.has(chapterSlug)) {
      continue;
    }

    const chapterTitle = stripTags(anchorMatch[2]);

    chapters.push({
      slug: chapterSlug,
      chapterOrder: parseChapterOrder(chapterSlug, chapterTitle),
      url: chapterUrl,
      title: chapterTitle || chapterSlug,
      releaseDateText: null,
      releaseDate: null,
    });

    seen.add(chapterSlug);
  }

  return chapters;
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

function isLikelyImageUrl(url) {
  const lower = url.toLowerCase();
  if (/\.(jpg|jpeg|png|webp|gif|avif)(?:\?|$)/.test(lower)) {
    return true;
  }

  try {
    const parsed = new URL(url);
    if (/^\/res\/manga\//i.test(parsed.pathname)) {
      return true;
    }
  } catch {
    return false;
  }

  return false;
}

function extractImageUrlsFromHtmlBlock(htmlBlock, baseUrl) {
  const imgTagRegex = /<img\b[^>]*>/gi;
  const urls = [];
  const seen = new Set();
  let imgMatch;

  while ((imgMatch = imgTagRegex.exec(htmlBlock)) !== null) {
    const imgTag = imgMatch[0];
    const src =
      extractAttribute(imgTag, "data-src") ||
      extractAttribute(imgTag, "src") ||
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

function extractImageUrlsFromChapImagesVariable(chapterHtml, chapterUrl) {
  const rawValue = extractQuotedJsVarValue(chapterHtml, "chapImages");
  if (!rawValue) {
    return [];
  }

  const rawList = decodeHtmlEntities(rawValue);
  const candidates = rawList
    .split(",")
    .map((value) => value.trim())
    .filter((value) => value.length > 0);

  const urls = [];
  const seen = new Set();

  for (const candidate of candidates) {
    const absoluteUrl = toAbsoluteUrl(candidate, chapterUrl);
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

function extractImageUrlsFromChapterImageBlocks(chapterHtml, chapterUrl) {
  const blockRegex =
    /<div\b[^>]*class=["'][^"']*\bchapter-image\b[^"']*["'][^>]*>[\s\S]*?<\/div>/gi;
  const urls = [];
  const seen = new Set();
  let blockMatch;

  while ((blockMatch = blockRegex.exec(chapterHtml)) !== null) {
    const imageUrls = extractImageUrlsFromHtmlBlock(blockMatch[0], chapterUrl);
    for (const imageUrl of imageUrls) {
      if (seen.has(imageUrl)) {
        continue;
      }

      urls.push(imageUrl);
      seen.add(imageUrl);
    }
  }

  return urls;
}

function extractImageUrlsFromChapterHtml(chapterHtml, chapterUrl) {
  const fromVariable = extractImageUrlsFromChapImagesVariable(chapterHtml, chapterUrl);
  if (fromVariable.length > 0) {
    return fromVariable;
  }

  const fromBlocks = extractImageUrlsFromChapterImageBlocks(chapterHtml, chapterUrl);
  if (fromBlocks.length > 0) {
    return fromBlocks;
  }

  const fromFullHtml = extractImageUrlsFromHtmlBlock(chapterHtml, chapterUrl);
  if (fromFullHtml.length === 0) {
    return [];
  }

  const narrowed = fromFullHtml.filter((imageUrl) => {
    try {
      const parsed = new URL(imageUrl);
      return /^\/res\/manga\//i.test(parsed.pathname);
    } catch {
      return false;
    }
  });

  return narrowed.length > 0 ? narrowed : fromFullHtml;
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

function buildDefaultManifest(seriesUrl, seriesSlug, seriesTitle, expectedChapterCount) {
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
      expectedChapterCount,
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
      chapterOrder: discovered.chapterOrder,
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

async function discoverSeries(client, seriesUrl, options) {
  const normalizedSeriesUrl = normalizeSeriesUrl(seriesUrl);
  const seriesSlug = extractSeriesSlug(normalizedSeriesUrl);

  const seriesHtml = await client.fetchText(normalizedSeriesUrl, {
    referer: normalizedSeriesUrl,
  });

  const seriesTitle = extractSeriesTitle(seriesHtml, seriesSlug);
  const expectedChapterCount = extractExpectedChapterCount(seriesHtml);
  const chapters = extractChaptersFromSeriesHtml(seriesHtml, normalizedSeriesUrl);

  if (chapters.length === 0) {
    throw new Error("No chapters found. The site may have changed markup.");
  }

  const orderedChapters = sortChaptersOldestFirst(chapters);

  if (
    options.verbose &&
    Number.isInteger(expectedChapterCount) &&
    expectedChapterCount >= 0 &&
    expectedChapterCount !== orderedChapters.length
  ) {
    console.log(
      `Chapter count mismatch: page says ${expectedChapterCount}, parser found ${orderedChapters.length}.`,
    );
  }

  return {
    seriesUrl: normalizedSeriesUrl,
    seriesSlug,
    seriesTitle,
    expectedChapterCount,
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
  const discovery = await discoverSeries(client, target, options);
  const paths = getSeriesPaths(options, discovery.seriesSlug);
  const defaults = buildDefaultManifest(
    discovery.seriesUrl,
    discovery.seriesSlug,
    discovery.seriesTitle,
    discovery.expectedChapterCount,
  );

  const manifest = await readManifest(paths.manifestPath, defaults);
  manifest.site = SITE_NAME;
  manifest.series = {
    url: discovery.seriesUrl,
    slug: discovery.seriesSlug,
    title: discovery.seriesTitle,
    expectedChapterCount: discovery.expectedChapterCount,
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
  if (Number.isInteger(output.series.expectedChapterCount)) {
    console.log(`Series page chapter count: ${output.series.expectedChapterCount}`);
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
    discovery.expectedChapterCount,
  );

  const manifest = await readManifest(paths.manifestPath, defaults);
  manifest.site = SITE_NAME;
  manifest.series = {
    url: discovery.seriesUrl,
    slug: discovery.seriesSlug,
    title: discovery.seriesTitle,
    expectedChapterCount: discovery.expectedChapterCount,
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
