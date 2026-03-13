# Dynasty Ripper (Standalone)

Standalone CLI tool for downloading offline copies from Dynasty Scans into plain image folders plus `manifest.json`.

## What it does

- Discovers chapters from Dynasty series pages.
- Downloads chapter images into per-chapter folders.
- Writes and updates a resumable manifest file.
- Supports dry-run and verify workflows.

## Output layout

```text
tools/dynasty-ripper/output/
  dynasty-scans/
    <series-slug>/
      manifest.json
      tadokoro_san_web_comic_ch01/
        001.webp
      tadokoro_san_web_comic_ch21_5/
        001.webp
```

## Commands

Run from repo root:

```bash
node tools/dynasty-ripper/ripper.mjs discover <series-url>
node tools/dynasty-ripper/ripper.mjs download <series-url>
node tools/dynasty-ripper/ripper.mjs update <series-url>
node tools/dynasty-ripper/ripper.mjs verify <series-url|series-dir|manifest-path>
```

### Examples

```bash
node tools/dynasty-ripper/ripper.mjs discover "https://dynasty-scans.com/series/tadokoro_san_web_comic"

node tools/dynasty-ripper/ripper.mjs download "https://dynasty-scans.com/series/tadokoro_san_web_comic" --limit 3 --dry-run

node tools/dynasty-ripper/ripper.mjs download "https://dynasty-scans.com/series/tadokoro_san_web_comic" --concurrency 2 --delay-ms 500

node tools/dynasty-ripper/ripper.mjs verify "tools/dynasty-ripper/output/dynasty-scans/tadokoro_san_web_comic"
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

- This tool is Dynasty-specific (`dynasty-scans.com`) for now.
- It is intentionally standalone and not wired into the Next.js app yet.
- It extracts pages from the chapter page `var pages = [...]` payload when available.
- Use responsibly and in line with the source site's terms.
