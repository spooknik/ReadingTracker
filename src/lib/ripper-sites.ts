import path from "node:path";
import process from "node:process";

interface RipperSiteDefinition {
  site: string;
  ripperPath: string;
  normalizeSeriesUrl: (url: URL) => string | null;
  extractSeriesSlug: (normalizedSeriesUrl: string) => string;
}

interface ResolvedRipperSite {
  site: string;
  normalizedSeriesUrl: string;
  seriesSlug: string;
  ripperScriptPath: string;
}

interface RipperSiteRuntimeInfo {
  site: string;
  ripperScriptPath: string;
}

function isWeebcentralHost(hostname: string): boolean {
  return hostname === "weebcentral.com" || hostname === "www.weebcentral.com";
}

function isManhwadenHost(hostname: string): boolean {
  return hostname === "manhwaden.com" || hostname === "www.manhwaden.com";
}

function isDynastyHost(hostname: string): boolean {
  return hostname === "dynasty-scans.com" || hostname === "www.dynasty-scans.com";
}

function isTapasHost(hostname: string): boolean {
  return hostname === "tapas.io" || hostname === "www.tapas.io" || hostname === "m.tapas.io";
}

function isMangabuddyHost(hostname: string): boolean {
  return hostname === "mangabuddy.com" || hostname === "www.mangabuddy.com" || hostname === "m.mangabuddy.com";
}

function isMangadexHost(hostname: string): boolean {
  return hostname === "mangadex.org" || hostname === "www.mangadex.org";
}

function getSeriesUrlHintForSupportedHost(hostname: string): string | null {
  if (isWeebcentralHost(hostname)) {
    return "WeebCentral link must be a series URL like https://weebcentral.com/series/<series-id>/<series-slug>";
  }

  if (isManhwadenHost(hostname)) {
    return "ManhwaDen link must be a series URL like https://www.manhwaden.com/manga/<series-slug>/";
  }

  if (isDynastyHost(hostname)) {
    return "Dynasty link must be a series URL like https://dynasty-scans.com/series/<series-slug>";
  }

  if (isTapasHost(hostname)) {
    return "Tapas link must be a series URL like https://tapas.io/series/<series-slug>/info";
  }

  if (isMangabuddyHost(hostname)) {
    return "MangaBuddy link must be a series URL like https://mangabuddy.com/<series-slug>";
  }

  if (isMangadexHost(hostname)) {
    return "MangaDex link must be a title URL like https://mangadex.org/title/<title-id>/<series-slug>";
  }

  return null;
}

const MANGABUDDY_RESERVED_PREFIXES = new Set([
  "home",
  "latest",
  "popular",
  "search",
  "genres",
  "manga-list",
  "discussions",
  "read-novel",
  "profile",
  "users",
  "login",
  "register",
  "signup",
  "terms-of-service",
  "privacy-policy",
  "contact",
  "dmca",
  "az-list",
]);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const RIPPER_SITES: RipperSiteDefinition[] = [
  {
    site: "manhwaden",
    ripperPath: "tools/manhwaden-ripper/ripper.mjs",
    normalizeSeriesUrl: (url) => {
      if (!isManhwadenHost(url.hostname)) {
        return null;
      }

      const pathParts = url.pathname.split("/").filter(Boolean);
      if (pathParts.length < 2 || pathParts[0] !== "manga") {
        return null;
      }

      return `https://www.manhwaden.com/manga/${pathParts[1]}/`;
    },
    extractSeriesSlug: (normalizedSeriesUrl) => {
      const url = new URL(normalizedSeriesUrl);
      const parts = url.pathname.split("/").filter(Boolean);
      return parts[1];
    },
  },
  {
    site: "dynasty-scans",
    ripperPath: "tools/dynasty-ripper/ripper.mjs",
    normalizeSeriesUrl: (url) => {
      if (!isDynastyHost(url.hostname)) {
        return null;
      }

      const pathParts = url.pathname.split("/").filter(Boolean);
      if (pathParts.length < 2 || pathParts[0] !== "series") {
        return null;
      }

      return `https://dynasty-scans.com/series/${pathParts[1]}`;
    },
    extractSeriesSlug: (normalizedSeriesUrl) => {
      const url = new URL(normalizedSeriesUrl);
      const parts = url.pathname.split("/").filter(Boolean);
      return parts[1];
    },
  },
  {
    site: "tapas",
    ripperPath: "tools/tapas-ripper/ripper.mjs",
    normalizeSeriesUrl: (url) => {
      if (!isTapasHost(url.hostname)) {
        return null;
      }

      const pathParts = url.pathname.split("/").filter(Boolean);
      if (pathParts.length < 2 || pathParts[0] !== "series") {
        return null;
      }

      return `https://tapas.io/series/${pathParts[1]}/info`;
    },
    extractSeriesSlug: (normalizedSeriesUrl) => {
      const url = new URL(normalizedSeriesUrl);
      const parts = url.pathname.split("/").filter(Boolean);
      return parts[1];
    },
  },
  {
    site: "mangabuddy",
    ripperPath: "tools/mangabuddy-ripper/ripper.mjs",
    normalizeSeriesUrl: (url) => {
      if (!isMangabuddyHost(url.hostname)) {
        return null;
      }

      const pathParts = url.pathname.split("/").filter(Boolean);
      if (pathParts.length === 0) {
        return null;
      }

      let seriesSlug: string | null = null;

      if (pathParts[0] === "manga") {
        seriesSlug = pathParts[1] || null;
      } else if (!MANGABUDDY_RESERVED_PREFIXES.has(pathParts[0])) {
        seriesSlug = pathParts[0];
      }

      if (!seriesSlug) {
        return null;
      }

      return `https://mangabuddy.com/${seriesSlug}`;
    },
    extractSeriesSlug: (normalizedSeriesUrl) => {
      const url = new URL(normalizedSeriesUrl);
      const parts = url.pathname.split("/").filter(Boolean);
      return parts[0];
    },
  },
  {
    site: "mangadex",
    ripperPath: "tools/mangadex-ripper/ripper.mjs",
    normalizeSeriesUrl: (url) => {
      if (!isMangadexHost(url.hostname)) {
        return null;
      }

      const pathParts = url.pathname.split("/").filter(Boolean);
      if (pathParts.length < 2 || pathParts[0] !== "title") {
        return null;
      }

      const titleId = pathParts[1];
      if (!UUID_PATTERN.test(titleId)) {
        return null;
      }

      const seriesSlug = pathParts[2];
      return seriesSlug
        ? `https://mangadex.org/title/${titleId}/${seriesSlug}`
        : `https://mangadex.org/title/${titleId}`;
    },
    extractSeriesSlug: (normalizedSeriesUrl) => {
      const url = new URL(normalizedSeriesUrl);
      const parts = url.pathname.split("/").filter(Boolean);
      return parts[1];
    },
  },
  {
    site: "weebcentral",
    ripperPath: "tools/weebcentral-ripper/ripper.mjs",
    normalizeSeriesUrl: (url) => {
      if (!isWeebcentralHost(url.hostname)) {
        return null;
      }

      const pathParts = url.pathname.split("/").filter(Boolean);
      if (pathParts.length < 2 || pathParts[0] !== "series") {
        return null;
      }

      const seriesId = pathParts[1];
      if (!seriesId) {
        return null;
      }

      const seriesSlug = pathParts[2];
      return seriesSlug
        ? `https://weebcentral.com/series/${seriesId}/${seriesSlug}`
        : `https://weebcentral.com/series/${seriesId}`;
    },
    extractSeriesSlug: (normalizedSeriesUrl) => {
      const url = new URL(normalizedSeriesUrl);
      const parts = url.pathname.split("/").filter(Boolean);
      return parts[1];
    },
  },
];

