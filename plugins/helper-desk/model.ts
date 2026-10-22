// Pure model for Helper Desk: turns bb thread events and Claude Code sub-agent
// transcripts into the cards, tiles and taskbar the UI draws. No I/O here.
import { z } from "zod";

export const agentStateSchema = z.enum(["running", "finished", "failed", "interrupted"]);
export type AgentState = z.infer<typeof agentStateSchema>;

export const agentSchema = z.object({
  id: z.string(),
  name: z.string(),
  agentType: z.string(),
  model: z.string(),
  state: agentStateSchema,
  background: z.boolean(),
  startedAt: z.number(),
  finishedAt: z.number().nullable(),
  tokens: z.number(),
  steps: z.number(),
  stepLabel: z.string(),
  details: z.array(z.string()).max(2),
  progress: z.number().min(0).max(1),
  colour: z.number().int().min(0),
  summary: z.string(),
  parentId: z.string().nullable(),
});
export type DeskAgent = z.infer<typeof agentSchema>;

export const todoSchema = z.object({
  id: z.string(),
  text: z.string(),
  status: z.enum(["pending", "in_progress", "completed"]),
});
export type DeskTodo = z.infer<typeof todoSchema>;

export const leadStateSchema = z.enum(["working", "waiting", "needs-you"]);
export type LeadState = z.infer<typeof leadStateSchema>;
export const leadSchema = z.object({
  label: z.string(),
  model: z.string(),
  state: leadStateSchema,
  activity: z.string(),
  contextUsed: z.number().nullable(),
  contextPct: z.number().nullable(),
  costUsd: z.number().nullable(),
  costEstimated: z.boolean(),
});
export type DeskLead = z.infer<typeof leadSchema>;

export const snapshotSchema = z.object({
  threadId: z.string(),
  title: z.string(),
  turnKey: z.string(),
  agents: z.array(agentSchema).max(40),
  todos: z.array(todoSchema).max(60),
  cost: z.object({ amount: z.number(), estimated: z.boolean(), currency: z.string() }).nullable(),
  subagentTokens: z.number(),
  startedAt: z.number().nullable(),
  endedAt: z.number().nullable(),
  running: z.boolean(),
  todosUpdatedAt: z.number().nullable(),
  lead: leadSchema,
  updatedAt: z.number(),
});
export type DeskSnapshot = z.infer<typeof snapshotSchema>;

/** Minimal shape of a raw bb thread event, as returned by threads.events.list. */
export interface RawEvent {
  seq: number;
  type: string;
  createdAt: number;
  data: Record<string, unknown>;
}

/** Internal per-agent record the reducer keeps between polls. */
export interface AgentRecord {
  id: string;
  name: string;
  agentType: string;
  model: string;
  background: boolean;
  state: AgentState;
  startedAt: number;
  finishedAt: number | null;
  groupSeq: number;
  outputFile: string | null;
  finalUsage: { totalTokens: number; toolUses: number; durationMs: number } | null;
  summary: string;
  order: number;
  /** Steps seen as the sub-agent's own items in the parent thread (fallback when no transcript). */
  childSteps: number;
  childRecent: string[];
  lastActivityAt: number;
  /** Final numbers read from the sub-agent transcript, kept so history loads without re-reading it. */
  derived: { tokens: number; model: string; steps: number; costUsd: number; recent: string[] } | null;
  /** The delegation that launched this agent, when a sub-agent starts its own sub-agents. */
  parentId: string | null;
}

/** The orchestrator's latest top-level item (not a sub-agent's). */
export interface LeadItem {
  itemType: string;
  label: string;
  at: number;
  done: boolean;
}

export interface ThreadState {
  afterSeq: number;
  lastUserSeq: number;
  lastUserText: string;
  userRequests: { seq: number; text: string }[];
  agents: Map<string, AgentRecord>;
  order: number;
  lead: LeadItem | null;
}

export function emptyState(): ThreadState {
  return { afterSeq: 0, lastUserSeq: 0, lastUserText: "", userRequests: [], agents: new Map(), order: 0, lead: null };
}

export const SUMMARY_MAX = 2000;
export const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1).trimEnd() + "…" : s);
const str = (v: unknown) => (typeof v === "string" ? v : "");
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});

