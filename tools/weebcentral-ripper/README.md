# WeebCentral Ripper (Standalone)

Standalone CLI tool for downloading offline copies from WeebCentral into plain image folders plus `manifest.json`.

## What it does

- Discovers chapters from WeebCentral series pages.
- Expands discovery using the series full chapter list endpoint for complete coverage.
- Downloads chapter images into per-chapter folders.
- Writes and updates a resumable manifest file.
- Supports dry-run and verify workflows.

## Output layout

```text
tools/weebcentral-ripper/output/
  weebcentral/
    <series-id>/
      manifest.json
      <chapter-id>/
        001.png
        002.png
```

## Commands

Run from repo root:

```bash
node tools/weebcentral-ripper/ripper.mjs discover <series-url>
node tools/weebcentral-ripper/ripper.mjs download <series-url>
node tools/weebcentral-ripper/ripper.mjs update <series-url>
node tools/weebcentral-ripper/ripper.mjs verify <series-url|series-dir|manifest-path>
```

### Examples

```bash
node tools/weebcentral-ripper/ripper.mjs discover "https://weebcentral.com/series/01J76XYDH3P7VSX7DQVXP5V912/How-Do-We-Relationship"

node tools/weebcentral-ripper/ripper.mjs download "https://weebcentral.com/series/01J76XYDH3P7VSX7DQVXP5V912/How-Do-We-Relationship" --limit 2 --dry-run

node tools/weebcentral-ripper/ripper.mjs download "https://weebcentral.com/series/01J76XYDH3P7VSX7DQVXP5V912/How-Do-We-Relationship" --concurrency 2 --delay-ms 500

node tools/weebcentral-ripper/ripper.mjs verify "tools/weebcentral-ripper/output/weebcentral/01J76XYDH3P7VSX7DQVXP5V912"
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

- This tool is WeebCentral-specific (`weebcentral.com`) for now.
- Discovery combines chapter links from the series page and `/series/<series-id>/full-chapter-list`.
- Chapter image discovery prefers chapter-page image endpoint links and falls back to `/chapters/<chapter-id>/images` when needed.
- Use responsibly and in line with the source site's terms.
