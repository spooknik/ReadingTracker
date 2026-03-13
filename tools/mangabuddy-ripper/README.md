# MangaBuddy Ripper (Standalone)

Standalone CLI tool for downloading offline copies from MangaBuddy into plain image folders plus `manifest.json`.

## What it does

- Discovers chapters from MangaBuddy series pages.
- Normalizes chapter order to oldest-first (including chapter numbers and notice entries).
- Downloads chapter images into per-chapter folders.
- Writes and updates a resumable manifest file.
- Supports dry-run and verify workflows.

## Output layout

```text
tools/mangabuddy-ripper/output/
  mangabuddy/
    <series-slug>/
      manifest.json
      chapter-1/
        001.jpeg
      chapter-36/
        001.jpeg
      notice/
        001.jpeg
```

## Commands

Run from repo root:

```bash
node tools/mangabuddy-ripper/ripper.mjs discover <series-url>
node tools/mangabuddy-ripper/ripper.mjs download <series-url>
node tools/mangabuddy-ripper/ripper.mjs update <series-url>
node tools/mangabuddy-ripper/ripper.mjs verify <series-url|series-dir|manifest-path>
```

### Examples

```bash
node tools/mangabuddy-ripper/ripper.mjs discover "https://mangabuddy.com/march"

node tools/mangabuddy-ripper/ripper.mjs download "https://mangabuddy.com/march" --limit 2 --dry-run

node tools/mangabuddy-ripper/ripper.mjs download "https://mangabuddy.com/march" --concurrency 2 --delay-ms 500

node tools/mangabuddy-ripper/ripper.mjs verify "tools/mangabuddy-ripper/output/mangabuddy/march"
```

## Useful flags

- `--output <dir>` custom output root
- `--concurrency <n>` image download concurrency
- `--delay-ms <n>` request delay
- `--jitter-ms <n>` random delay jitter
- `--retries <n>` retry count
- `--timeout-ms <n>` request timeout
- `--limit <n>` process only first N chapters
- `--force` re-download completed chapters/images
- `--dry-run` preview without downloading
- `--json` JSON output for discover
- `--verbose` extra logs

## Notes

- This tool is MangaBuddy-specific (`mangabuddy.com`) for now.
- It is intentionally standalone and not wired into the Next.js app yet.
- Chapter discovery parses series HTML from `#chapter-list` and stores normalized oldest-first order in manifest.
- Chapter image extraction prefers the `var chapImages = '...';` payload and falls back to `.chapter-image img[data-src]` markup.
- Use responsibly and in line with the source site's terms.