/** "general-purpose agent · model opus" -> { type, model } */
export function parseDetail(detail: string): { agentType: string; model: string } {
  const [left = "", right = ""] = detail.split("·").map((p) => p.trim());
  const agentType = left.replace(/\s*agent$/i, "").trim() || "agent";
  const model = right.replace(/^model\s+/i, "").trim();
  return { agentType, model };
}

export function parseOutputFile(text: string): string | null {
  const m = /output_file:\s*(\S+\.output)/.exec(text);
  return m ? m[1] : null;
}

/** Foreground Task results end with a usage block; parse it when present. */
export function parseUsageBlock(text: string): { totalTokens: number; toolUses: number; durationMs: number } | null {
  const total = /total_tokens:\s*(\d+)/.exec(text);
  if (!total) return null;
  const tools = /tool_uses:\s*(\d+)/.exec(text);
  const dur = /duration_ms:\s*(\d+)/.exec(text);
  return { totalTokens: Number(total[1]), toolUses: tools ? Number(tools[1]) : 0, durationMs: dur ? Number(dur[1]) : 0 };
}

function userText(data: Record<string, unknown>): string {
  const input = Array.isArray(data.input) ? data.input : [];
  return input.map((b) => str(obj(b).text)).join(" ").replace(/\s+/g, " ").trim();
}

/** Fold a batch of raw events (ascending) into the thread state. */
export function reduceEvents(state: ThreadState, events: RawEvent[]): ThreadState {
  for (const e of events) {
    if (e.seq > state.afterSeq) state.afterSeq = e.seq;
    const data = obj(e.data);
    if (e.type === "client/turn/requested") {
      // A new request from the user or from another agent starts a new batch; system notices do not.
      if (data.initiator !== "system") {
        const text = userText(data).replace(/^\[bb message from thread:[^\]]*\]\s*/, "");
        state.lastUserSeq = e.seq;
        state.lastUserText = text;
        state.userRequests.push({ seq: e.seq, text });
        if (state.userRequests.length > 200) state.userRequests.shift();
      }
      continue;
    }
    const item = obj(data.item);
    const itemType = str(item.type);
    if (itemType === "delegation") {
      const id = str(item.id);
      if (!id) continue;
      const presentation = obj(item.presentation);
      let rec = state.agents.get(id);
      if (!rec) {
        const { agentType, model } = parseDetail(str(presentation.detail));
        rec = {
          id,
          name: str(item.label) || str(presentation.title) || "Sub-agent",
          agentType,
          model,
          background: item.background === true,
          state: "running",
          startedAt: e.createdAt,
          finishedAt: null,
          groupSeq: state.lastUserSeq,
          outputFile: null,
          finalUsage: null,
          summary: "",
          order: state.order++,
          childSteps: 0,
          childRecent: [],
          lastActivityAt: e.createdAt,
          derived: null,
          parentId: null,
        };
        state.agents.set(id, rec);
      }
      if (item.background === true) rec.background = true;
      const parentOf = str(item.parentToolCallId);
      if (parentOf && state.agents.has(parentOf) && parentOf !== rec.id) rec.parentId = parentOf;
      if (!parentOf && e.type === "item/started") state.lead = { itemType: "delegation", label: clip(`Starting ${rec.name}`, 70), at: e.createdAt, done: false };
      const summary = str(item.summary);
      const status = str(item.status);
      const finishedEvent = e.type === "item/delegation/completed" || e.type === "item/completed";
      if (rec.background) {
        // Background launch: "completed" only means it was launched.
        rec.outputFile = rec.outputFile ?? parseOutputFile(summary);
        if (finishedEvent && (status === "failed" || status === "interrupted") && rec.state === "running") {
          rec.state = status === "interrupted" ? "interrupted" : "failed";
          rec.finishedAt = e.createdAt;
        }
      } else if (finishedEvent && status && status !== "pending") {
        rec.state = status === "completed" ? "finished" : status === "interrupted" ? "interrupted" : "failed";
        rec.finishedAt = e.createdAt;
        rec.finalUsage = parseUsageBlock(summary) ?? rec.finalUsage;
        rec.summary = clip(summary.replace(/<usage>[\s\S]*<\/usage>/, "").trim(), SUMMARY_MAX);
      }
      continue;
    }
    // The orchestrator's own items carry no parentToolCallId.
    if (!str(item.parentToolCallId) && (e.type === "item/started" || e.type === "item/completed") && itemType && itemType !== "backgroundTask") {
      if (e.type === "item/started") state.lead = { itemType, label: leadActivity(itemType, item), at: e.createdAt, done: false };
      else if (state.lead && state.lead.itemType === itemType) state.lead = { ...state.lead, done: true, at: e.createdAt };
      continue;
    }
    // A sub-agent's own tool calls arrive in the parent thread tagged with the delegation id.
    const parentId = str(item.parentToolCallId);
    if (parentId && e.type === "item/started" && itemType !== "backgroundTask" && itemType !== "reasoning" && itemType !== "agentMessage") {
      const owner = state.agents.get(parentId);
      if (owner) {
        owner.childSteps += 1;
        owner.lastActivityAt = Math.max(owner.lastActivityAt, e.createdAt);
        owner.childRecent.push(childLabel(itemType, item));
        if (owner.childRecent.length > 3) owner.childRecent.shift();
      }
      continue;
    }
    if (itemType === "backgroundTask" && str(item.taskType) === "local_agent") {
      const parent = str(item.parentToolCallId);
      let rec = parent ? state.agents.get(parent) : undefined;
      if (!rec) {
        const desc = str(item.description);
        rec = [...state.agents.values()].reverse().find((a) => a.background && a.name === desc && a.state === "running");
      }
      if (!rec) continue;
      const outputFile = str(item.outputFile);
      if (outputFile) rec.outputFile = outputFile;
      if (e.type === "item/backgroundTask/completed" || e.type === "item/completed") {
        const taskStatus = str(item.taskStatus) || str(item.status);
        rec.state = taskStatus === "failed" ? "failed" : taskStatus === "killed" || taskStatus === "stopped" || taskStatus === "interrupted" ? "interrupted" : "finished";
        rec.finishedAt = e.createdAt;
        rec.lastActivityAt = Math.max(rec.lastActivityAt, e.createdAt);
        const usage = obj(item.usage);
        if (typeof usage.totalTokens === "number") {
          rec.finalUsage = {
            totalTokens: usage.totalTokens,
            toolUses: typeof usage.toolUses === "number" ? usage.toolUses : 0,
            durationMs: typeof usage.durationMs === "number" ? usage.durationMs : 0,
          };
        }
        rec.summary = clip(str(item.summary), SUMMARY_MAX);
      }
    }
  }
  return state;
}

