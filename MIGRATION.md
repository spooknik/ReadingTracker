# ReadingTracker Migration Guide

Upgrade guide for an existing ReadingTracker deployment on a Proxmox Debian VM.

This migration covers the new reader + rip integration.

## What Changes in This Upgrade

- Adds Prisma migration `0002_reader_and_rips` (new rip/reader tables and enums).
- Adds reader/rip feature flags and worker secret env vars.
- Adds persistent rip storage volume mounted at `/app/data/rips`.
- Adds worker endpoint hardening: in production, `/api/rip/worker` requires `RIP_WORKER_SECRET` to be configured.

## 0) Preflight Checks

SSH into your VM and go to the repo:

```bash
cd /opt/ReadingTracker
```

Confirm Docker works:

```bash
docker --version
docker compose version
```

Confirm ripper scripts exist in your checkout (required for image build):

```bash
test -f tools/manhwaden-ripper/ripper.mjs && echo "manhwaden ok"
test -f tools/dynasty-ripper/ripper.mjs && echo "dynasty ok"
test -f tools/tapas-ripper/ripper.mjs && echo "tapas ok"
test -f tools/mangabuddy-ripper/ripper.mjs && echo "mangabuddy ok"
```

If any are missing, sync those directories into this repo checkout before continuing.

## 1) Back Up Before Upgrading

Back up `.env`:

```bash
cp .env ".env.backup.$(date +%Y%m%d-%H%M%S)"
```

Back up Postgres:

```bash
docker compose -f docker-compose.prod.yml exec db \
  pg_dump -U readingtracker readingtracker > "backup_pre_reader_$(date +%Y%m%d-%H%M%S).sql"
```

## 2) Pull Latest Code

```bash
git fetch origin
git pull --ff-only
```

## 3) Update Environment Variables

Edit `.env` and add/update these keys:

```bash
# Reader feature flags
ENABLE_READER=1
NEXT_PUBLIC_ENABLE_READER=1

# Start with manual queueing first (recommended)
ENABLE_AUTO_RIP=0

# Needed for local health checks / local worker curl calls that do not pass
# through Cloudflare Access headers
DEFAULT_USER_EMAIL=automation@localhost

# Required in production for /api/rip/worker
RIP_WORKER_SECRET=<generate-a-long-random-secret>

# Optional: custom rip output root (inside container)
# RIPPER_OUTPUT_ROOT=/app/data/rips

# Optional: host directory to bind-mount at /app/data/rips (recommended)
# RIPS_HOST_PATH=/opt/ReadingTracker/data/rips
```

Generate a secret if needed:

```bash
openssl rand -hex 32
```

## 4) Rebuild and Restart

If using host-mounted rips, create the host directory first:

```bash
mkdir -p "${RIPS_HOST_PATH:-/opt/ReadingTracker/data/rips}"
```

```bash
docker compose -f docker-compose.prod.yml up -d --build
docker compose -f docker-compose.prod.yml ps
```

Important: `NEXT_PUBLIC_ENABLE_READER` is a build-time frontend flag. Always use
`--build` after changing it.

## 5) Apply/Verify Prisma Migration

The app entrypoint runs migrations automatically at startup, but run this explicitly once:

```bash
docker compose -f docker-compose.prod.yml exec app npx prisma migrate deploy
docker compose -f docker-compose.prod.yml exec app npx prisma migrate status
```

You should see migration `0002_reader_and_rips` applied.

## 6) Verify App Health

```bash
curl -fsS http://localhost:3000/api/health
```

If healthy, this returns HTTP 200.

## 7) Verify Rip Storage Is Writable

```bash
docker compose -f docker-compose.prod.yml exec app sh -lc 'mkdir -p /app/data/rips/.permcheck && rm -rf /app/data/rips/.permcheck'
```

If you get permission errors:

```bash
chown -R 1001:1001 "${RIPS_HOST_PATH:-/opt/ReadingTracker/data/rips}"
docker compose -f docker-compose.prod.yml exec -u root app sh -lc 'mkdir -p /app/data/rips && chown -R nextjs:nodejs /app/data/rips'
```

You can inspect files directly on host:

```bash
ls -lah "${RIPS_HOST_PATH:-/opt/ReadingTracker/data/rips}"
```

## 8) Set Up Worker Processing (Recommended)

You can process queue jobs by calling the worker endpoint from the VM.

Manual test call:

```bash
# Use the literal secret from .env if RIP_WORKER_SECRET is not exported in your shell
curl -sS -X POST http://localhost:3000/api/rip/worker \
  -H "Content-Type: application/json" \
  -H "x-worker-secret: $RIP_WORKER_SECRET" \
  -d '{"maxJobs":1}'
```

If `DEFAULT_USER_EMAIL` is intentionally unset, add this header for local testing:

```bash
-H "cf-access-authenticated-user-email: worker@localhost"
```

Optional cron (every minute):

```bash
crontab -e
```

Add:

```cron
* * * * * curl -sS -X POST http://localhost:3000/api/rip/worker -H "Content-Type: application/json" -H "x-worker-secret: YOUR_SECRET_HERE" -d '{"maxJobs":1}' >/dev/null 2>&1
```

## 9) Smoke Test Checklist

1. Open app and confirm normal dashboard works.
2. Add or edit a series with a supported reading link.
3. Open series detail and click `Queue Rip Sync`.
4. Confirm rip status progresses (`PENDING`/`RUNNING` to `READY`).
5. Click `Open Reader` and verify images load.
6. Scroll and refresh; confirm progress persists.

If reader UI still does not appear:

```bash
docker compose -f docker-compose.prod.yml exec app sh -lc 'echo "ENABLE_READER=$ENABLE_READER NEXT_PUBLIC_ENABLE_READER=$NEXT_PUBLIC_ENABLE_READER"'
```

Both should print `1`.

## 10) Rollback Plan

Quick disable (no DB rollback):

```bash
# in .env
ENABLE_READER=0
NEXT_PUBLIC_ENABLE_READER=0
ENABLE_AUTO_RIP=0

docker compose -f docker-compose.prod.yml up -d --build
```

Full rollback (code + DB):

1. Deploy previous app commit/tag.
2. Restore DB backup:

```bash
docker compose -f docker-compose.prod.yml exec -T db \
  psql -U readingtracker readingtracker < backup_pre_reader_YYYYMMDD-HHMMSS.sql
```

## Troubleshooting

- `Worker secret is not configured`: set `RIP_WORKER_SECRET` in `.env`, rebuild/restart.
- `P1001` migration errors: database container not healthy/reachable.
- Rip status stays `FAILED`: check app logs for ripper output.

```bash
docker compose -f docker-compose.prod.yml logs -f app
```

- Build fails on missing `tools/*-ripper`: sync those directories into your checkout and rebuild.
