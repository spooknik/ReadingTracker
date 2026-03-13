FROM node:20-alpine AS base

# Install dependencies
FROM base AS deps
RUN apk add --no-cache libc6-compat
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts

# Build the application
FROM base AS builder
WORKDIR /app
ARG NEXT_PUBLIC_ENABLE_READER=0
ENV NEXT_PUBLIC_ENABLE_READER=${NEXT_PUBLIC_ENABLE_READER}
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Generate Prisma client
RUN npx prisma generate

# Build Next.js
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# Production runner
FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

COPY --from=builder /app/public ./public

# Standalone output
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

# Copy ripper scripts for runtime sync jobs
COPY --from=builder --chown=nextjs:nodejs /app/tools/manhwaden-ripper ./tools/manhwaden-ripper
COPY --from=builder --chown=nextjs:nodejs /app/tools/dynasty-ripper ./tools/dynasty-ripper
COPY --from=builder --chown=nextjs:nodejs /app/tools/tapas-ripper ./tools/tapas-ripper
COPY --from=builder --chown=nextjs:nodejs /app/tools/mangabuddy-ripper ./tools/mangabuddy-ripper
COPY --from=builder --chown=nextjs:nodejs /app/tools/weebcentral-ripper ./tools/weebcentral-ripper

# Copy Prisma schema, migrations, config, and generated client for runtime migration
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/prisma.config.ts ./prisma.config.ts
COPY --from=builder /app/src/generated ./src/generated

# Copy node_modules needed for prisma migrate at runtime
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json

# Entrypoint script: runs migrations then starts the app
COPY --from=builder /app/entrypoint.sh ./entrypoint.sh

USER nextjs

EXPOSE 3000

ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

CMD ["sh", "entrypoint.sh"]
