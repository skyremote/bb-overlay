import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  agentProgress, currentGroup, describeTool, emptyState, emptyTranscript, feedTranscript,
  fmtDuration, fmtTokens, parseDetail, parseOutputFile, parseUsageBlock, reduceEvents, todoProgress, type RawEvent,
} from "../model";

const events: RawEvent[] = JSON.parse(readFileSync(new URL("./fixtures/events.json", import.meta.url), "utf8"));

describe("todo progress", () => {
  it("counts done, percentage and the current step", () => {
    const p = todoProgress([
      { id: "1", text: "Research the topic", status: "completed" },
      { id: "2", text: "Write the pre-outline", status: "in_progress" },
      { id: "3", text: "Write the script", status: "pending" },
      { id: "4", text: "Make 3 thumbnails", status: "completed" },
      { id: "5", text: "Plan the motion graphics", status: "pending" },
    ]);
    expect(p).toEqual({ done: 2, total: 5, pct: 40, now: "Write the pre-outline" });
  });
  it("handles an empty list", () => {
    expect(todoProgress([])).toEqual({ done: 0, total: 0, pct: 0, now: null });
  });
});

describe("agent parsing from a synthetic thread log", () => {
  const state = reduceEvents(emptyState(), events);
  const agents = [...state.agents.values()];
  it("finds every delegation", () => {
    expect(agents.length).toBeGreaterThanOrEqual(18);
  });
  it("marks background agents running at launch and finished on backgroundTask completion", () => {
    const folding = agents.find((a) => a.name === "Draft the onboarding guide")!;
    expect(folding.background).toBe(true);
    expect(folding.state).toBe("finished");
    expect(folding.finalUsage).toEqual({ totalTokens: 188565, toolUses: 58, durationMs: 519945 });
    expect(folding.outputFile).toMatch(/\.output$/);
    expect(folding.agentType).toBe("general-purpose");
  });
  it("is incremental: replaying nothing new changes nothing", () => {
    const before = state.agents.size;
    reduceEvents(state, events.filter((e) => e.seq > state.afterSeq));
    expect(state.agents.size).toBe(before);
  });
  it("groups the latest batch by user request", () => {
    const group = currentGroup(state);
    expect(group.length).toBeGreaterThan(0);
    const seq = group[0].groupSeq;
    expect(group.every((a) => a.groupSeq === seq)).toBe(true);
  });
  it("a launch without completion stays running", () => {
    const s = reduceEvents(emptyState(), [
      { seq: 1, type: "client/turn/requested", createdAt: 1, data: { initiator: "user", input: [{ type: "text", text: "Go" }] } },
      { seq: 2, type: "item/delegation/completed", createdAt: 2, data: { item: { type: "delegation", id: "d1", label: "Research", status: "completed", background: true, summary: "output_file: /tmp/x/tasks/abc.output\n", presentation: { detail: "Explore agent · model sonnet" } } } },
    ]);
    const a = s.agents.get("d1")!;
    expect(a.state).toBe("running");
    expect(a.outputFile).toBe("/tmp/x/tasks/abc.output");
    expect(a.agentType).toBe("Explore");
    expect(a.model).toBe("sonnet");
  });
  it("finishes a foreground delegation and reads its usage block", () => {
    const s = reduceEvents(emptyState(), [
      { seq: 1, type: "item/started", createdAt: 1, data: { item: { type: "delegation", id: "f1", label: "Script", status: "pending", background: false } } },
      { seq: 2, type: "item/completed", createdAt: 9, data: { item: { type: "delegation", id: "f1", label: "Script", status: "completed", background: false, summary: "Wrote script.md\n<usage>total_tokens: 241000\ntool_uses: 6\nduration_ms: 201000</usage>" } } },
    ]);
    const a = s.agents.get("f1")!;
    expect(a.state).toBe("finished");
    expect(a.finalUsage?.totalTokens).toBe(241000);
    expect(a.summary).toBe("Wrote script.md");
  });
});

