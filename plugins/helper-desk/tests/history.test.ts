import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  FADE_MS, STALE_MS, buildBatches, effectiveState, emptyState, fmtWhen, liveVisibility, nextVisibilityChange,
  reduceEvents, restoreState, serialiseState, summariseBatch, type RawEvent,
} from "../model";

// A synthetic thread log (tests/fixtures/make-events.mjs), filtered to the event types the server asks bb for.
const TYPES = new Set(["client/turn/requested", "item/started", "item/completed", "item/delegation/completed", "item/backgroundTask/completed"]);
const raw = JSON.parse(readFileSync(new URL("./fixtures/events.json", import.meta.url), "utf8")) as RawEvent[];
const events = raw.filter((e) => TYPES.has(e.type));

describe("batch grouping on a synthetic thread log", () => {
  const state = reduceEvents(emptyState(), events);
  const batches = buildBatches(state);
  it("groups every agent into exactly one batch", () => {
    const total = batches.reduce((n, b) => n + b.agents.length, 0);
    expect(total).toBe(state.agents.size);
    expect(state.agents.size).toBe(22); // 21 background agents plus one foreground check
  });
  it("orders batches newest first, each keyed by the user request that launched it", () => {
    for (let i = 1; i < batches.length; i++) expect(batches[i - 1].seq).toBeGreaterThan(batches[i].seq);
    for (const b of batches) {
      expect(b.agents.every((a) => a.groupSeq === b.seq)).toBe(true);
      expect(b.request.length).toBeGreaterThan(0);
    }
    expect(batches.length).toBeGreaterThan(3);
  });
  it("summarises totals per batch", () => {
    const now = raw.at(-1)!.createdAt + 60_000;
    const s = summariseBatch(batches[0], now, () => ({ tokens: 0, model: "Opus 5.5", steps: 0, costUsd: null, lastLifeAt: 0 }));
    expect(s.totals.agents).toBe(batches[0].agents.length);
    expect(s.totals.tokens).toBe(s.agents.reduce((n, a) => n + a.tokens, 0));
    expect(s.totals.costUsd).toBeNull();
    expect(s.endedAt).toBeGreaterThanOrEqual(s.startedAt);
    const folding = buildBatches(state).flatMap((b) => b.agents).find((a) => a.name === "Draft the onboarding guide")!;
    expect(folding.summary.length).toBeGreaterThan(400); // full result summary kept for "Show more"
  });
  it("round-trips through the history cache", () => {
    const back = restoreState(serialiseState(state))!;
    expect(back.afterSeq).toBe(state.afterSeq);
    expect(buildBatches(back).map((b) => [b.seq, b.agents.length])).toEqual(batches.map((b) => [b.seq, b.agents.length]));
    expect(JSON.stringify(serialiseState(state)).length).toBeLessThan(240_000);
  });
  it("continues incrementally from a restored cache", () => {
    const half = events.filter((e) => e.seq <= Math.floor(raw.at(-1)!.seq / 2));
    const restored = restoreState(serialiseState(reduceEvents(emptyState(), half)))!;
    reduceEvents(restored, events.filter((e) => e.seq > restored.afterSeq));
    expect(buildBatches(restored).map((b) => b.agents.length)).toEqual(batches.map((b) => b.agents.length));
  });
});

