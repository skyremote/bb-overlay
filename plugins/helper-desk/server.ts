// Helper Desk — server side. Folds a thread's bb events into sub-agent cards,
// tails each Claude Code sub-agent transcript for live tokens and steps,
// estimates the chat's API-equivalent cost, and serves a per-thread history of
// past agent batches (parsed state cached in plugin storage by thread + last seq).
import { defineRpcContract, type BbPluginApi } from "@get-bb/plugin-sdk";
import { isActive, pickRailThreads, railOverviewSchema, recentBatches, type RailOverview } from "./railmodel";
import { open, readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import {
  agentProgress,
  buildBatches,
  clip,
  effectiveState,
  emptyState,
  emptyTranscript,
  feedTranscript,
  orchestratorState,
  historySchema,
  reduceEvents,
  restoreState,
  serialiseState,
  snapshotSchema,
  summariseBatch,
  type AgentRecord,
  type CachedThread,
  type DeskAgent,
  type DeskHistory,
  type DeskSnapshot,
  type RawEvent,
  type ThreadState,
  type TranscriptState,
} from "./model";

const threadIdSchema = z.string().regex(/^thr_[a-zA-Z0-9_-]+$/);

export const rpcContract = defineRpcContract({
  snapshot: { input: z.object({ threadId: threadIdSchema }), output: snapshotSchema },
  history: { input: z.object({ threadId: threadIdSchema }), output: historySchema },
  overview: { input: z.null(), output: railOverviewSchema },
});

const EVENT_TYPES = [
  "client/turn/requested",
  "item/started",
  "item/completed",
  "item/delegation/completed",
  "item/backgroundTask/completed",
] as const;

const MAX_READ_PER_CALL = 32 * 1024 * 1024;
const CHUNK = 4 * 1024 * 1024;

interface Tail extends TranscriptState {
  mtimeMs: number;
}

/** Read only the new bytes of a growing JSONL file into a transcript state. */
async function tail(path: string, state: Tail): Promise<Tail> {
  let handle;
  try {
    const info = await stat(path);
    state.mtimeMs = info.mtimeMs;
    if (info.size < state.offset) Object.assign(state, emptyTranscript()); // rewritten
    if (info.size === state.offset) return state;
    handle = await open(path, "r");
    let budget = MAX_READ_PER_CALL;
    while (state.offset < info.size && budget > 0) {
      const length = Math.min(CHUNK, info.size - state.offset, budget);
      const buffer = Buffer.alloc(length);
      const { bytesRead } = await handle.read(buffer, 0, length, state.offset);
      if (bytesRead <= 0) break;
      feedTranscript(state, buffer.subarray(0, bytesRead).toString("utf8"), bytesRead);
      budget -= bytesRead;
    }
  } catch {
    // Missing or unreadable transcript: keep what we have.
  } finally {
    await handle?.close();
  }
  return state;
}

export default function plugin(bb: BbPluginApi) {
  bb.settings.define({
    autoHide: {
      type: "boolean",
      label: "Auto-hide finished agents",
      description: "When every agent in a batch has finished, keep the cards for a few seconds, then clear the live view and the taskbar. Past batches stay in History.",
      default: true,
    },
    hideDelaySeconds: {
      type: "number",
      label: "Seconds to keep finished agents on screen",
      description: "How long finished cards stay visible with their final numbers before they slide away.",
      default: 8,
    },
  });

  const threads = new Map<string, { state: ThreadState; providerSessionId: string | null; viewedAt: number; savedSeq: number; loaded: boolean }>();
  const transcripts = new Map<string, Tail>();
  const sessionFiles = new Map<string, string | null>();
  const syncing = new Map<string, Promise<unknown>>();

  async function findSessionFile(sessionId: string): Promise<string | null> {
    if (sessionFiles.has(sessionId)) return sessionFiles.get(sessionId) ?? null;
    const root = join(homedir(), ".claude", "projects");
    let found: string | null = null;
    try {
      for (const dir of await readdir(root)) {
        const candidate = join(root, dir, `${sessionId}.jsonl`);
        try {
          await stat(candidate);
          found = candidate;
          break;
        } catch { /* not here */ }
      }
    } catch { /* no projects dir */ }
    sessionFiles.set(sessionId, found);
    return found;
  }

  async function transcript(path: string): Promise<Tail> {
    let t = transcripts.get(path);
    if (!t) {
      t = { ...emptyTranscript(), mtimeMs: 0 };
      transcripts.set(path, t);
    }
    return tail(path, t);
  }

  const cacheKey = (threadId: string) => `history:${threadId}`;

  async function sync(threadId: string) {
    // One sync per thread at a time; concurrent callers share it.
    const pending = syncing.get(threadId);
    if (pending) await pending.catch(() => undefined);
    const run = doSync(threadId);
    syncing.set(threadId, run);
    try {
      return await run;
    } finally {
      if (syncing.get(threadId) === run) syncing.delete(threadId);
    }
  }

  async function doSync(threadId: string) {
    let entry = threads.get(threadId);
    if (!entry) {
      entry = { state: emptyState(), providerSessionId: null, viewedAt: Date.now(), savedSeq: 0, loaded: false };
      threads.set(threadId, entry);
    }
    if (!entry.loaded) {
      entry.loaded = true;
      try {
        const cached = restoreState(await bb.storage.kv.get<CachedThread>(cacheKey(threadId)));
        if (cached) {
          entry.state = cached;
          entry.savedSeq = cached.afterSeq;
        }
      } catch (e) {
        bb.log.warn(`history cache read failed for ${threadId}: ${String(e)}`);
      }
    }
    entry.viewedAt = Date.now();
    // bb caps a page at 100 events. Long threads catch up over a few calls.
    for (let page = 0; page < 250; page++) {
      const rows = await bb.sdk.threads.events.list({
        threadId,
        afterSeq: String(entry.state.afterSeq),
        limit: "100",
        order: "asc",
        types: EVENT_TYPES as unknown as Parameters<typeof bb.sdk.threads.events.list>[0]["types"],
      });
      if (rows.length === 0) break;
      const events: RawEvent[] = rows.map((r) => ({
        seq: r.seq,
        type: r.type,
        createdAt: r.createdAt,
        data: (r.data ?? {}) as Record<string, unknown>,
      }));
      for (const e of events) {
        const sid = e.data.providerThreadId;
        if (typeof sid === "string" && sid) entry.providerSessionId = sid;
      }
      reduceEvents(entry.state, events);
      if (rows.length < 100) break;
    }
    return entry;
  }

  async function saveCache(threadId: string) {
    const entry = threads.get(threadId);
    if (!entry || entry.state.afterSeq === entry.savedSeq) return;
    try {
      let payload = serialiseState(entry.state);
      if (JSON.stringify(payload).length > 240_000) payload = { ...payload, agents: payload.agents.slice(-120).map((a) => ({ ...a, summary: clip(a.summary, 400) })) };
      await bb.storage.kv.set(cacheKey(threadId), payload);
      entry.savedSeq = entry.state.afterSeq;
    } catch (e) {
      bb.log.warn(`history cache write failed for ${threadId}: ${String(e)}`);
    }
  }

  /** Per-agent live numbers from its transcript, remembered on the record once it has finished. */
  async function agentLive(rec: AgentRecord) {
    if (rec.derived && rec.state !== "running") {
      return { ...rec.derived, costUsd: rec.derived.costUsd, lastLifeAt: rec.finishedAt ?? rec.lastActivityAt, fromTranscript: true };
    }
    const t = rec.outputFile ? await transcript(rec.outputFile) : null;
    const read = !!t && t.offset > 0;
    if (read && rec.state !== "running") {
      rec.derived = { tokens: t!.tokens, model: t!.model, steps: t!.steps, costUsd: t!.costUsd, recent: t!.recent.slice() };
    }
    return {
      tokens: t?.tokens ?? 0,
      model: t?.model || rec.model,
      steps: t?.steps ?? 0,
      costUsd: read ? t!.costUsd : null,
      recent: t?.recent ?? [],
      lastLifeAt: t?.mtimeMs ?? 0,
      fromTranscript: read,
    };
  }

  async function snapshot(threadId: string): Promise<DeskSnapshot> {
    const entry = await sync(threadId);
    const batches = buildBatches(entry.state);
    const group = batches[0]?.agents ?? [];
    const now = Date.now();

    const agents: DeskAgent[] = [];
    let subagentCost = 0;
    for (const [index, rec] of group.entries()) {
      const live = await agentLive(rec);
      subagentCost += live.costUsd ?? 0;
      const state = effectiveState(rec, now, live.lastLifeAt);
      const tokens = rec.finalUsage?.totalTokens ?? live.tokens;
      const steps = Math.max(rec.finalUsage?.toolUses ?? 0, live.steps, rec.childSteps);
      const recent = live.recent.length ? live.recent : rec.childRecent;
      const latest = recent.at(-1);
      const finishedAt = rec.finishedAt ?? (state === "running" ? null : Math.max(rec.lastActivityAt, live.lastLifeAt));
      const stepLabel =
        state === "running"
          ? latest
            ? `Step ${Math.max(1, steps)} · ${latest}`
            : "Getting started"
          : state === "failed"
            ? "Failed"
            : state === "interrupted"
              ? "Interrupted"
              : `Done · ${steps} steps`;
      const details = state === "running" ? recent.slice(-3, -1).reverse() : recent.slice(-2).reverse();
      agents.push({
        id: rec.id,
        name: clip(rec.name, 80),
        agentType: rec.agentType,
        model: modelLabel(live.model),
        state,
        background: rec.background,
        startedAt: rec.startedAt,
        finishedAt,
        tokens,
        steps,
        stepLabel: clip(stepLabel, 90),
        details: details.map((d) => clip(d, 80)).slice(0, 2),
        progress: agentProgress(state, steps),
        colour: index,
        summary: clip(rec.summary, 400),
        parentId: rec.parentId,
      });
    }

    // To-do list and context usage.
    let todos: DeskSnapshot["todos"] = [];
    let todosUpdatedAt: number | null = null;
    let cost: DeskSnapshot["cost"] = null;
    try {
      const status = await bb.sdk.status.get({ threadId });
      todos = (status.pendingTodos?.items ?? []).slice(0, 60).map((t) => ({ id: t.id, text: clip(t.text, 200), status: t.status }));
      todosUpdatedAt = status.pendingTodos?.updatedAt ?? null;
    } catch { /* thread gone */ }
    let contextUsed: number | null = null;
    let contextWindow: number | null = null;
    try {
      const timeline = await bb.sdk.threads.timeline({ threadId, segmentLimit: "1", summaryOnly: "true", deferContent: "true" });
      const usage = timeline.contextWindowUsage;
      const c = usage?.cost;
      if (c) cost = { amount: c.amount, currency: c.currency, estimated: false };
      if (usage) {
        contextUsed = usage.usedTokens ?? null;
        contextWindow = usage.modelContextWindow ?? null;
      }
    } catch { /* ignore */ }
    let mainCost = 0;
    let mainModel = "";
    if (entry.providerSessionId) {
      const file = await findSessionFile(entry.providerSessionId);
      if (file) {
        const t = await transcript(file);
        mainCost = t.costUsd;
        mainModel = t.model;
      }
    }
    if (!cost) {
      for (const rec of entry.state.agents.values()) {
        if (group.includes(rec)) continue;
        subagentCost += rec.derived?.costUsd ?? (rec.outputFile ? transcripts.get(rec.outputFile)?.costUsd ?? 0 : 0);
      }
      if (mainCost + subagentCost > 0) cost = { amount: mainCost + subagentCost, currency: "USD", estimated: true };
    }

    const startedAt = agents.length ? Math.min(...agents.map((a) => a.startedAt)) : null;
    const running = agents.some((a) => a.state === "running");
    const endedAt = !running && agents.length ? Math.max(...agents.map((a) => a.finishedAt ?? a.startedAt)) : null;
    const request = batches[0]?.request || entry.state.lastUserText;
    void saveCache(threadId);

    // The orchestrator: this thread's own agent.
    let threadStatus = "idle";
    let providerId = "";
    let pendingInteractions = 0;
    try {
      const t = await bb.sdk.threads.get({ threadId });
      threadStatus = t.status;
      providerId = t.providerId ?? "";
    } catch { /* thread gone */ }
    try {
      pendingInteractions = (await bb.sdk.threads.interactions.list({ threadId })).length;
    } catch { /* none */ }
    const leadState = orchestratorState({ threadStatus, pendingInteractions, lead: entry.state.lead });
    const lead = {
      label: "Lead",
      model: mainModel ? modelLabel(mainModel) : providerLabel(providerId),
      state: leadState.state,
      activity: clip(leadState.activity, 90),
      contextUsed,
      contextPct: contextUsed !== null && contextWindow ? Math.round((contextUsed / contextWindow) * 100) : null,
      costUsd: cost ? cost.amount : mainCost > 0 ? mainCost : null,
      costEstimated: cost ? cost.estimated : true,
    };

    return {
      threadId,
      title: clip(request || "Current work", 120),
      turnKey: `${threadId}:${batches[0]?.seq ?? 0}`,
      agents,
      todos,
      cost,
      subagentTokens: agents.reduce((sum, a) => sum + a.tokens, 0),
      startedAt,
      endedAt,
      running,
      todosUpdatedAt,
      lead,
      updatedAt: now,
    };
  }

  async function history(threadId: string): Promise<DeskHistory> {
    const entry = await sync(threadId);
    const now = Date.now();
    const batches = buildBatches(entry.state).slice(0, 200);
    const out = [];
    for (const batch of batches) {
      const lives = new Map<string, Awaited<ReturnType<typeof agentLive>>>();
      for (const rec of batch.agents.slice(0, 60)) lives.set(rec.id, await agentLive(rec));
      out.push(
        summariseBatch(batch, now, (rec) => {
          const l = lives.get(rec.id)!;
          return { tokens: l.tokens, model: modelLabel(l.model), steps: l.steps, costUsd: l.costUsd, lastLifeAt: l.lastLifeAt };
        }),
      );
    }
    // Derived numbers may have been filled in: force a cache write.
    const e = threads.get(threadId);
    if (e) e.savedSeq = -1;
    void saveCache(threadId);
    let leadModel = "";
    if (entry.providerSessionId) {
      const file = await findSessionFile(entry.providerSessionId);
      if (file) leadModel = (await transcript(file)).model;
    }
    let providerId = "";
    if (!leadModel) {
      try { providerId = (await bb.sdk.threads.get({ threadId })).providerId ?? ""; } catch { /* ignore */ }
    }
    return { threadId, lead: { label: "Lead", model: leadModel ? modelLabel(leadModel) : providerLabel(providerId) }, batches: out, updatedAt: now };
  }


  /** Left-rail Agents page: threads with agents running now, then the last day's finished runs. */
  async function overview(): Promise<RailOverview> {
    const now = Date.now();
    const list = await bb.sdk.threads.list({ archived: false, limit: 200 });
    const picked = pickRailThreads(list, now);
    const read = await Promise.all(
      picked.map(async (t) => {
        try {
          const [snap, hist] = await Promise.all([snapshot(t.id), history(t.id)]);
          return { threadId: t.id, title: t.title || "Untitled chat", snap, batches: hist.batches, model: hist.lead.model };
        } catch (e) {
          bb.log.warn(`overview skipped ${t.id}: ${String(e)}`);
          return null;
        }
      }),
    );
    const ok = read.filter((r): r is NonNullable<typeof r> => r !== null);
    const active = ok.filter((r) => isActive(r.snap)).map((r) => ({ threadId: r.threadId, title: r.title, snapshot: r.snap }));
    const recent = recentBatches(ok, now).map(({ entry, batch }) => ({ threadId: entry.threadId, title: entry.title, model: entry.model, batch }));
    return { active, recent, scanned: picked.length, updatedAt: now };
  }

  bb.rpc.register(rpcContract, {
    snapshot: ({ threadId }) => snapshot(threadId),
    history: ({ threadId }) => history(threadId),
    overview: () => overview(),
  });

  // Tell open panels to refetch when a watched thread moves. Signals carry no content.
  const lastPublish = new Map<string, number>();
  bb.events.on("experimental_thread.events", ({ thread }) => {
    const entry = threads.get(thread.id);
    if (!entry || Date.now() - entry.viewedAt > 15 * 60_000) return;
    const last = lastPublish.get(thread.id) ?? 0;
    if (Date.now() - last < 1000) return;
    lastPublish.set(thread.id, Date.now());
    bb.realtime.publish("desk-changed", { threadId: thread.id });
  });

  bb.cli.register({
    name: "helper-desk",
    summary: "Show a thread's sub-agents, tokens, to-do progress and agent history",
    commands: [
      { name: "show", summary: "Print the live Helper Desk snapshot for a thread", usage: "bb helper-desk show <thread-id>" },
      { name: "history", summary: "Print past agent batches for a thread, newest first", usage: "bb helper-desk history <thread-id>" },
    ],
    async run(args) {
      const usage = "Usage: bb helper-desk show|history <thread-id>";
      if ((args[0] !== "show" && args[0] !== "history") || !args[1]) return { exitCode: 1, stderr: usage };
      const threadId = threadIdSchema.safeParse(args[1]);
      if (!threadId.success) return { exitCode: 1, stderr: "Thread ids look like thr_abc123." };
      const out = args[0] === "show" ? await snapshot(threadId.data) : await history(threadId.data);
      return { exitCode: 0, stdout: clip(JSON.stringify(out, null, 2), 60_000) };
    },
  });
}

function providerLabel(providerId: string): string {
  if (providerId.includes("claude")) return "Claude";
  if (providerId.includes("codex")) return "Codex";
  if (providerId.includes("cursor")) return "Cursor";
  return providerId ? clip(providerId, 24) : "Agent";
}

function modelLabel(model: string): string {
  const m = model.toLowerCase();
  if (/^(opus|sonnet|haiku|fable)( \d+\.\d+)?$/.test(m)) return model.charAt(0).toUpperCase() + model.slice(1); // already a label, or a bare family name
  const version = /(\d+)[-.](\d+)/.exec(m);
  const v = version ? `${version[1]}.${version[2]}` : "";
  if (m.includes("opus")) return `Opus${v ? " " + v : ""}`;
  if (m.includes("sonnet")) return `Sonnet${v ? " " + v : ""}`;
  if (m.includes("haiku")) return `Haiku${v ? " " + v : ""}`;
  if (m.includes("fable")) return "Fable";
  return model ? clip(model, 24) : "inherited model";
}