describe("JSONL usage parsing", () => {
  const text = readFileSync(new URL("./fixtures/agent.jsonl", import.meta.url), "utf8");
  it("tracks latest context tokens, steps, model and recent actions", () => {
    const t = feedTranscript(emptyTranscript(), text, Buffer.byteLength(text));
    expect(t.steps).toBe(3);
    expect(t.model).toBe("claude-opus-5-5");
    expect(t.tokens).toBe(3 + 0 + 21600 + 10);
    expect(t.recent).toEqual(["Reading research.md", "Writing pre-outline.md", "Ranking 10 angles"]);
    expect(t.costUsd).toBeGreaterThan(0);
  });
  it("copes with a line split across reads", () => {
    const cut = text.length - 40;
    const t = emptyTranscript();
    feedTranscript(t, text.slice(0, cut), Buffer.byteLength(text.slice(0, cut)));
    expect(t.steps).toBe(2);
    feedTranscript(t, text.slice(cut), Buffer.byteLength(text.slice(cut)));
    expect(t.steps).toBe(3);
    expect(t.offset).toBe(Buffer.byteLength(text));
  });
  it("counts a repeated message id's usage once", () => {
    const t = feedTranscript(emptyTranscript(), text, Buffer.byteLength(text));
    const once = feedTranscript(emptyTranscript(), text.split("\n").filter((l) => !l.includes('"text":"thinking"')).join("\n"), 1);
    expect(t.costUsd).toBeCloseTo(once.costUsd, 10);
  });
});

describe("helpers", () => {
  it("parses detail, output file and usage", () => {
    expect(parseDetail("general-purpose agent")).toEqual({ agentType: "general-purpose", model: "" });
    expect(parseOutputFile("x\noutput_file: /a/b/c.output\nDo NOT")).toBe("/a/b/c.output");
    expect(parseUsageBlock("nothing")).toBeNull();
  });
  it("formats tokens and durations like the video", () => {
    expect(fmtTokens(143_400)).toBe("143k");
    expect(fmtTokens(1_100_000)).toBe("1.1M");
    expect(fmtDuration(126_000)).toBe("2:06");
  });
  it("caps running progress at 95%", () => {
    expect(agentProgress("running", 4)).toBe(0.5);
    expect(agentProgress("running", 40)).toBe(0.95);
    expect(agentProgress("finished", 1)).toBe(1);
  });
  it("describes tools in plain English", () => {
    expect(describeTool("WebSearch", { query: "Claude Projects" })).toBe("Searching the web: Claude Projects");
    expect(describeTool("mcp__brain__note_add", {})).toBe("Using note add");
  });
});

describe("sub-agent items streamed into the parent thread", () => {
  it("counts steps and labels them for the owning agent", () => {
    const s = reduceEvents(emptyState(), [
      { seq: 1, type: "item/delegation/completed", createdAt: 1, data: { item: { type: "delegation", id: "d1", label: "Thumbnails", status: "completed", background: true, summary: "" } } },
      { seq: 2, type: "item/started", createdAt: 2, data: { item: { type: "fileRead", id: "x1", path: "/tmp/a/style-guide.md", parentToolCallId: "d1" } } },
      { seq: 3, type: "item/started", createdAt: 3, data: { item: { type: "commandExecution", id: "x2", command: "cd /tmp && ls", parentToolCallId: "d1", presentation: { title: "cd /tmp && ls" } } } },
      { seq: 4, type: "item/started", createdAt: 4, data: { item: { type: "fileChange", id: "x3", changes: [{ path: "/tmp/out/thumbnails.md", kind: "add" }], parentToolCallId: "d1" } } },
    ]);
    const a = s.agents.get("d1")!;
    expect(a.childSteps).toBe(3);
    expect(a.childRecent).toEqual(["Reading style-guide.md", "Running a command", "Writing thumbnails.md"]);
  });
});

describe("taskbar source", () => {
  it("falls back to the sub-agent batch when there is no to-do list", async () => {
    const { taskbarProgress } = await import("../model");
    const agent = (id: string, state: "running" | "finished") => ({ id, name: id, agentType: "general-purpose", model: "Sonnet 5.5", state, background: true, startedAt: 0, finishedAt: null, tokens: 0, steps: 2, stepLabel: "Step 2 · Reading README.md", details: [], progress: 0.25, colour: 0, summary: "" });
    const p = taskbarProgress({ todos: [], agents: [agent("File counter", "finished"), agent("Readme reader", "running")] })!;
    expect(p).toMatchObject({ label: "Agents", done: 1, total: 2, pct: 50, now: "Readme reader · Step 2 · Reading README.md" });
    expect(taskbarProgress({ todos: [], agents: [] })).toBeNull();
    expect(taskbarProgress({ todos: [{ id: "1", text: "A", status: "completed" }], agents: [] })!.label).toBe("Tasks");
  });
});
