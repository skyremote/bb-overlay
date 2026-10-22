import { describe, expect, it } from "vitest";
import { cacheClockLine, countdown, deskLine, reflectLine, screenShareLine } from "../hubmodel";

const clock = (over: Partial<Parameters<typeof cacheClockLine>[0] & object> = {}) => ({
  supported: true, running: false, lastReplyAt: 0, expiresAt: 60 * 60_000, now: 0, keepWarm: null, ...over,
});

describe("Mods hub status lines", () => {
  it("Helper Desk counts running agents", () => {
    expect(deskLine(1, true)).toEqual({ text: "1 running", tone: "on" });
    expect(deskLine(0, false).text).toBe("No agents running");
  });
  it("Screen share shows on, off or missing", () => {
    expect(screenShareLine({ enabled: true })).toEqual({ text: "On for every screen", tone: "on" });
    expect(screenShareLine({ enabled: false }).text).toBe("Off");
    expect(screenShareLine(null).tone).toBe("missing");
  });
  it("Cache clock shows the countdown, cold, running and keep-warm", () => {
    expect(countdown(42 * 60_000 + 10_000)).toBe("42:10");
    expect(cacheClockLine(clock({ expiresAt: 42 * 60_000 + 10_000 }), 0)).toEqual({ text: "Warm 42:10", tone: "warm" });
    expect(cacheClockLine(clock({ expiresAt: 1000 }), 5000).tone).toBe("cold");
    expect(cacheClockLine(clock({ running: true }), 0).text).toBe("Turn running");
    expect(cacheClockLine(clock({ keepWarm: { enabled: true } }), 0).text).toContain("keeping warm");
    expect(cacheClockLine(clock({ supported: false }), 0).text).toBe("Claude Code threads only");
    expect(cacheClockLine(null, 0).tone).toBe("missing");
  });
  it("applies the server clock offset", () => {
    expect(cacheClockLine(clock({ expiresAt: 10_000 }), 0, 5_000).text).toBe("Warm 0:05");
  });
  it("Reflect counts rules saved today", () => {
    expect(reflectLine({ today: 2, total: 5 }).text).toBe("2 rules saved today");
    expect(reflectLine({ today: 1, total: 1 }).text).toBe("1 rule saved today");
    expect(reflectLine({ today: 0, total: 3 }).text).toBe("3 saved in total");
    expect(reflectLine({ today: 0, total: 0 }).text).toBe("No rules saved yet");
  });
});
