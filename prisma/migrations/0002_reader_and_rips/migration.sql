-- CreateEnum
CREATE TYPE "RipStatus" AS ENUM ('UNSUPPORTED', 'PENDING', 'RUNNING', 'READY', 'FAILED');

-- CreateEnum
CREATE TYPE "RipJobStatus" AS ENUM ('QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED');

-- CreateEnum
CREATE TYPE "RipJobKind" AS ENUM ('SYNC', 'VERIFY');

-- CreateTable
CREATE TABLE "series_rips" (
    "id" TEXT NOT NULL,
    "series_id" TEXT NOT NULL,
    "site" TEXT,
    "normalized_url" TEXT,
    "output_dir" TEXT,
    "manifest_path" TEXT,
    "status" "RipStatus" NOT NULL DEFAULT 'UNSUPPORTED',
    "last_error" TEXT,
    "last_synced_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "series_rips_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rip_jobs" (
    "id" TEXT NOT NULL,
    "series_rip_id" TEXT NOT NULL,
    "kind" "RipJobKind" NOT NULL DEFAULT 'SYNC',
    "status" "RipJobStatus" NOT NULL DEFAULT 'QUEUED',
    "started_at" TIMESTAMP(3),
    "finished_at" TIMESTAMP(3),
    "output_log" TEXT,
    "error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "rip_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reader_progress" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "series_id" TEXT NOT NULL,
    "chapter_slug" TEXT,
    "page_index" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reader_progress_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "series_rips_series_id_key" ON "series_rips"("series_id");

-- CreateIndex
CREATE INDEX "rip_jobs_status_created_at_idx" ON "rip_jobs"("status", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "reader_progress_user_id_series_id_key" ON "reader_progress"("user_id", "series_id");

-- AddForeignKey
ALTER TABLE "series_rips" ADD CONSTRAINT "series_rips_series_id_fkey" FOREIGN KEY ("series_id") REFERENCES "series"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rip_jobs" ADD CONSTRAINT "rip_jobs_series_rip_id_fkey" FOREIGN KEY ("series_rip_id") REFERENCES "series_rips"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reader_progress" ADD CONSTRAINT "reader_progress_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reader_progress" ADD CONSTRAINT "reader_progress_series_id_fkey" FOREIGN KEY ("series_id") REFERENCES "series"("id") ON DELETE CASCADE ON UPDATE CASCADE;
