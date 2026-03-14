# MangaDex Ripper (Standalone)

Standalone CLI tool for downloading offline copies from MangaDex into plain image folders plus `manifest.json`.

## What it does

- Discovers chapters from MangaDex title feeds (`/manga/{id}/feed`).
- Downloads chapter images via MangaDex@Home (`/at-home/server/{chapterId}`).
- Writes and updates a resumable manifest file.
- Supports dry-run and verify workflows.

## Output layout

```text
tools/mangadex-ripper/output/
  mangadex/
    <title-uuid>/
      manifest.json
      chapter-<chapter-uuid>/
        001.png
        002.png
```

## Commands

Run from repo root:

```bash
node tools/mangadex-ripper/ripper.mjs discover <title-url>
node tools/mangadex-ripper/ripper.mjs download <title-url>
node tools/mangadex-ripper/ripper.mjs update <title-url>
node tools/mangadex-ripper/ripper.mjs verify <title-url|series-dir|manifest-path>
```

### Examples

```bash
node tools/mangadex-ripper/ripper.mjs discover "https://mangadex.org/title/143a116f-8e1d-4f9b-9794-9fb8fc8f56dc/android-wa-keiken-ninzuu-ni-hairimasu-ka"

node tools/mangadex-ripper/ripper.mjs download "https://mangadex.org/title/143a116f-8e1d-4f9b-9794-9fb8fc8f56dc/android-wa-keiken-ninzuu-ni-hairimasu-ka" --limit 2 --dry-run

node tools/mangadex-ripper/ripper.mjs download "https://mangadex.org/title/143a116f-8e1d-4f9b-9794-9fb8fc8f56dc/android-wa-keiken-ninzuu-ni-hairimasu-ka" --concurrency 2 --delay-ms 500

node tools/mangadex-ripper/ripper.mjs verify "tools/mangadex-ripper/output/mangadex/143a116f-8e1d-4f9b-9794-9fb8fc8f56dc"
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

- This tool is MangaDex-specific (`mangadex.org`) for now.
- Discovery currently filters to English translated chapters (`translatedLanguage[]=en`).
- Output storage uses the MangaDex title UUID for stable paths.
- Use responsibly and in line with MangaDex's API acceptable-use policy.
