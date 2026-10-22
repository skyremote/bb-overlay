// Left-rail "Agents" page: which threads to read and how to split them into
// "running now" and "finished in the last day". Pure, so it is unit-tested.
import { z } from "zod";
import { historyBatchSchema, snapshotSchema, type DeskSnapshot, type HistoryBatch } from "./model";

export const DAY_MS = 24 * 60 * 60 * 1000;
export const RAIL_MAX_THREADS = 20;
export const RAIL_MAX_RECENT = 15;

export const railOverviewSchema = z.object({
  active: z.array(z.object({ threadId: z.string(), title: z.string(), snapshot: snapshotSchema })).max(RAIL_MAX_THREADS),
  recent: z
    .array(z.object({ threadId: z.string(), title: z.string(), model: z.string(), batch: historyBatchSchema }))
    .max(RAIL_MAX_RECENT),
  scanned: z.number(),
  updatedAt: z.number(),
});
export type RailOverview = z.infer<typeof railOverviewSchema>;

/** Threads touched within the window, newest first, capped. Archived threads never count. */
export function pickRailThreads<T extends { id: string; updatedAt: number; archivedAt?: number | null; status?: string }>(
  threads: readonly T[],
  now: number,
  windowMs = DAY_MS,
  max = RAIL_MAX_THREADS,
): T[] {
  return threads
    .filter((t) => !t.archivedAt && now - t.updatedAt <= windowMs)
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, max);
}

/** A thread is "running now" when its current batch still has an agent running. */
export function isActive(snapshot: Pick<DeskSnapshot, "running" | "agents">): boolean {
  return snapshot.running && snapshot.agents.some((a) => a.state === "running");
}

/** Finished batches that ended inside the window, newest first, capped. */
export function recentBatches<E extends { threadId: string; batches: HistoryBatch[] }>(
  entries: readonly E[],
  now: number,
  windowMs = DAY_MS,
  max = RAIL_MAX_RECENT,
): Array<{ entry: E; batch: HistoryBatch }> {
  const out: Array<{ entry: E; batch: HistoryBatch }> = [];
  for (const entry of entries)
    for (const batch of entry.batches)
      if (!batch.running && batch.agents.length > 0 && now - batch.endedAt <= windowMs) out.push({ entry, batch });
  return out.sort((a, b) => b.batch.endedAt - a.batch.endedAt).slice(0, max);
}