/** Plain-English label for a sub-agent item streamed into the parent thread. */
export function childLabel(itemType: string, item: Record<string, unknown>): string {
  switch (itemType) {
    case "fileRead":
      return `Reading ${base(str(item.path)) || "a file"}`;
    case "fileChange": {
      const changes = Array.isArray(item.changes) ? item.changes : [];
      const path = str(obj(changes[0]).path);
      return `${obj(changes[0]).kind === "add" ? "Writing" : "Editing"} ${base(path) || "a file"}`;
    }
    case "commandExecution":
      return clip(str(item.description) || "Running a command", 70);
    case "webSearch": {
      const q = Array.isArray(item.queries) ? str(item.queries[0]) : "";
      return clip(`Searching the web: ${q}`, 70);
    }
    case "webFetch": {
      let host = str(item.url);
      try { host = new URL(host).hostname; } catch { /* keep raw */ }
      return clip(`Reading ${host || "a web page"}`, 70);
    }
    case "toolCall": {
      let input: Record<string, unknown> = {};
      try { input = typeof item.arguments === "string" ? JSON.parse(item.arguments) : obj(item.arguments); } catch { /* ignore */ }
      return describeTool(str(item.tool), input);
    }
    case "delegation":
      return clip(`Starting ${str(item.label) || "a sub-agent"}`, 70);
    default: {
      const p = obj(item.presentation);
      return clip((str(p.title) || itemType).replace(/\s+/g, " "), 70);
    }
  }
}

/** "Running install.sh", "Running git status", or the command's own description. */
export function commandActivity(item: Record<string, unknown>): string {
  const desc = str(item.description);
  if (desc) return clip(desc, 70);
  const cmd = (str(item.command) || str(obj(item.presentation).title)).trim();
  const script = /(?:^|[\s/])([\w.-]+\.(?:sh|py|js|mjs|ts|rb|zsh|bash))\b/.exec(cmd);
  if (script) return `Running ${script[1]}`;
  const last = cmd.split(/&&|;|\|/).map((p) => p.trim()).filter((p) => p && !/^cd\s/.test(p))[0] ?? "";
  const words = last.split(/\s+/).filter((w) => w && !w.startsWith("-") && !/^[A-Z_]+=/.test(w)).slice(0, 2);
  return words.length ? clip(`Running ${words.join(" ")}`, 70) : "Running a command";
}

