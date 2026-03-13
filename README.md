# ReadingTracker

Shared manga/manhwa reading tracker for a small group (2-3 users), built with Next.js + Prisma + PostgreSQL.

The app supports:

- library tracking and progress updates
- Cloudflare Access header-based auth
- optional offline reader backed by site-specific ripper scripts

## Tech Stack

- Next.js 16 (App Router) + TypeScript
- Tailwind CSS v4
- Prisma v7 + PostgreSQL
- Docker Compose deployment target

## Local Development

1. Copy env template:

```bash
cp .env.example .env
```

2. Start PostgreSQL:

```bash
docker compose up -d db
```

3. Start app:

```bash
npm install
npm run dev
```

## Core Commands

```bash
npm run dev
npm run build
npm run lint
npm run start

npm run db:migrate
npm run db:push
npm run db:studio
```

## Reader and Ripper

Reader/rip features are controlled by environment flags:

- `ENABLE_READER=1`
- `NEXT_PUBLIC_ENABLE_READER=1`
- `ENABLE_AUTO_RIP=1` (optional)

Ripper output defaults to `data/rips` (or `RIPPER_OUTPUT_ROOT` if set).

## Documentation

- Deployment: `DEPLOY.md`
- Migration/upgrade steps: `MIGRATION.md`
- Ripper and reader integration details: `docs/RIPPER_GUIDE.md`
- Site-specific ripper docs: `tools/*-ripper/README.md`
