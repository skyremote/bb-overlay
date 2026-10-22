import { describe, it, expect } from "vitest";
import {
  decideKeepWarm, expiresAt, extractHandoff, formatCountdown, formatTokens, fractionLeft,
  handoffPrompt, isPingText, nextPingAt, remainingMs, PING_TEXT, type KeepWarm,
} from "../model";

const MIN = 60_000;
const base: KeepWarm = { enabled: true, startedAt: 0, pings: 0, lastPingAt: null, lastPingForReplyAt: null, lastPingCachedTokens: null, stoppedReason: null };

describe("countdown maths", () => {
  it("expires one TTL after the last reply", () => {
    expect(expiresAt(1000, 60)).toBe(1000 + 60 * MIN);
    expect(expiresAt(null, 60)).toBeNull();
  });
  it("formats mm:ss and h:mm:ss, never negative", () => {
    expect(formatCountdown(59 * MIN + 55_000)).toBe("59:55");
    expect(formatCountdown(61 * MIN)).toBe("1:01:00");
    expect(formatCountdown(-5)).toBe("00:00");
    expect(formatCountdown(400)).toBe("00:01");
  });
  it("drains the bar from 1 to 0", () => {
    const exp = expiresAt(0, 60)!;
    expect(fractionLeft(exp, 60, 0)).toBe(1);
    expect(fractionLeft(exp, 60, 30 * MIN)).toBeCloseTo(0.5);
    expect(fractionLeft(exp, 60, 90 * MIN)).toBe(0);
    expect(remainingMs(exp, 90 * MIN)).toBe(0);
  });
  it("formats token counts", () => {
    expect(formatTokens(214_300)).toBe("214k");
    expect(formatTokens(1_250_000)).toBe("1.3M");
    expect(formatTokens(null)).toBe("the");
  });
});

describe("keep-warm scheduling", () => {
  const args = (over: Partial<Parameters<typeof decideKeepWarm>[0]>) => ({ keepWarm: base, lastReplyAt: 0, ttlMinutes: 60, maxHours: 2, running: false, now: 0, ...over });
  it("waits until two minutes before expiry, then pings", () => {
    expect(decideKeepWarm(args({ now: 57 * MIN })).action).toBe("wait");
    expect(decideKeepWarm(args({ now: 58 * MIN })).action).toBe("ping");
    expect(nextPingAt(0, 60)).toBe(58 * MIN);
  });
  it("pings only once per reply", () => {
    expect(decideKeepWarm(args({ now: 59 * MIN, keepWarm: { ...base, lastPingForReplyAt: 0, lastPingAt: 58 * MIN } })).action).toBe("wait");
    // the ping's reply moves lastReplyAt forward, so the next cycle pings again
    expect(decideKeepWarm(args({ lastReplyAt: 59 * MIN, now: 117 * MIN, keepWarm: { ...base, startedAt: 30 * MIN, lastPingForReplyAt: 0, lastPingAt: 58 * MIN } })).action).toBe("ping");
  });
  it("never pings while running or when off", () => {
    expect(decideKeepWarm(args({ now: 59 * MIN, running: true })).action).toBe("wait");
    expect(decideKeepWarm(args({ now: 59 * MIN, keepWarm: { ...base, enabled: false } })).action).toBe("wait");
  });
  it("stops after the time limit", () => {
    expect(decideKeepWarm(args({ now: 2 * 60 * MIN }))).toEqual({ action: "stop", reason: "time-limit" });
  });
  it("uses a shorter lead on a 5 minute cache", () => {
    expect(decideKeepWarm(args({ ttlMinutes: 5, now: 3 * MIN })).action).toBe("wait");
    expect(decideKeepWarm(args({ ttlMinutes: 5, now: 3.4 * MIN })).action).toBe("ping");
  });
});

describe("handoff extraction", () => {
  it("takes the last handoff block and trims it", () => {
    const text = "Sure.\n<handoff>\nold\n</handoff>\nThen\n<handoff>\n## Goal\nShip it\n</handoff>";
    expect(extractHandoff(text)).toBe("## Goal\nShip it");
  });
  it("returns null without a block or with an empty one", () => {
    expect(extractHandoff("no tags here")).toBeNull();
    expect(extractHandoff("<handoff>  </handoff>")).toBeNull();
    expect(extractHandoff(null)).toBeNull();
  });
  it("builds the new-thread prompt with a thread mention", () => {
    expect(handoffPrompt("thr_abc", "Brief")).toBe("Continue from @thread:thr_abc\n\nBrief");
  });
  it("recognises its own ping", () => {
    expect(isPingText(PING_TEXT)).toBe(true);
    expect(isPingText("hello")).toBe(false);
  });
});

describe("appendPingLog", () => {
  it("appends newest last and caps at 50", async () => {
    const { appendPingLog } = await import("../model");
    let log = appendPingLog(undefined, 1, 100);
    expect(log).toEqual([{ at: 1, cachedTokens: 100 }]);
    for (let i = 2; i <= 60; i++) log = appendPingLog(log, i, null);
    expect(log).toHaveLength(50);
    expect(log[0].at).toBe(11);
    expect(log.at(-1)).toEqual({ at: 60, cachedTokens: null });
  });
});
