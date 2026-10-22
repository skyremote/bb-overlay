import { describe, expect, it } from "vitest";
import { appendLog, countToday, newestFirst, readLog, SAVED_LOG_MAX, type SavedEntry } from "../savedlog";

const e = (at: number, status: SavedEntry["status"] = "saved", rule = `rule ${at}`): SavedEntry => ({
  rule, target: "claude", status, where: "~/.claude/CLAUDE.md", threadId: "thr_test", at,
});

describe("saved-rules log", () => {
  it("drops malformed rows when reading storage", () => {
    expect(readLog(undefined)).toEqual([]);
    expect(readLog([e(1), { rule: 3 }, null, e(2)])).toEqual([e(1), e(2)]);
  });
  it("appends newest last and caps the log", () => {
    let log: SavedEntry[] = [];
    for (let i = 0; i < SAVED_LOG_MAX + 15; i++) log = appendLog(log, e(i));
    expect(log).toHaveLength(SAVED_LOG_MAX);
    expect(log[0].at).toBe(15);
  });
  it("lists newest first with a limit", () => {
    expect(newestFirst([e(1), e(3), e(2)], 2).map((x) => x.at)).toEqual([3, 2]);
  });
  it("counts only rules written since local midnight", () => {
    const now = new Date(2026, 9, 22, 15, 0).getTime();
    const midnight = new Date(2026, 9, 22).getTime();
    const log = [e(midnight - 1), e(midnight + 10), e(now - 5, "exists"), e(now - 1)];
    expect(countToday(log, now)).toBe(2);
  });
});
