"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import type { MALMangaResult } from "@/app/api/mal/search/route";

type Tab = "search" | "manual";

const MEDIA_TYPES = [
  { value: "MANGA", label: "Manga" },
  { value: "MANHWA", label: "Manhwa" },
  { value: "MANHUA", label: "Manhua" },
  { value: "LIGHT_NOVEL", label: "Light Novel" },
  { value: "BOOK", label: "Book" },
];

const STATUSES = [
  { value: "READING", label: "Reading" },
  { value: "PLAN_TO_READ", label: "Plan to Read" },
  { value: "COMPLETED", label: "Completed" },
  { value: "ON_HOLD", label: "On Hold" },
  { value: "DROPPED", label: "Dropped" },
];

export default function AddSeriesPage() {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("search");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<MALMangaResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<MALMangaResult | null>(null);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // Form fields (shared between search result and manual)
  const [link, setLink] = useState("");
  const [status, setStatus] = useState("READING");
  const [manualTitle, setManualTitle] = useState("");
  const [manualMediaType, setManualMediaType] = useState("MANGA");
  const [manualChapters, setManualChapters] = useState("");

  async function handleSearch() {
    if (query.length < 2) return;
    setLoading(true);
    setError("");
    setSelected(null);

    try {
      const res = await fetch(`/api/mal/search?q=${encodeURIComponent(query)}`);
      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Search failed");
        setResults([]);
        return;
      }

      setResults(data.results || []);
      if (data.results?.length === 0) {
        setError("No results found. Try a different search or add manually.");
      }
    } catch {
      setError("Failed to search. Check your connection.");
    } finally {
      setLoading(false);
    }
  }

  async function handleSubmit() {
    setSubmitting(true);
    setError("");

    const payload =
      tab === "search" && selected
        ? {
            malId: selected.id,
            title: selected.title,
            imageUrl: selected.main_picture?.large || selected.main_picture?.medium,
            synopsis: selected.synopsis,
            mediaType: selected.media_type,
            totalChapters: selected.num_chapters || null,
            totalVolumes: selected.num_volumes || null,
            link: link || null,
            status,
          }
        : {
            title: manualTitle,
            mediaType: manualMediaType,
            totalChapters: manualChapters ? parseInt(manualChapters) : null,
            link: link || null,
            status,
          };

    if (!payload.title) {
      setError("Title is required");
      setSubmitting(false);
      return;
    }

    try {
      const res = await fetch("/api/series", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Failed to add series");
        return;
      }

      router.push(`/series/${data.series.id}`);
      router.refresh();
    } catch {
      setError("Failed to add series");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Add Series</h1>

      {/* Tab switcher */}
      <div className="flex rounded-lg border border-card-border bg-card p-1">
        <button
          onClick={() => { setTab("search"); setError(""); }}
          className={`flex-1 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
            tab === "search"
              ? "bg-primary text-white"
              : "text-muted hover:text-foreground"
          }`}
        >
          Search MAL
        </button>
        <button
          onClick={() => { setTab("manual"); setError(""); }}
          className={`flex-1 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
            tab === "manual"
              ? "bg-primary text-white"
              : "text-muted hover:text-foreground"
          }`}
        >
          Manual Entry
        </button>
      </div>

      {error && (
        <div className="rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-400">
          {error}
        </div>
      )}

      {/* MAL Search tab */}
      {tab === "search" && (
        <div className="space-y-4">
          {/* Search input */}
          <div className="flex gap-2">
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSearch()}
              placeholder="Search manga, manhwa..."
              className="flex-1 rounded-lg border border-card-border bg-card px-3 py-2 text-sm outline-none focus:border-primary focus:ring-1 focus:ring-primary"
            />
            <button
              onClick={handleSearch}
              disabled={loading || query.length < 2}
              className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-primary-hover disabled:opacity-50"
            >
              {loading ? "..." : "Search"}
            </button>
          </div>

          {/* Search results */}
          {!selected && results.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs text-muted">{results.length} results</p>
              {results.map((result) => (
                <button
                  key={result.id}
                  onClick={() => setSelected(result)}
                  className="flex w-full gap-3 rounded-lg border border-card-border bg-card p-3 text-left transition-all hover:border-primary/30 hover:shadow-sm"
                >
                  <div className="relative h-16 w-11 flex-shrink-0 overflow-hidden rounded bg-slate-200 dark:bg-slate-700">
                    {result.main_picture?.medium ? (
                      <Image
                        src={result.main_picture.medium}
                        alt={result.title}
                        fill
                        className="object-cover"
                        sizes="44px"
                      />
                    ) : (
                      <div className="flex h-full items-center justify-center text-[8px] text-muted">
                        N/A
                      </div>
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <h3 className="truncate text-sm font-medium">
                      {result.title}
                    </h3>
                    <p className="text-xs text-muted">
                      {result.media_type} &middot;{" "}
                      {result.num_chapters
                        ? `${result.num_chapters} ch.`
                        : "Ongoing"}{" "}
                      {result.mean ? `&middot; ${result.mean} avg` : ""}
                    </p>
                    {result.synopsis && (
                      <p className="mt-1 line-clamp-2 text-xs text-secondary">
                        {result.synopsis}
                      </p>
                    )}
                  </div>
                </button>
              ))}
            </div>
          )}

          {/* Selected result detail */}
          {selected && (
            <div className="space-y-4">
              <div className="flex gap-3 rounded-lg border border-primary/30 bg-primary-light p-3">
                <div className="relative h-20 w-14 flex-shrink-0 overflow-hidden rounded bg-slate-200 dark:bg-slate-700">
                  {selected.main_picture?.medium ? (
                    <Image
                      src={selected.main_picture.medium}
                      alt={selected.title}
                      fill
                      className="object-cover"
                      sizes="56px"
                    />
                  ) : null}
                </div>
                <div className="min-w-0 flex-1">
                  <h3 className="text-sm font-semibold">{selected.title}</h3>
                  <p className="text-xs text-muted">
                    {selected.media_type} &middot;{" "}
                    {selected.num_chapters
                      ? `${selected.num_chapters} chapters`
                      : "Ongoing"}
                  </p>
                  <button
                    onClick={() => setSelected(null)}
                    className="mt-1 text-xs text-primary hover:underline"
                  >
                    Change selection
                  </button>
                </div>
              </div>

              <FormFields
                link={link}
                setLink={setLink}
                status={status}
                setStatus={setStatus}
              />

              <button
                onClick={handleSubmit}
                disabled={submitting}
                className="w-full rounded-lg bg-primary py-3 text-sm font-medium text-white transition-colors hover:bg-primary-hover disabled:opacity-50"
              >
                {submitting ? "Adding..." : "Add to Library"}
              </button>
            </div>
          )}
        </div>
      )}

      {/* Manual entry tab */}
      {tab === "manual" && (
        <div className="space-y-4">
          <div>
            <label className="mb-1 block text-xs font-medium text-secondary">
              Title *
            </label>
            <input
              type="text"
              value={manualTitle}
              onChange={(e) => setManualTitle(e.target.value)}
              placeholder="e.g. Solo Leveling"
              className="w-full rounded-lg border border-card-border bg-card px-3 py-2 text-sm outline-none focus:border-primary focus:ring-1 focus:ring-primary"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-secondary">
                Type
              </label>
              <select
                value={manualMediaType}
                onChange={(e) => setManualMediaType(e.target.value)}
                className="w-full rounded-lg border border-card-border bg-card px-3 py-2 text-sm outline-none focus:border-primary"
              >
                {MEDIA_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-secondary">
                Total Chapters
              </label>
              <input
                type="number"
                value={manualChapters}
                onChange={(e) => setManualChapters(e.target.value)}
                placeholder="Optional"
                className="w-full rounded-lg border border-card-border bg-card px-3 py-2 text-sm outline-none focus:border-primary focus:ring-1 focus:ring-primary"
              />
            </div>
          </div>

          <FormFields
            link={link}
            setLink={setLink}
            status={status}
            setStatus={setStatus}
          />

          <button
            onClick={handleSubmit}
            disabled={submitting || !manualTitle}
            className="w-full rounded-lg bg-primary py-3 text-sm font-medium text-white transition-colors hover:bg-primary-hover disabled:opacity-50"
          >
            {submitting ? "Adding..." : "Add to Library"}
          </button>
        </div>
      )}
    </div>
  );
}

function FormFields({
  link,
  setLink,
  status,
  setStatus,
}: {
  link: string;
  setLink: (v: string) => void;
  status: string;
  setStatus: (v: string) => void;
}) {
  return (
    <>
      <div>
        <label className="mb-1 block text-xs font-medium text-secondary">
          Reading Link
        </label>
        <input
          type="url"
          value={link}
          onChange={(e) => setLink(e.target.value)}
          placeholder="https://mangadex.org/..."
          className="w-full rounded-lg border border-card-border bg-card px-3 py-2 text-sm outline-none focus:border-primary focus:ring-1 focus:ring-primary"
        />
      </div>

      <div>
        <label className="mb-1 block text-xs font-medium text-secondary">
          Your Status
        </label>
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          className="w-full rounded-lg border border-card-border bg-card px-3 py-2 text-sm outline-none focus:border-primary"
        >
          {STATUSES.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
      </div>
    </>
  );
}
