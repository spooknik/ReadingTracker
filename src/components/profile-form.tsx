"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface ProfileFormProps {
  currentName: string;
}

interface CleanupResponse {
  removedReaderProgress: number;
  resetUnsupportedRips: number;
}

const READER_ENABLED = process.env.NEXT_PUBLIC_ENABLE_READER === "1";

export function ProfileForm({ currentName }: ProfileFormProps) {
  const router = useRouter();
  const [name, setName] = useState(currentName);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const [cleaning, setCleaning] = useState(false);
  const [cleanupResult, setCleanupResult] = useState<CleanupResponse | null>(null);

  const hasChanges = name.trim() !== currentName;

  async function handleSave() {
    if (!hasChanges) return;
    setSaving(true);
    setError("");
    setSaved(false);

    try {
      const res = await fetch("/api/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ displayName: name.trim() }),
      });

      if (!res.ok) {
        const data = await res.json();
        setError(data.error || "Failed to save");
        return;
      }

      setSaved(true);
      router.refresh();
      setTimeout(() => setSaved(false), 2000);
    } catch {
      setError("Failed to save");
    } finally {
      setSaving(false);
    }
  }

  async function handleCleanupUnsupportedReaderData() {
    setCleaning(true);
    setError("");
    setCleanupResult(null);

    try {
      const res = await fetch("/api/profile", {
        method: "DELETE",
      });

      const data = await res.json().catch(() => {
        return {};
      });

      if (!res.ok) {
        setError(data.error || "Failed to cleanup reader data");
        return;
      }

      setCleanupResult({
        removedReaderProgress: data.removedReaderProgress || 0,
        resetUnsupportedRips: data.resetUnsupportedRips || 0,
      });
      router.refresh();
    } catch {
      setError("Failed to cleanup reader data");
    } finally {
      setCleaning(false);
    }
  }

  return (
    <div className="space-y-3">
      <div>
        <label className="mb-1 block text-xs font-medium text-secondary">
          Display Name
        </label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={30}
          className="w-full rounded-lg border border-card-border bg-background px-3 py-2 text-sm outline-none focus:border-primary focus:ring-1 focus:ring-primary"
        />
      </div>

      {error && (
        <p className="text-xs text-red-600 dark:text-red-400">{error}</p>
      )}

      <button
        onClick={handleSave}
        disabled={saving || !hasChanges}
        className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-primary-hover disabled:opacity-50"
      >
        {saving ? "Saving..." : saved ? "Saved!" : "Save"}
      </button>

      {READER_ENABLED && (
        <div className="space-y-1 rounded-lg border border-card-border p-3">
          <p className="text-xs text-muted">
            If supported links were removed or changed, you can clear stale reader state for unsupported entries.
          </p>
          <button
            type="button"
            onClick={handleCleanupUnsupportedReaderData}
            disabled={cleaning}
            className="rounded-lg border border-card-border px-3 py-1.5 text-xs font-medium transition-colors hover:bg-slate-50 disabled:opacity-50 dark:hover:bg-slate-800"
          >
            {cleaning ? "Cleaning..." : "Cleanup Unsupported Reader Data"}
          </button>
          {cleanupResult && (
            <p className="text-xs text-muted">
              Removed {cleanupResult.removedReaderProgress} reader progress rows and reset {cleanupResult.resetUnsupportedRips} unsupported rip records.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
