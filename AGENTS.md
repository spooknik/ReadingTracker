# AGENTS.md — ReadingTracker

## Project Overview

Shared manga/manhwa reading tracker web app. Next.js 16 (App Router) + TypeScript +
Tailwind CSS v4 + Prisma v7 + PostgreSQL. Auth via Cloudflare Zero Trust headers.
Designed for 2-3 users on a self-hosted Proxmox/Docker deployment.

## Build & Run Commands

```bash
npm run dev              # Start dev server (requires PostgreSQL running)
npm run build            # Generate Prisma client + Next.js build
npm run lint             # ESLint (flat config, entire project)
npm run start            # Start production server

npm run db:migrate       # prisma migrate deploy (production migrations)
npm run db:push          # prisma db push (dev schema sync, no migration file)
npm run db:studio        # Open Prisma Studio GUI
```

**No test framework is configured.** There are no unit or integration tests. If adding
tests, use Vitest (aligns with the Vite-based tooling in the Next.js ecosystem).

**Prisma generate** runs automatically via `postinstall`. If you change `schema.prisma`,
run `npx prisma generate` to regenerate the client at `src/generated/prisma/`.

**Database**: `docker-compose.yml` runs PostgreSQL for local dev. Set `DATABASE_URL` in
`.env` (see `.env.example`).

## Code Style

### Formatting
- **2-space indentation**, no tabs
- **Semicolons**: always
- **Quotes**: double quotes everywhere (`"`, not `'`)
- **No Prettier** configured — follow existing style manually
- **Trailing commas**: used in multi-line arrays/objects/params

### Imports
Group imports in this order (no blank lines between groups):
1. Framework/library (`react`, `next/*`, `next/navigation`)
2. Internal libs (`@/lib/*`)
3. Internal components (`@/components/*`)
4. Generated/types (`@/generated/prisma/client`)
5. Relative (`./badges`, `./series-card`)

Use `import type` for type-only imports:
```ts
import type { ReadingStatus } from "@/generated/prisma/client";
import type { Metadata } from "next";
```

### Naming Conventions
| Element               | Convention         | Example                          |
|-----------------------|--------------------|----------------------------------|
| Files (components)    | kebab-case         | `series-detail.tsx`              |
| Files (lib)           | kebab-case         | `prisma.ts`, `auth.ts`          |
| React components      | PascalCase         | `SeriesDetail`, `LibraryList`   |
| Props interfaces      | PascalCase + Props | `SeriesDetailProps`             |
| Data interfaces       | PascalCase + Data  | `UserData`, `SeriesData`        |
| Variables/functions   | camelCase          | `currentUser`, `handleSearch`   |
| Constants (arrays)    | UPPER_SNAKE_CASE   | `STATUSES`, `SORT_OPTIONS`      |
| DB columns (Prisma)   | snake_case via @map| `created_at`, `media_type`      |
| TS model fields       | camelCase          | `createdAt`, `mediaType`        |

### Types
- **`interface`** for object shapes and component props
- **`type`** only for unions and intersections (`type SortOption = "recent" | "title"`)
- **Extract** props into named interfaces (`interface SeriesDetailProps { ... }`)
- **Exception**: small helper components can use inline types in params
- API route params: `{ params }: { params: Promise<{ id: string }> }` (Next.js 16)

### Exports
- **Named exports** for all components: `export function SeriesDetail(...)`
- **Default exports** only where Next.js requires them: page, layout, loading components
- **Named exports** for API handlers matching HTTP methods: `export async function POST`
- **Named exports** for lib utilities: `export const prisma`, `export async function getCurrentUser`

## Architecture Patterns

### Server vs Client Components
- **Server components** (default, no directive): fetch data directly with Prisma, call
  `getCurrentUser()`. Used for pages, layouts, loading skeletons, pure presentational
  components like badges.
- **Client components** (`"use client"` at line 1): have state (`useState`), event
  handlers, `useRouter()`, browser APIs. Used for forms, interactive lists, navigation.
- **Data passing**: server components serialize Prisma results with
  `JSON.parse(JSON.stringify(data))` before passing as props to client components.

### Auth Flow
1. Middleware (`src/middleware.ts`) resolves email from headers in priority order:
   `Cf-Access-Authenticated-User-Email` → `DEFAULT_USER_EMAIL` env → dev fallback
2. Forwards resolved email as `x-user-email` header
3. `getCurrentUser()` in `src/lib/auth.ts` reads this header and upserts the user
4. No third-party auth library — Cloudflare Zero Trust handles authentication

### Prisma v7
- **Driver adapter required**: uses `@prisma/adapter-pg` + `pg` package
- **Import from** `@/generated/prisma/client` (not `@prisma/client`)
- **Singleton** in `src/lib/prisma.ts` using `globalThis` caching for dev hot reload
- **Constructor**: `new PrismaClient({ adapter: new PrismaPg({ connectionString }) })`
- Schema uses `@map()`/`@@map()` for camelCase TS ↔ snake_case DB mapping
- UUIDs as primary keys, cascade delete on relations

### API Routes
- One `route.ts` per resource, multiple HTTP methods per file
- Pattern: auth first → validate input → try/catch DB operation → JSON response
- Response: `NextResponse.json({ data }, { status })` or `NextResponse.json({ error }, { status })`
- Status codes: 400 validation, 401 auth, 404 not found, 409 conflict, 500 server error

### Error Handling
**API routes:**
```ts
try {
  // ... database operation
} catch (error) {
  console.error("Descriptive message:", error);
  return NextResponse.json({ error: "User-friendly message" }, { status: 500 });
}
```

**Client components:**
```ts
try {
  const res = await fetch(...);
  if (!res.ok) {
    const data = await res.json();
    setError(data.error || "Fallback message");
    return;
  }
  router.refresh();
} catch {
  setError("Failed to do X");
}
```
- Use bare `catch` (no error param) in client code
- Non-critical actions (like +1 chapter) silently fail with `catch { // Silently fail }`

### State Management
- Component-local `useState` only — no Redux, Zustand, or Context
- No form library — raw `useState` + event handlers
- `router.refresh()` to revalidate server data after mutations

## File Organization

```
src/
  app/               # Pages and API routes (Next.js App Router)
    api/             # REST endpoints organized by resource
    series/[id]/     # Dynamic route for series detail
    add/             # Add series page
    profile/         # User profile page
  components/        # All shared UI components (flat, no subdirectories)
  lib/               # Server-side singletons and utilities (prisma, auth)
  generated/prisma/  # Auto-generated Prisma client (gitignored)
prisma/
  schema.prisma      # Database schema
  migrations/        # Migration SQL files
```

## Key Dependencies
- **Next.js 16** with App Router, standalone output for Docker
- **Tailwind CSS v4** with `@theme inline` CSS custom properties, dark mode via
  `prefers-color-scheme` (system preference, no toggle)
- **Prisma v7** with `@prisma/adapter-pg` driver adapter
- **Jikan API v4** (`api.jikan.moe`) for manga search — no API key needed
- **Images**: `unoptimized: true` in next.config — no sharp dependency needed
