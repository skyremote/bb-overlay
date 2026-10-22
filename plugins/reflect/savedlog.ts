// The "Saved rules" log shown in the Reflect panel tab: every rule Reflect has
// written, newest last in storage, newest first on screen.
import { z } from "zod";

export const savedEntrySchema = z.object({
  rule: z.string(),
  target: z.enum(["voice", "claude", "brain"]),
  status: z.enum(["saved", "exists"]),
  where: z.string(),
  threadId: z.string(),
  at: z.number(),
});
export type SavedEntry = z.infer<typeof savedEntrySchema>;

export const SAVED_LOG_MAX = 200;

/** Parse whatever is in storage, dropping malformed rows rather than failing. */
export function readLog(raw: unknown): SavedEntry[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((row) => {
    const parsed = savedEntrySchema.safeParse(row);
    return parsed.success ? [parsed.data] : [];
  });
}

export function appendLog(log: SavedEntry[], entry: SavedEntry): SavedEntry[] {
  return [...log, entry].slice(-SAVED_LOG_MAX);
}

export function newestFirst(log: SavedEntry[], limit: number): SavedEntry[] {
  return [...log].sort((a, b) => b.at - a.at).slice(0, Math.max(0, limit));
}

/** Rules actually written (not "already there") since local midnight of `now`. */
export function countToday(log: SavedEntry[], now: number): number {
  const d = new Date(now);
  const midnight = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  return log.filter((e) => e.status === "saved" && e.at >= midnight && e.at <= now).length;
}
