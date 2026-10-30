import { describe, expect, it } from "vitest";
import { freshProgress, parseProgress, storageKey, transition } from "../lib/state";
import { stepIds } from "../lib/steps";
const start = () => transition(freshProgress("pro", "1"), { kind: "start" }, 10, () => "run-1").progress;
describe("explicit guide progress policy", () => {
  it("offers once, including after dismissal and installer reruns", () => {
    const offered = transition(freshProgress("pro", "1"), { kind: "offer" }, 1, () => "r");
    expect(offered.offered).toBe(true);
    const closed = transition(offered.progress, { kind: "close", runId: "" }, 2, () => "r").progress;
    expect(transition(closed, { kind: "offer" }, 3, () => "r").offered).toBe(false);
  });
  it("does not advance without an explicit read acknowledgement", () => {
    const p = start(); expect(() => transition(p, { kind: "move", runId: p.runId, direction: "next" }, 20, () => "r")).toThrow(/explicitly tick/);
    expect(p.reviewed).toEqual({});
  });
  it("preserves reviewed steps on Back, close and resume", () => {
    let p = start(); const id = stepIds("pro")[0]!;
    p = transition(p, { kind: "review", runId: p.runId, stepId: id, checked: true, availability: "visible" }, 20, () => "r").progress;
    p = transition(p, { kind: "move", runId: p.runId, direction: "next" }, 21, () => "r").progress;
    p = transition(p, { kind: "close", runId: p.runId }, 22, () => "r").progress;
    p = transition(p, { kind: "start" }, 23, () => "r").progress;
    expect(p.index).toBe(1);
    p = transition(p, { kind: "move", runId: p.runId, direction: "back" }, 24, () => "r").progress;
    expect(p.reviewed[id]?.at).toBe(20);
  });
  it("retains historical completion when replay clears the current run", () => {
    let p = start();
    for (const [i, id] of stepIds("pro").entries()) {
      p = transition(p, { kind: "review", runId: p.runId, stepId: id, checked: true, availability: i === 5 ? "unavailable" : "visible" }, 100 + i, () => "r").progress;
      p = transition(p, { kind: "move", runId: p.runId, direction: "next" }, 200 + i, () => "r").progress;
    }
    expect(p.status).toBe("completed"); expect(p.history.completedRuns).toBe(1); expect(p.history.lastUnavailableSteps).toEqual(["helper-desk"]);
    const replay = transition(p, { kind: "replay" }, 400, () => "run-2").progress;
    expect(replay.reviewed).toEqual({}); expect(replay.index).toBe(0); expect(replay.runId).toBe("run-2"); expect(replay.history).toEqual(p.history);
  });
  it("rejects stale windows and acknowledging another step", () => {
    const p = start();
    expect(() => transition(p, { kind: "review", runId: "stale", stepId: "navigation", checked: true, availability: "visible" }, 2, () => "r")).toThrow(/another window/);
    expect(() => transition(p, { kind: "review", runId: p.runId, stepId: "settings", checked: true, availability: "visible" }, 2, () => "r")).toThrow(/not the current/);
  });
  it("can untick a read check and will block Next again", () => {
    let p = start(); p = transition(p, { kind: "review", runId: p.runId, stepId: "navigation", checked: true, availability: "visible" }, 2, () => "r").progress;
    p = transition(p, { kind: "review", runId: p.runId, stepId: "navigation", checked: false, availability: "visible" }, 3, () => "r").progress;
    expect(() => transition(p, { kind: "move", runId: p.runId, direction: "next" }, 4, () => "r")).toThrow();
  });
  it("isolates editions and versions, validates persisted state", () => {
    expect(storageKey("simple", "1")).not.toBe(storageKey("pro", "1")); expect(storageKey("pro", "1")).not.toBe(storageKey("pro", "2"));
    expect(parseProgress({ wrong: true }, "pro", "1")).toEqual(freshProgress("pro", "1"));
    expect(parseProgress(start(), "simple", "1").edition).toBe("simple");
  });
});