/** One-line activity for an orchestrator item. */
export function leadActivity(itemType: string, item: Record<string, unknown>): string {
  switch (itemType) {
    case "reasoning":
      return "Thinking";
    case "agentMessage":
      return "Writing reply";
    case "commandExecution":
      return commandActivity(item);
    case "contextCompaction":
      return "Compacting the chat";
    default:
      return childLabel(itemType, item);
  }
}

/**
 * Orchestrator state from bb's thread status, pending interactions and the
 * latest top-level item: working, waiting for the user, or needs them.
 */
export function orchestratorState(args: { threadStatus: string; pendingInteractions: number; lead: LeadItem | null }): { state: LeadState; activity: string } {
  if (args.pendingInteractions > 0) return { state: "needs-you", activity: args.pendingInteractions === 1 ? "Needs your answer" : `Needs ${args.pendingInteractions} answers from you` };
  if (args.threadStatus === "error") return { state: "needs-you", activity: "Stopped with an error" };
  if (args.threadStatus === "active" || args.threadStatus === "starting" || args.threadStatus === "pending" || args.threadStatus === "stopping") {
    if (args.threadStatus === "stopping") return { state: "working", activity: "Stopping" };
    if (args.threadStatus === "starting" || args.threadStatus === "pending") return { state: "working", activity: "Starting up" };
    const l = args.lead;
    if (!l) return { state: "working", activity: "Thinking" };
    if (!l.done) return { state: "working", activity: l.label };
    return { state: "working", activity: l.itemType === "agentMessage" ? "Writing reply" : "Thinking" };
  }
  return { state: "waiting", activity: "Waiting for you" };
}

// ---------- Sub-agent transcript (JSONL) parsing ----------

export interface TranscriptState {
  offset: number;
  remainder: string;
  tokens: number;
  model: string;
  steps: number;
  recent: string[];
  costUsd: number;
}

export function emptyTranscript(): TranscriptState {
  return { offset: 0, remainder: "", tokens: 0, model: "", steps: 0, recent: [], costUsd: 0 };
}

const base = (p: string) => p.split("/").filter(Boolean).pop() ?? p;

/** One plain-English line for a tool call, e.g. "Writing pre-outline.md". */
export function describeTool(name: string, input: Record<string, unknown>): string {
  const file = str(input.file_path) || str(input.path) || str(input.notebook_path);
  switch (name) {
    case "Read":
      return `Reading ${base(file) || "a file"}`;
    case "Write":
      return `Writing ${base(file) || "a file"}`;
    case "Edit":
    case "MultiEdit":
    case "NotebookEdit":
      return `Editing ${base(file) || "a file"}`;
    case "Bash":
      return clip(str(input.description) || "Running a command", 70);
    case "Grep":
      return clip(`Searching for ${str(input.pattern) || "text"}`, 70);
    case "Glob":
      return clip(`Finding ${str(input.pattern) || "files"}`, 70);
    case "WebSearch":
      return clip(`Searching the web: ${str(input.query)}`, 70);
    case "WebFetch": {
      const url = str(input.url);
      let host = url;
      try { host = new URL(url).hostname; } catch { /* keep raw */ }
      return clip(`Reading ${host || "a web page"}`, 70);
    }
    case "Skill":
      return clip(`Using the ${str(input.skill) || "a"} skill`, 70);
    case "Agent":
    case "Task":
      return clip(`Starting ${str(input.description) || "a sub-agent"}`, 70);
    case "TodoWrite":
      return "Updating the to-do list";
    default: {
      const short = name.startsWith("mcp__") ? name.split("__").slice(2).join(" ") || name : name;
      return clip(`Using ${short.replaceAll("_", " ")}`, 70);
    }
  }
}

