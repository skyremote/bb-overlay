import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildBatches, commandActivity, emptyState, leadActivity, orchestratorState, reduceEvents, type RawEvent } from "../model";

describe("orchestrator state mapping", () => {
  const lead = (itemType: string, label: string, done = false) => ({ itemType, label, at: 1, done });
  it("is working while bb reports the thread active, with the latest item as activity", () => {
    expect(orchestratorState({ threadStatus: "active", pendingInteractions: 0, lead: lead("commandExecution", "Running install.sh") })).toEqual({ state: "working", activity: "Running install.sh" });
    expect(orchestratorState({ threadStatus: "active", pendingInteractions: 0, lead: lead("reasoning", "Thinking") })).toEqual({ state: "working", activity: "Thinking" });
    expect(orchestratorState({ threadStatus: "active", pendingInteractions: 0, lead: lead("agentMessage", "Writing reply") }).activity).toBe("Writing reply");
    expect(orchestratorState({ threadStatus: "active", pendingInteractions: 0, lead: lead("fileRead", "Reading README.md", true) }).activity).toBe("Thinking");
    expect(orchestratorState({ threadStatus: "active", pendingInteractions: 0, lead: null }).activity).toBe("Thinking");
    expect(orchestratorState({ threadStatus: "starting", pendingInteractions: 0, lead: null })).toEqual({ state: "working", activity: "Starting up" });
  });
  it("is waiting for the user when the thread is idle", () => {
    expect(orchestratorState({ threadStatus: "idle", pendingInteractions: 0, lead: lead("agentMessage", "Writing reply", true) })).toEqual({ state: "waiting", activity: "Waiting for you" });
  });
  it("needs the user when an interaction is pending or the turn errored", () => {
    expect(orchestratorState({ threadStatus: "active", pendingInteractions: 1, lead: lead("toolCall", "Using AskUserQuestion") })).toEqual({ state: "needs-you", activity: "Needs your answer" });
    expect(orchestratorState({ threadStatus: "idle", pendingInteractions: 2, lead: null }).activity).toBe("Needs 2 answers from you");
    expect(orchestratorState({ threadStatus: "error", pendingInteractions: 0, lead: null })).toEqual({ state: "needs-you", activity: "Stopped with an error" });
  });
});

describe("activity labels", () => {
  it("names scripts and commands plainly", () => {
    expect(commandActivity({ command: "cd /tmp/x && ./install.sh --yes" })).toBe("Running install.sh");
    expect(commandActivity({ command: "python3 scripts/build_deck.py" })).toBe("Running build_deck.py");
    expect(commandActivity({ command: "cd ~/repo && git status --short" })).toBe("Running git status");
    expect(commandActivity({ command: "NODE_ENV=test npm test" })).toBe("Running npm test");
    expect(commandActivity({ description: "Build the plugin bundle", command: "bb plugin build" })).toBe("Build the plugin bundle");
  });
  it("labels reading, editing, thinking and replying", () => {
    expect(leadActivity("fileRead", { path: "/a/b/README.md" })).toBe("Reading README.md");
    expect(leadActivity("fileChange", { changes: [{ path: "/a/app.tsx", kind: "update" }] })).toBe("Editing app.tsx");
    expect(leadActivity("reasoning", {})).toBe("Thinking");
    expect(leadActivity("agentMessage", {})).toBe("Writing reply");
    expect(leadActivity("webSearch", { queries: ["bb plugins"] })).toBe("Searching the web: bb plugins");
  });
});

describe("lead tracking and nesting from events", () => {
  it("follows the orchestrator's own items on the synthetic log, ignoring sub-agent items", () => {
    const TYPES = new Set(["client/turn/requested", "item/started", "item/completed", "item/delegation/completed", "item/backgroundTask/completed"]);
    const raw = (JSON.parse(readFileSync(new URL("./fixtures/events.json", import.meta.url), "utf8")) as RawEvent[]).filter((e) => TYPES.has(e.type));
    const s = reduceEvents(emptyState(), raw);
    expect(s.lead).not.toBeNull();
    const lastTop = [...raw].reverse().find((e) => (e.type === "item/started" || e.type === "item/completed") && !(e.data.item as Record<string, unknown>)?.parentToolCallId && (e.data.item as Record<string, unknown>)?.type !== "backgroundTask")!;
    expect(s.lead!.itemType).toBe((lastTop.data.item as Record<string, unknown>).type);
  });
  it("hangs a sub-agent's own sub-agent under it", () => {
    const s = reduceEvents(emptyState(), [
      { seq: 1, type: "client/turn/requested", createdAt: 1, data: { initiator: "user", input: [{ type: "text", text: "Go" }] } },
      { seq: 2, type: "item/started", createdAt: 2, data: { item: { type: "delegation", id: "p", label: "Planner", status: "pending", background: false } } },
      { seq: 3, type: "item/started", createdAt: 3, data: { item: { type: "delegation", id: "c", label: "Researcher", status: "pending", background: false, parentToolCallId: "p" } } },
    ]);
    expect(s.agents.get("c")!.parentId).toBe("p");
    expect(s.agents.get("p")!.parentId).toBeNull();
    expect(s.lead!.label).toBe("Starting Planner");
    expect(buildBatches(s)[0].agents.map((a) => a.id)).toEqual(["p", "c"]);
  });
});
