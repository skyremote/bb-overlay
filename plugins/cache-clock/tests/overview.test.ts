import { describe, it, expect } from "vitest";
import { pickRecentClaudeThreads, sortOverview, type ClockStatus } from "../model";

const MIN = 60_000;
const now = 10_000 * MIN;
const s = (id: string, over: Partial<ClockStatus>): ClockStatus => ({
  threadId: id, supported: true, providerId: "claude-code", running: false, lastReplyAt: null,
  ttlMinutes: 60, expiresAt: null, usedTokens: null, keepWarm: null, keepWarmMaxHours: 2, handoff: null, now, ...over,
});

describe("rail page: thread pick", () => {
  it("keeps recent, unarchived Claude threads, newest first, capped", () => {
    const threads = [
      { id: "a", providerId: "claude-code", updatedAt: now - 5 * MIN, archivedAt: null },
      { id: "b", providerId: "codex", updatedAt: now - 1 * MIN, archivedAt: null },
      { id: "c", providerId: "claude-code", updatedAt: now - 1 * MIN, archivedAt: null },
      { id: "d", providerId: "claude-code", updatedAt: now - 10 * 60 * MIN, archivedAt: null },
      { id: "e", providerId: "claude-code", updatedAt: now - 2 * MIN, archivedAt: now },
      { id: "f", providerId: "claude-code", updatedAt: now - 3 * MIN, archivedAt: null },
    ];
    expect(pickRecentClaudeThreads(threads, now, 6 * 60 * MIN, 2).map((t) => t.id)).toEqual(["c", "f"]);
  });
});

describe("rail page: ordering", () => {
  it("running first, then warm soonest to go cold, then cold newest first", () => {
    const rows = [
      s("cold-old", { lastReplyAt: now - 300 * MIN, expiresAt: now - 240 * MIN }),
      s("warm-late", { lastReplyAt: now - 5 * MIN, expiresAt: now + 55 * MIN }),
      s("running", { running: true, lastReplyAt: now - 90 * MIN, expiresAt: now - 30 * MIN }),
      s("warm-soon", { lastReplyAt: now - 50 * MIN, expiresAt: now + 10 * MIN }),
      s("cold-new", { lastReplyAt: now - 70 * MIN, expiresAt: now - 10 * MIN }),
    ];
    expect(sortOverview(rows, now).map((r) => r.threadId)).toEqual(["running", "warm-soon", "warm-late", "cold-new", "cold-old"]);
  });
});
