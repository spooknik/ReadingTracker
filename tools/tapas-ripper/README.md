# Tapas Ripper (Standalone)

Standalone CLI tool for downloading offline copies from Tapas into plain image folders plus `manifest.json`.

## What it does

- Discovers episodes from Tapas series pages via the episodes JSON endpoint.
- Downloads episode images into per-episode folders.
- Writes and updates a resumable manifest file.
- Supports dry-run and verify workflows.

## Output layout

```text
tools/tapas-ripper/output/
  tapas/
    <series-slug>/
      manifest.json
      episode-500166/
        001.png
      episode-2810580/
        001.png
        002.png
```

## Commands

Run from repo root:

```bash
node tools/tapas-ripper/ripper.mjs discover <series-url>
node tools/tapas-ripper/ripper.mjs download <series-url>
node tools/tapas-ripper/ripper.mjs update <series-url>
node tools/tapas-ripper/ripper.mjs verify <series-url|series-dir|manifest-path>
```

### Examples

```bash
node tools/tapas-ripper/ripper.mjs discover "https://tapas.io/series/The-Boy-and-the-Wolf/info"

node tools/tapas-ripper/ripper.mjs download "https://tapas.io/series/The-Boy-and-the-Wolf/info" --limit 2 --dry-run

node tools/tapas-ripper/ripper.mjs download "https://tapas.io/series/The-Boy-and-the-Wolf/info" --concurrency 2 --delay-ms 500

node tools/tapas-ripper/ripper.mjs verify "tools/tapas-ripper/output/tapas/The-Boy-and-the-Wolf"
```

## Useful flags

- `--output <dir>` custom output root
- `--concurrency <n>` image download concurrency
- `--delay-ms <n>` request delay
- `--jitter-ms <n>` random delay jitter
- `--retries <n>` retry count
- `--timeout-ms <n>` request timeout
- `--limit <n>` process only first N episodes
- `--force` re-download completed episodes/images
- `--dry-run` preview without downloading
- `--json` JSON output for discover
- `--verbose` extra logs

## Notes

- This tool is Tapas-specific (`tapas.io`) for now.
- It is intentionally standalone and not wired into the Next.js app yet.
- Discovery uses Tapas `GET /series/{numericId}/episodes?page=N&sort=OLDEST` endpoint and stores episode IDs in the manifest.
- Episode image extraction reads `img.content__img` `data-src` values from episode HTML, including mature-gated sections when present.
- Use responsibly and in line with the source site's terms.