/** API-equivalent price per million tokens. Subscription usage is notional, so the UI marks it "est.". */
export function priceFor(model: string): { input: number; output: number; cacheRead: number; write5m: number; write1h: number } {
  const m = model.toLowerCase();
  if (m.includes("haiku")) return { input: 1, output: 5, cacheRead: 0.1, write5m: 1.25, write1h: 2 };
  if (m.includes("sonnet")) return { input: 3, output: 15, cacheRead: 0.3, write5m: 3.75, write1h: 6 };
  return { input: 5, output: 25, cacheRead: 0.5, write5m: 6.25, write1h: 10 };
}

export function usageCost(model: string, usage: Record<string, unknown>): number {
  const p = priceFor(model);
  const n = (k: string) => (typeof usage[k] === "number" ? (usage[k] as number) : 0);
  const creation = obj(usage.cache_creation);
  const w1h = typeof creation.ephemeral_1h_input_tokens === "number" ? (creation.ephemeral_1h_input_tokens as number) : 0;
  const w5m = typeof creation.ephemeral_5m_input_tokens === "number" ? (creation.ephemeral_5m_input_tokens as number) : Math.max(0, n("cache_creation_input_tokens") - w1h);
  return (n("input_tokens") * p.input + n("output_tokens") * p.output + n("cache_read_input_tokens") * p.cacheRead + w5m * p.write5m + w1h * p.write1h) / 1e6;
}

/** Feed newly read bytes (as text) into the transcript state. Handles a partial trailing line. */
export function feedTranscript(state: TranscriptState, chunk: string, bytes: number): TranscriptState {
  state.offset += bytes;
  const text = state.remainder + chunk;
  const lines = text.split("\n");
  state.remainder = lines.pop() ?? "";
  if (state.remainder.length > 4_000_000) state.remainder = ""; // pathological line; drop it
  const seen = new Set<string>();
  for (const line of lines) {
    if (!line.trim()) continue;
    let row: Record<string, unknown>;
    try { row = JSON.parse(line); } catch { continue; }
    if (row.type !== "assistant") continue;
    const message = obj(row.message);
    const usage = obj(message.usage);
    const model = str(message.model);
    if (model) state.model = model;
    // Claude Code writes one row per content block of the same API reply; count usage once per message id.
    const msgId = str(message.id) || str(row.requestId);
    if (Object.keys(usage).length && !(msgId && seen.has(msgId))) {
      if (msgId) seen.add(msgId);
      const n = (k: string) => (typeof usage[k] === "number" ? (usage[k] as number) : 0);
      state.tokens = n("input_tokens") + n("cache_creation_input_tokens") + n("cache_read_input_tokens") + n("output_tokens");
      state.costUsd += usageCost(state.model, usage);
    }
    const content = Array.isArray(message.content) ? message.content : [];
    for (const block of content) {
      const b = obj(block);
      if (b.type !== "tool_use") continue;
      state.steps += 1;
      state.recent.push(describeTool(str(b.name), obj(b.input)));
      if (state.recent.length > 3) state.recent.shift();
    }
  }
  return state;
}

// ---------- Snapshot assembly ----------

export const EXPECTED_STEPS = 8;

export function agentProgress(state: AgentState, steps: number): number {
  if (state !== "running") return 1;
  return Math.min(0.95, Math.max(0.04, steps / EXPECTED_STEPS));
}

/** The batch to show: agents launched since the latest user request that launched any. */
export function currentGroup(state: ThreadState): AgentRecord[] {
  const all = [...state.agents.values()];
  if (all.length === 0) return [];
  const latest = Math.max(...all.map((a) => a.groupSeq));
  return all.filter((a) => a.groupSeq === latest).sort((a, b) => a.order - b.order).slice(-40);
}

export function fmtTokens(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1).replace(/\.0$/, "") + "M";
  if (n >= 1000) return Math.round(n / 1000) + "k";
  return String(n);
}

