# Ripper and Reader Integration Guide

This document explains how the ripper system works end to end, how to add a new site,
and what future contributors (human or AI) should verify before shipping changes.

## Why this exists

ReadingTracker's reader experience depends on local rip output. If ripping fails or drifts
from the manifest contract, the reader breaks.

Use this guide when you:

- debug unsupported links or failing rip jobs
- add support for a new content site
- change manifest format or chapter/image parsing behavior
- update deployment or worker scheduling

## Architecture at a glance

### Data flow

1. User adds or edits a series link (`src/app/api/series/route.ts`, `src/app/api/series/[id]/route.ts`)
2. Link is normalized/resolved by `resolveRipperSite()` (`src/lib/ripper-sites.ts`)
3. `series_rips` row is created/updated (site, normalized URL, output dir, manifest path)
4. Rip job is queued (`rip_jobs`) via `enqueueRipJob()` (`src/lib/rip-queue.ts`)
5. Queue worker executes site script with `node <ripper> update <normalized-url> --output <root>`
6. Site script writes/updates `manifest.json` + chapter image files under output root
7. Reader endpoints load manifest (`src/lib/reader-manifest.ts`) and stream images from disk

### Runtime components

- Site registry and URL normalization: `src/lib/ripper-sites.ts`
- Job queue and process spawning: `src/lib/rip-queue.ts`
- Rip status API: `src/app/api/series/[id]/rip/route.ts`
- Worker trigger endpoint: `src/app/api/rip/worker/route.ts`
- Reader content API: `src/app/api/reader/series/[id]/content/route.ts`
- Reader image API: `src/app/api/reader/series/[id]/image/route.ts`

## Feature flags and environment

Defined in `src/lib/reader-flags.ts`:

- `ENABLE_READER=1` enables reader/rip APIs on the server
- `NEXT_PUBLIC_ENABLE_READER=1` enables reader UI controls in the frontend
- `ENABLE_AUTO_RIP=1` auto-queues a sync when supported links are added/edited

Additional rip settings:

- `RIPPER_OUTPUT_ROOT` (optional): filesystem root for rip data
  - default: `data/rips` (relative to app working directory)
- `RIP_WORKER_SECRET` (recommended): required header value for `/api/rip/worker`

Production compose mounts host storage to `/app/data/rips` via `RIPS_HOST_PATH`.

## Supported sites and URL shape

Current site handlers live in `src/lib/ripper-sites.ts`.

- ManhwaDen: `https://www.manhwaden.com/manga/<series-slug>/`
- Dynasty: `https://dynasty-scans.com/series/<series-slug>`
- Tapas: `https://tapas.io/series/<series-slug>/info`
- MangaBuddy: `https://mangabuddy.com/<series-slug>`
- WeebCentral: `https://weebcentral.com/series/<series-id>/<series-slug>`

Important: host-only URLs (for example `https://weebcentral.com/`) are not valid series
links and are intentionally rejected. `getRipperLinkError()` returns site-specific hints.

## Status model

### Series rip status (`RipStatus`)

- `UNSUPPORTED`: link does not match a supported series URL pattern
- `PENDING`: configured and waiting for first/next sync
- `RUNNING`: active rip in progress
- `READY`: manifest available and at least one completed chapter
- `FAILED`: last run failed

### Job status (`RipJobStatus`)

- `QUEUED`, `RUNNING`, `SUCCEEDED`, `FAILED`

Queue rule: only one active (`QUEUED`/`RUNNING`) job per series rip at a time.

## Site ripper CLI contract

Each site script under `tools/<site>-ripper/ripper.mjs` should support:

```bash
node tools/<site>-ripper/ripper.mjs discover <series-url>
node tools/<site>-ripper/ripper.mjs download <series-url>
node tools/<site>-ripper/ripper.mjs update <series-url>
node tools/<site>-ripper/ripper.mjs verify <series-url|series-dir|manifest-path>
```

