import { describe, it, expect } from "vitest";
import { pickRailThreads, isActive, recentBatches, DAY_MS } from "../railmodel";
import type { HistoryBatch } from "../model";

const now = 1_000 * DAY_MS;
const agent = (state: "running" | "finished") => ({ state }) as never;
const batch = (key: string, endedAt: number, running = false, agents = 1): HistoryBatch => ({
  key, startedAt: endedAt - 60_000, endedAt, request: key, running,
  totals: { agents, tokens: 0, durationMs: 0, costUsd: null },
  agents: Array.from({ length: agents }, (_, i) => ({ id: key + i, name: "a", agentType: "g", model: "m", state: "finished", tokens: 0, steps: 0, durationMs: 0, colour: 0, summary: "", parentId: null })),
});

describe("Agents page: thread pick", () => {
  it("keeps unarchived threads from the last day, newest first, capped", () => {
    const t = [
      { id: "old", updatedAt: now - 2 * DAY_MS, archivedAt: null },
      { id: "a", updatedAt: now - 1000, archivedAt: null },
      { id: "arch", updatedAt: now - 10, archivedAt: now },
      { id: "b", updatedAt: now - 10, archivedAt: null },
      { id: "c", updatedAt: now - 5000, archivedAt: null },
    ];
    expect(pickRailThreads(t, now, DAY_MS, 2).map((x) => x.id)).toEqual(["b", "a"]);
  });
});

describe("Agents page: active filter", () => {
  it("is active only while the current batch has a running agent", () => {
    expect(isActive({ running: true, agents: [agent("finished"), agent("running")] })).toBe(true);
    expect(isActive({ running: true, agents: [agent("finished")] })).toBe(false);
    expect(isActive({ running: false, agents: [agent("running")] })).toBe(false);
    expect(isActive({ running: true, agents: [] })).toBe(false);
  });
});

describe("Agents page: recent runs", () => {
  it("lists finished batches from the last day across threads, newest first, capped", () => {
    const entries = [
      { threadId: "t1", batches: [batch("t1-new", now - 1000), batch("t1-old", now - 2 * DAY_MS), batch("t1-live", now, true)] },
      { threadId: "t2", batches: [batch("t2-mid", now - 5000), batch("t2-empty", now - 100, false, 0)] },
    ];
    expect(recentBatches(entries, now).map((r) => r.batch.key)).toEqual(["t1-new", "t2-mid"]);
    expect(recentBatches(entries, now, DAY_MS, 1).map((r) => r.batch.key)).toEqual(["t1-new"]);
  });
});