export function fmtDuration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}` : `${m}:${String(sec).padStart(2, "0")}`;
}

/** Taskbar source: the to-do list when there is one, otherwise the sub-agent batch. */
export function taskbarProgress(snap: Pick<DeskSnapshot, "todos" | "agents">): { label: string; done: number; total: number; pct: number; now: string | null; key: string } | null {
  if (snap.todos.length > 0) {
    const p = todoProgress(snap.todos);
    return { label: "Tasks", ...p, key: "t:" + snap.todos.map((t) => t.id).join(",") };
  }
  if (snap.agents.length === 0) return null;
  const total = snap.agents.length;
  const done = snap.agents.filter((a) => a.state !== "running").length;
  const running = snap.agents.find((a) => a.state === "running");
  return {
    label: "Agents",
    done,
    total,
    pct: Math.round((done / total) * 100),
    now: running ? `${running.name} · ${running.stepLabel}` : null,
    key: "a:" + snap.agents.map((a) => a.id).join(","),
  };
}

export function todoProgress(todos: DeskTodo[]): { done: number; total: number; pct: number; now: string | null } {
  const total = todos.length;
  const done = todos.filter((t) => t.status === "completed").length;
  const now = todos.find((t) => t.status === "in_progress")?.text ?? todos.find((t) => t.status === "pending")?.text ?? null;
  return { done, total, pct: total ? Math.round((done / total) * 100) : 0, now };
}


// ---------- Batches and history ----------

/** A running agent with no sign of life for this long is treated as interrupted (the session was stopped). */
export const STALE_MS = 30 * 60_000;

export function effectiveState(rec: Pick<AgentRecord, "state" | "lastActivityAt">, now: number, lastLifeAt = 0): AgentState {
  if (rec.state !== "running") return rec.state;
  return now - Math.max(rec.lastActivityAt, lastLifeAt) > STALE_MS ? "interrupted" : "running";
}

export interface Batch {
  key: string;
  seq: number;
  request: string;
  agents: AgentRecord[];
}

/** Group every agent by the user request that launched it. Newest batch first. */
export function buildBatches(state: ThreadState): Batch[] {
  const bySeq = new Map<number, AgentRecord[]>();
  for (const a of state.agents.values()) {
    const list = bySeq.get(a.groupSeq) ?? [];
    list.push(a);
    bySeq.set(a.groupSeq, list);
  }
  return [...bySeq.entries()]
    .sort((x, y) => y[0] - x[0])
    .map(([seq, agents]) => ({
      key: `b${seq}`,
      seq,
      request: state.userRequests.find((r) => r.seq === seq)?.text ?? "",
      agents: agents.sort((a, b) => a.order - b.order),
    }));
}

export const historyAgentSchema = z.object({
  id: z.string(),
  name: z.string(),
  agentType: z.string(),
  model: z.string(),
  state: agentStateSchema,
  tokens: z.number(),
  steps: z.number(),
  durationMs: z.number(),
  colour: z.number().int().min(0),
  summary: z.string(),
  parentId: z.string().nullable(),
});
export const historyBatchSchema = z.object({
  key: z.string(),
  startedAt: z.number(),
  endedAt: z.number(),
  request: z.string(),
  running: z.boolean(),
  totals: z.object({ agents: z.number(), tokens: z.number(), durationMs: z.number(), costUsd: z.number().nullable() }),
  agents: z.array(historyAgentSchema).max(60),
});
export const historySchema = z.object({ threadId: z.string(), lead: z.object({ label: z.string(), model: z.string() }), batches: z.array(historyBatchSchema).max(200), updatedAt: z.number() });
export type HistoryBatch = z.infer<typeof historyBatchSchema>;
export type DeskHistory = z.infer<typeof historySchema>;

/** Summarise one batch for the History timeline. `live` supplies per-agent transcript numbers when known. */
export function summariseBatch(
  batch: Batch,
  now: number,
  live: (rec: AgentRecord) => { tokens: number; model: string; steps: number; costUsd: number | null; lastLifeAt: number },
): HistoryBatch {
  let costKnown = false;
  let cost = 0;
  const agents = batch.agents.slice(0, 60).map((rec, i) => {
    const l = live(rec);
    const state = effectiveState(rec, now, l.lastLifeAt);
    if (l.costUsd !== null) {
      costKnown = true;
      cost += l.costUsd;
    }
    const end = rec.finishedAt ?? (state === "running" ? now : Math.max(rec.lastActivityAt, l.lastLifeAt));
    return {
      id: rec.id,
      name: clip(rec.name, 80),
      agentType: rec.agentType,
      model: l.model,
      state,
      tokens: rec.finalUsage?.totalTokens ?? l.tokens,
      steps: Math.max(rec.finalUsage?.toolUses ?? 0, l.steps, rec.childSteps),
      durationMs: rec.finalUsage?.durationMs || Math.max(0, end - rec.startedAt),
      colour: i,
      summary: rec.summary,
      parentId: rec.parentId,
    };
  });
  const startedAt = Math.min(...batch.agents.map((a) => a.startedAt));
  const endedAt = Math.max(...agents.map((a, i) => batch.agents[i].startedAt + a.durationMs));
  return {
    key: batch.key,
    startedAt,
    endedAt,
    request: clip(batch.request || "Earlier work", 200),
    running: agents.some((a) => a.state === "running"),
    totals: {
      agents: batch.agents.length,
      tokens: agents.reduce((sum, a) => sum + a.tokens, 0),
      durationMs: Math.max(0, endedAt - startedAt),
      costUsd: costKnown ? cost : null,
    },
    agents,
  };
}

/** "Today 14:32", "Yesterday 09:10", otherwise "Mon 20 Oct 09:10". */
export function fmtWhen(ts: number, now: number): string {
  const d = new Date(ts);
  const time = d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false });
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((day(new Date(now)) - day(d)) / 86_400_000);
  if (diff === 0) return `Today ${time}`;
  if (diff === 1) return `Yesterday ${time}`;
  const date = d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" }).replace(",", "");
  return `${date} ${time}`;
}

// ---------- Auto-hide timing ----------

export const FADE_MS = 600;
export type LiveVisibility = "empty" | "live" | "fading" | "hidden";

/**
 * Whether the live view should show the current batch. When every agent has
 * finished, the cards stay for `delayMs` with their final numbers, fade for
 * FADE_MS, then the live view is empty.
 */
export function liveVisibility(args: { running: boolean; hasContent: boolean; endedAt: number | null; now: number; autoHide: boolean; delayMs: number }): LiveVisibility {
  if (!args.hasContent) return "empty";
  if (args.running || !args.autoHide || args.endedAt === null) return "live";
  const t = args.now - args.endedAt;
  if (t < args.delayMs) return "live";
  if (t < args.delayMs + FADE_MS) return "fading";
  return "hidden";
}

/** Milliseconds until the visibility next changes, or null when it will not change on its own. */
export function nextVisibilityChange(args: Parameters<typeof liveVisibility>[0]): number | null {
  const v = liveVisibility(args);
  if (v === "empty" || v === "hidden" || args.endedAt === null || args.running || !args.autoHide) return null;
  const t = args.now - args.endedAt;
  return v === "live" ? args.delayMs - t : args.delayMs + FADE_MS - t;
}

/** Serialised thread state for the plugin's history cache (kept under 256 KB). */
export interface CachedThread {
  version: 3;
  afterSeq: number;
  lastUserSeq: number;
  lastUserText: string;
  userRequests: { seq: number; text: string }[];
  order: number;
  agents: AgentRecord[];
  lead: LeadItem | null;
}

export function serialiseState(state: ThreadState): CachedThread {
  const agents = [...state.agents.values()].slice(-300);
  const wanted = new Set(agents.map((a) => a.groupSeq));
  return {
    version: 3,
    afterSeq: state.afterSeq,
    lastUserSeq: state.lastUserSeq,
    lastUserText: clip(state.lastUserText, 300),
    userRequests: state.userRequests.filter((r) => wanted.has(r.seq) || r.seq === state.lastUserSeq).map((r) => ({ seq: r.seq, text: clip(r.text, 300) })),
    order: state.order,
    agents: agents.map((a) => ({ ...a, summary: clip(a.summary, 1200), childRecent: a.childRecent.slice(-3) })),
    lead: state.lead,
  };
}

export function restoreState(cached: CachedThread | undefined): ThreadState | null {
  if (!cached || cached.version !== 3 || !Array.isArray(cached.agents)) return null; // older parses are rebuilt from the event log
  const state = emptyState();
  state.afterSeq = cached.afterSeq;
  state.lastUserSeq = cached.lastUserSeq;
  state.lastUserText = cached.lastUserText;
  state.userRequests = cached.userRequests;
  state.order = cached.order;
  state.lead = cached.lead ?? null;
  for (const a of cached.agents) state.agents.set(a.id, { ...a, lastActivityAt: a.lastActivityAt ?? a.startedAt, derived: a.derived ?? null, childRecent: a.childRecent ?? [], childSteps: a.childSteps ?? 0, parentId: a.parentId ?? null });
  return state;
}
