# ManhwaDen Ripper (Standalone)

Standalone CLI tool for downloading offline copies from ManhwaDen into plain image folders plus `manifest.json`.

## What it does

- Discovers chapters from ManhwaDen series pages.
- Downloads chapter images into per-chapter folders.
- Writes and updates a resumable manifest file.
- Supports dry-run and verify workflows.

## Output layout

```text
tools/manhwaden-ripper/output/
  manhwaden/
    <series-slug>/
      manifest.json
      chapter-1/
        001.webp
        002.webp
      chapter-2/
        001.webp
```

## Commands

Run from repo root:

```bash
node tools/manhwaden-ripper/ripper.mjs discover <series-url>
node tools/manhwaden-ripper/ripper.mjs download <series-url>
node tools/manhwaden-ripper/ripper.mjs update <series-url>
node tools/manhwaden-ripper/ripper.mjs verify <series-url|series-dir|manifest-path>
```

### Examples

```bash
node tools/manhwaden-ripper/ripper.mjs discover "https://www.manhwaden.com/manga/you-are-my-world/"

node tools/manhwaden-ripper/ripper.mjs download "https://www.manhwaden.com/manga/you-are-my-world/" --limit 2 --dry-run

node tools/manhwaden-ripper/ripper.mjs download "https://www.manhwaden.com/manga/you-are-my-world/" --concurrency 2 --delay-ms 500

node tools/manhwaden-ripper/ripper.mjs verify "tools/manhwaden-ripper/output/manhwaden/you-are-my-world"
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

- This tool is ManhwaDen-specific (`manhwaden.com`) for now.
- It is intentionally standalone and not wired into the Next.js app yet.
- Use responsibly and in line with the source site's terms.
- Download output now reports both discovered chapter count and pending chapter count so resume runs are explicit.
- Includes a fallback for chapters that still point to dead `kingofshojo.com/wp-content/uploads/manga/...` image links: it will try the matching public Kingofshojo chapter page and extract `#readerarea img[src]` URLs.
