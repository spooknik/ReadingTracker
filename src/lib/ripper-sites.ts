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

const RIPPER_SITES: RipperSiteDefinition[] = [
  {
    site: "manhwaden",
    ripperPath: "tools/manhwaden-ripper/ripper.mjs",
    normalizeSeriesUrl: (url) => {
      if (url.hostname !== "manhwaden.com" && url.hostname !== "www.manhwaden.com") {
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
      if (url.hostname !== "dynasty-scans.com" && url.hostname !== "www.dynasty-scans.com") {
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
      if (
        url.hostname !== "tapas.io" &&
        url.hostname !== "www.tapas.io" &&
        url.hostname !== "m.tapas.io"
      ) {
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
      if (
        url.hostname !== "mangabuddy.com" &&
        url.hostname !== "www.mangabuddy.com" &&
        url.hostname !== "m.mangabuddy.com"
      ) {
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
    site: "weebcentral",
    ripperPath: "tools/weebcentral-ripper/ripper.mjs",
    normalizeSeriesUrl: (url) => {
      if (url.hostname !== "weebcentral.com" && url.hostname !== "www.weebcentral.com") {
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