describe("auto-hide timing", () => {
  const base = { running: false, hasContent: true, endedAt: 10_000, autoHide: true, delayMs: 8000 };
  it("keeps finished cards for the delay, fades, then hides", () => {
    expect(liveVisibility({ ...base, now: 10_000 })).toBe("live");
    expect(liveVisibility({ ...base, now: 17_999 })).toBe("live");
    expect(liveVisibility({ ...base, now: 18_000 })).toBe("fading");
    expect(liveVisibility({ ...base, now: 18_000 + FADE_MS - 1 })).toBe("fading");
    expect(liveVisibility({ ...base, now: 18_000 + FADE_MS })).toBe("hidden");
  });
  it("never hides while anything runs, when switched off, or with nothing to show", () => {
    expect(liveVisibility({ ...base, running: true, now: 99_999 })).toBe("live");
    expect(liveVisibility({ ...base, autoHide: false, now: 99_999 })).toBe("live");
    expect(liveVisibility({ ...base, hasContent: false, now: 0 })).toBe("empty");
  });
  it("is immediately hidden when a thread is opened long after its batch ended", () => {
    expect(liveVisibility({ ...base, now: 10_000 + 3_600_000 })).toBe("hidden");
  });
  it("honours a configured delay and says when to wake next", () => {
    expect(liveVisibility({ ...base, delayMs: 2000, now: 12_100 })).toBe("fading");
    expect(nextVisibilityChange({ ...base, now: 15_000 })).toBe(3000);
    expect(nextVisibilityChange({ ...base, now: 18_100 })).toBe(FADE_MS - 100);
    expect(nextVisibilityChange({ ...base, now: 30_000 })).toBeNull();
    expect(nextVisibilityChange({ ...base, running: true, now: 15_000 })).toBeNull();
  });
});

describe("interrupted and time labels", () => {
  it("treats a running agent with no sign of life for 30 minutes as interrupted", () => {
    expect(effectiveState({ state: "running", lastActivityAt: 0 }, STALE_MS - 1)).toBe("running");
    expect(effectiveState({ state: "running", lastActivityAt: 0 }, STALE_MS + 1)).toBe("interrupted");
    expect(effectiveState({ state: "running", lastActivityAt: 0 }, STALE_MS + 1, STALE_MS)).toBe("running");
    expect(effectiveState({ state: "finished", lastActivityAt: 0 }, 9e12)).toBe("finished");
  });
  it("maps a stopped background agent to interrupted", () => {
    const s = reduceEvents(emptyState(), [
      { seq: 1, type: "item/delegation/completed", createdAt: 1, data: { item: { type: "delegation", id: "d1", label: "A", status: "completed", background: true, summary: "" } } },
      { seq: 2, type: "item/backgroundTask/completed", createdAt: 5, data: { item: { type: "backgroundTask", taskType: "local_agent", parentToolCallId: "d1", taskStatus: "killed", summary: "stopped" } } },
    ]);
    expect(s.agents.get("d1")!.state).toBe("interrupted");
  });
  it("labels Today, Yesterday and older dates in British style", () => {
    const now = new Date(2026, 9, 22, 16, 0).getTime();
    expect(fmtWhen(new Date(2026, 9, 22, 14, 32).getTime(), now)).toBe("Today 14:32");
    expect(fmtWhen(new Date(2026, 9, 21, 9, 10).getTime(), now)).toBe("Yesterday 09:10");
    expect(fmtWhen(new Date(2026, 9, 19, 8, 5).getTime(), now)).toBe("Mon 19 Oct 08:05");
  });
});

describe("batch boundaries", () => {
  it("starts a new batch for user and agent requests, not for system notices", () => {
    const d = (id: string) => ({ type: "item/delegation/completed", createdAt: 1, data: { item: { type: "delegation", id, label: id, status: "completed", background: true, summary: "" } } });
    const s = reduceEvents(emptyState(), [
      { seq: 1, type: "client/turn/requested", createdAt: 1, data: { initiator: "user", input: [{ type: "text", text: "First" }] } },
      { seq: 2, ...d("a") },
      { seq: 3, type: "client/turn/requested", createdAt: 2, data: { initiator: "system", input: [{ type: "text", text: "child completed" }] } },
      { seq: 4, ...d("b") },
      { seq: 5, type: "client/turn/requested", createdAt: 3, data: { initiator: "agent", input: [{ type: "text", text: "[bb message from thread:thr_x]  Second" }] } },
      { seq: 6, ...d("c") },
    ] as RawEvent[]);
    const batches = buildBatches(s);
    expect(batches.map((b) => b.agents.map((a) => a.id))).toEqual([["c"], ["a", "b"]]);
    expect(batches[0].request).toBe("Second");
  });
});
