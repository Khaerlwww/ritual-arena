export function normalizeRitualTimestamp(value?: number | bigint | null): number | null {
  if (value === undefined || value === null) return null;
  const n = typeof value === "bigint" ? Number(value) : Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  if (n > 1_000_000_000_000) return n; // already milliseconds
  if (n > 1_000_000_000) return n * 1000; // seconds -> milliseconds
  return null;
}

export function formatRitualDate(value?: number | bigint | null): string {
  const ms = normalizeRitualTimestamp(value);
  return ms ? new Date(ms).toLocaleDateString() : "—";
}

export function formatRitualDateTime(value?: number | bigint | null): string {
  const ms = normalizeRitualTimestamp(value);
  return ms ? new Date(ms).toLocaleString() : "—";
}