Required behavior:

- `discover`: resolve series metadata + chapter list and write/merge manifest
- `download`/`update`: download pending chapter images, keep resumable manifest state
- `verify`: check on-disk files referenced by manifest, mark missing as failed
- `--output <dir>` must be honored (queue passes this at runtime)

## Manifest contract (reader-facing)

Reader code (`src/lib/reader-manifest.ts`) is tolerant, but these fields should exist:

```json
{
  "site": "weebcentral",
  "updatedAt": "2026-03-13T12:34:56.000Z",
  "series": {
    "title": "How Do We Relationship"
  },
  "chapters": [
    {
      "slug": "01JN97RYN6VS9VKSTAKN3BE48J",
      "title": "Chapter 133",
      "status": "completed",
      "chapterOrder": 133,
      "releaseDate": "2026-03-01",
      "releaseDateText": "Mar 1, 2026",
      "url": "https://weebcentral.com/chapters/...",
      "missingFromSource": false,
      "images": [
        {
          "index": 1,
          "file": "001.png",
          "bytes": 123456,
          "url": "https://cdn.example/.../0133-001.png"
        }
      ]
    }
  ]
}
```

Reader expectations:

- chapter entries with no valid `images` are ignored
- chapters with `status: failed` are hidden from reader payload
- image URLs matching known placeholder/thumbnail patterns are filtered defensively
- chapter order should be stable oldest -> newest

## Adding a new site (checklist)

1. Create `tools/<site>-ripper/ripper.mjs` and `tools/<site>-ripper/README.md`
2. Implement CLI contract (`discover/download/update/verify`)
3. Add site definition in `src/lib/ripper-sites.ts`
   - strict host check
   - strict series URL normalization
   - storage slug extraction
4. Add a helpful format hint in `getSeriesUrlHintForSupportedHost()`
5. Update runtime image copy in `Dockerfile`
6. Validate locally (examples below)
7. Confirm UI and API behavior
   - add/edit series link
   - queue sync
   - reader opens and images render

## Local validation runbook

### 1) Discover

```bash
node tools/<site>-ripper/ripper.mjs discover "<series-url>" --verbose
```

Check for:

- expected chapter count
- manifest path written under output root

### 2) Dry run download

```bash
node tools/<site>-ripper/ripper.mjs download "<series-url>" --limit 2 --dry-run
```

### 3) Real download sample

```bash
node tools/<site>-ripper/ripper.mjs download "<series-url>" --limit 1
```

### 4) Verify

```bash
node tools/<site>-ripper/ripper.mjs verify "<series-url>"
```

### 5) App lint

```bash
npm run lint
```

## Operations and scheduling

Worker endpoint: `POST /api/rip/worker`

- accepts body `{ "maxJobs": 1..5 }`
- in production: returns `503` if `RIP_WORKER_SECRET` is missing
- if secret is configured, request must include header `x-worker-secret`

Typical cron call:

```bash
curl -sS -X POST http://localhost:3000/api/rip/worker \
  -H "Content-Type: application/json" \
  -H "x-worker-secret: $RIP_WORKER_SECRET" \
  -d '{"maxJobs":1}'
```

## Debugging quick reference

- Rip status endpoint: `GET /api/series/<seriesId>/rip`
- Queue and app logs: `docker compose -f docker-compose.prod.yml logs -f app`
- If reader says files are missing, check mount/path consistency for `/app/data/rips`
- If link is rejected, inspect `lastError` from rip status for format hint

## Guidance for AI agents

When modifying ripper logic:

1. Keep URL normalization strict and deterministic
2. Prefer scoped extraction (chapter container/endpoint) over whole-page image scraping
3. Dedupe chapter and image URLs
4. Preserve stable chapter sort order
5. Keep manifest backward-compatible; do not remove existing fields casually
6. Add defensive filtering for obvious placeholders/thumbnails when needed
7. Validate with real target URLs and run `npm run lint`