export function isHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

export function sanitizePathSegment(value: string): string {
  return value.replace(/[<>:"/\\|?*\x00-\x1f]/g, "_").trim();
}

export function getRipperOutputRoot(): string {
  const configured = process.env.RIPPER_OUTPUT_ROOT;
  if (configured && configured.trim().length > 0) {
    return path.resolve(configured);
  }

  return path.resolve(process.cwd(), "data/rips");
}

export function resolveRipperSite(rawUrl: string | null | undefined): ResolvedRipperSite | null {
  if (!rawUrl || !isHttpUrl(rawUrl)) {
    return null;
  }

  const parsed = new URL(rawUrl);

  for (const site of RIPPER_SITES) {
    const normalizedSeriesUrl = site.normalizeSeriesUrl(parsed);
    if (!normalizedSeriesUrl) {
      continue;
    }

    const seriesSlug = site.extractSeriesSlug(normalizedSeriesUrl);
    if (!seriesSlug) {
      continue;
    }

    return {
      site: site.site,
      normalizedSeriesUrl,
      seriesSlug,
      ripperScriptPath: path.resolve(process.cwd(), site.ripperPath),
    };
  }

  return null;
}

export function getRipperLinkError(rawUrl: string | null | undefined): string | null {
  const normalizedUrl = typeof rawUrl === "string" ? rawUrl.trim() : "";
  if (!normalizedUrl) {
    return "Series link is missing";
  }

  if (!isHttpUrl(normalizedUrl)) {
    return "Series link must be a valid http(s) URL";
  }

  if (resolveRipperSite(normalizedUrl)) {
    return null;
  }

  const parsed = new URL(normalizedUrl);
  const hostHint = getSeriesUrlHintForSupportedHost(parsed.hostname);
  if (hostHint) {
    return hostHint;
  }

  return "Series link is unsupported for ripping";
}

export function getSeriesRipPaths(resolvedSite: ResolvedRipperSite): {
  outputDir: string;
  manifestPath: string;
} {
  const outputRoot = getRipperOutputRoot();
  const safeSlug = sanitizePathSegment(resolvedSite.seriesSlug);
  const outputDir = path.join(outputRoot, resolvedSite.site, safeSlug);

  return {
    outputDir,
    manifestPath: path.join(outputDir, "manifest.json"),
  };
}

export function getRipperSiteRuntimeInfo(site: string): RipperSiteRuntimeInfo | null {
  const matched = RIPPER_SITES.find((candidate) => candidate.site === site);
  if (!matched) {
    return null;
  }

  return {
    site: matched.site,
    ripperScriptPath: path.resolve(process.cwd(), matched.ripperPath),
  };
}
