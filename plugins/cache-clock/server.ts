// Cache Clock — backend.
//
// Shows how long a Claude Code thread's prompt cache stays warm after the last
// reply, optionally keeps it warm with a small ping message (visible in the chat), and on request asks
// the thread's own agent to write a handoff brief for a fresh thread.
//
// bb does not expose the provider's cache TTL, so the TTL is a setting and the
// countdown is counted from the last completed turn.
import { defineRpcContract, type BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import {
  HANDOFF_REQUEST,
  PING_TEXT,
  appendPingLog,
  TICK_MS,
  decideKeepWarm,
  expiresAt,
  extractHandoff,
  isHandoffRequestText,
  isPingText,
  isSupportedProvider,
  keepWarmSchema,
  pickRecentClaudeThreads,
  sortOverview,
  handoffSchema,
  statusSchema,
  type ClockStatus,
  type Handoff,
  type KeepWarm,
} from "./model";

const threadIdSchema = z.string().regex(/^thr_[a-zA-Z0-9_-]+$/);

export const rpcContract = defineRpcContract({
  status: { input: z.object({ threadId: threadIdSchema }), output: statusSchema },
  setKeepWarm: {
    input: z.object({ threadId: threadIdSchema, on: z.boolean() }),
    output: statusSchema,
  },
  requestHandoff: { input: z.object({ threadId: threadIdSchema }), output: statusSchema },
  clearHandoff: { input: z.object({ threadId: threadIdSchema }), output: statusSchema },
  overview: {
    input: z.null(),
    output: z.array(z.object({ title: z.string(), status: statusSchema })).max(20),
  },
  open_panel: {
    input: z.object({ threadId: z.string().regex(/^thr_[a-zA-Z0-9_-]+$/), windowId: z.string().min(4).max(64) }),
    output: z.object({ ok: z.boolean() }),
  },
});

/** Realtime channel: payload { threadId }. The banner refetches on it. */
export const CHANGED = "clock-changed";

const RUNNING = new Set(["active", "pending", "starting", "stopping"]);
const kwKey = (threadId: string) => `keepwarm:${threadId}`;
const hoKey = (threadId: string) => `handoff:${threadId}`;
const KW_INDEX = "keepwarm-index";

export default async function plugin(bb: BbPluginApi) {
  const settings = bb.settings.define({
    ttlMinutes: {
      type: "select",
      label: "Cache lifetime",
      options: ["60", "5"],
      experimental_optionLabels: {
        "60": "1 hour (Claude subscription)",
        "5": "5 minutes (API key)",
      },
      default: "60",
    },
    keepWarmMaxHours: {
      type: "number",
      label: "Stop keeping warm after (hours)",
      experimental_schema: z.number().min(0.25).max(12),
      default: 2,
    },
  });

  async function config() {
    const v = await settings.get();
    return { ttlMinutes: Number(v.ttlMinutes) || 60, maxHours: Number(v.keepWarmMaxHours) || 2 };
  }

  async function readKeepWarm(threadId: string): Promise<KeepWarm | null> {
    const raw = await bb.storage.kv.get<unknown>(kwKey(threadId));
    const parsed = keepWarmSchema.safeParse(raw);
    return parsed.success ? parsed.data : null;
  }
  async function writeKeepWarm(threadId: string, value: KeepWarm): Promise<void> {
    await bb.storage.kv.set(kwKey(threadId), value);
    const index = new Set((await bb.storage.kv.get<string[]>(KW_INDEX)) ?? []);
    if (value.enabled) index.add(threadId);
    else index.delete(threadId);
    await bb.storage.kv.set(KW_INDEX, [...index]);
  }
  async function readHandoff(threadId: string): Promise<Handoff | null> {
    const parsed = handoffSchema.safeParse(await bb.storage.kv.get<unknown>(hoKey(threadId)));
    return parsed.success ? parsed.data : null;
  }
  async function writeHandoff(threadId: string, value: Handoff | null): Promise<void> {
    if (value === null) await bb.storage.kv.delete(hoKey(threadId));
    else await bb.storage.kv.set(hoKey(threadId), value);
  }
  function changed(threadId: string) {
    bb.realtime.publish(CHANGED, { threadId });
  }

  async function lastReplyAt(threadId: string): Promise<number | null> {
    const rows = await bb.sdk.threads.events.list({
      threadId,
      types: ["turn/completed"],
      order: "desc",
      limit: "1",
    });
    const row = rows[0];
    return row ? row.createdAt : null;
  }

  async function usedTokens(threadId: string): Promise<number | null> {
    try {
      const ctx = await bb.sdk.threads.context({ threadId });
      return ctx.usage?.usedTokens ?? null;
    } catch {
      return null;
    }
  }

  /**
   * Some Claude Code setups keep a turn open after the reply (a stop hook that
   * does not exit), so thread.idle never fires. Read the latest assistant text
   * directly and collect the brief as soon as it is there.
   */
  async function collectHandoff(threadId: string): Promise<void> {
    const handoff = await readHandoff(threadId);
    if (handoff?.status !== "requested" || Date.now() - handoff.requestedAt < 3000) return;
    try {
      const { output } = await bb.sdk.threads.output({ threadId });
      const brief = extractHandoff(output);
      if (brief) {
        await writeHandoff(threadId, { ...handoff, status: "ready", brief, error: null });
        changed(threadId);
      }
    } catch {
      /* no output yet */
    }
  }

  async function status(threadId: string): Promise<ClockStatus> {
    const { ttlMinutes, maxHours } = await config();
    const thread = await bb.sdk.threads.get({ threadId });
    const supported = isSupportedProvider(thread.providerId);
    await collectHandoff(threadId);
    const [replyAt, tokens, keepWarm, handoff] = await Promise.all([
      supported ? lastReplyAt(threadId) : Promise.resolve(null),
      supported ? usedTokens(threadId) : Promise.resolve(null),
      readKeepWarm(threadId),
      readHandoff(threadId),
    ]);
    return {
      threadId,
      supported,
      providerId: thread.providerId,
      running: RUNNING.has(thread.status),
      lastReplyAt: replyAt,
      ttlMinutes,
      expiresAt: expiresAt(replyAt, ttlMinutes),
      usedTokens: tokens,
      keepWarm,
      keepWarmMaxHours: maxHours,
      handoff,
      now: Date.now(),
    };
  }

  /** Mark our own sends so the dispatch hook does not treat them as the user typing. */
  const submission = (kind: "ping" | "handoff") => ({ pluginId: bb.pluginId, data: { kind } });

  async function sendPing(threadId: string, keepWarm: KeepWarm, replyAt: number | null) {
    const tokens = await usedTokens(threadId);
    const at = Date.now();
    await writeKeepWarm(threadId, {
      ...keepWarm,
      pings: keepWarm.pings + 1,
      lastPingAt: at,
      lastPingForReplyAt: replyAt,
      lastPingCachedTokens: tokens,
      log: appendPingLog(keepWarm.log, at, tokens),
    });
    await bb.sdk.threads.send({
      threadId,
      mode: "queue-if-active",
      input: [{ type: "text", text: PING_TEXT, mentions: [] }],
      pluginSubmission: submission("ping"),
    });
    bb.log.info(`keep-warm ping ${keepWarm.pings + 1} sent to ${threadId}`);
    changed(threadId);
  }

  async function stopKeepWarm(threadId: string, reason: KeepWarm["stoppedReason"]) {
    const current = await readKeepWarm(threadId);
    if (!current || !current.enabled) return;
    await writeKeepWarm(threadId, { ...current, enabled: false, stoppedReason: reason });
    bb.log.info(`keep-warm stopped for ${threadId}: ${reason}`);
    changed(threadId);
  }

  async function tick() {
    const { ttlMinutes, maxHours } = await config();
    const ids = (await bb.storage.kv.get<string[]>(KW_INDEX)) ?? [];
    for (const threadId of ids) {
      try {
        const keepWarm = await readKeepWarm(threadId);
        if (!keepWarm?.enabled) continue;
        let thread;
        try {
          thread = await bb.sdk.threads.get({ threadId });
        } catch {
          await stopKeepWarm(threadId, "thread-gone");
          continue;
        }
        if (thread.archivedAt) {
          await stopKeepWarm(threadId, "thread-gone");
          continue;
        }
        const replyAt = await lastReplyAt(threadId);
        const decision = decideKeepWarm({
          keepWarm,
          lastReplyAt: replyAt,
          ttlMinutes,
          maxHours,
          running: RUNNING.has(thread.status),
          now: Date.now(),
        });
        if (decision.action === "ping") await sendPing(threadId, keepWarm, replyAt);
        else if (decision.action === "stop") await stopKeepWarm(threadId, decision.reason);
      } catch (error) {
        bb.log.warn(`keep-warm tick failed for ${threadId}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  bb.background.service("keep-warm", {
    async start(signal) {
      while (!signal.aborted) {
        await tick();
        await new Promise<void>((resolve) => {
          const timer = setTimeout(resolve, TICK_MS);
          signal.addEventListener("abort", () => {
            clearTimeout(timer);
            resolve();
          }, { once: true });
        });
      }
    },
  });

  // A real message from the user ends keep-warm. Our own pings and handoff
  // requests carry a plugin submission and are ignored. Never blocks.
  bb.experimental_hooks.on("message.dispatch", async (ctx) => {
    try {
      const ours = ctx.experimental_submission?.pluginId === bb.pluginId || ctx.originPluginId === bb.pluginId;
      const text = ctx.input.text ?? "";
      if (!ours && !isPingText(text) && !isHandoffRequestText(text) && ctx.initiator !== "agent") {
        await stopKeepWarm(ctx.thread.id, "user-message");
      }
    } catch (error) {
      bb.log.warn(`dispatch hook: ${error instanceof Error ? error.message : String(error)}`);
    }
    return { action: "proceed" };
  });

  // When a turn ends: refresh every open banner, and collect a pending handoff.
  bb.events.on("thread.idle", async ({ thread, lastAssistantText }) => {
    try {
      const handoff = await readHandoff(thread.id);
      if (handoff?.status === "requested") {
        const brief = extractHandoff(lastAssistantText);
        await writeHandoff(thread.id, brief
          ? { ...handoff, status: "ready", brief, error: null }
          : { ...handoff, status: "failed", error: "The reply did not contain a <handoff> block. Try again." });
      }
    } catch (error) {
      bb.log.warn(`idle handler: ${error instanceof Error ? error.message : String(error)}`);
    }
    changed(thread.id);
  });
  bb.events.on("thread.active", ({ thread }) => changed(thread.id));
  bb.events.on("thread.failed", async ({ thread }) => {
    const handoff = await readHandoff(thread.id);
    if (handoff?.status === "requested") {
      await writeHandoff(thread.id, { ...handoff, status: "failed", error: "The turn failed before the brief was written." });
    }
    changed(thread.id);
  });

  bb.rpc.register(rpcContract, {
    open_panel: async ({ threadId, windowId }) => {
      bb.realtime.publish("open-panel", { threadId, windowId });
      return { ok: true };
    },
    status: ({ threadId }) => status(threadId),
    overview: async () => {
      const now = Date.now();
      const list = await bb.sdk.threads.list({ archived: false, limit: 200 });
      const picked = pickRecentClaudeThreads(list, now, 6 * 60 * 60 * 1000, 20);
      const rows = await Promise.all(
        picked.map(async (t) => {
          try {
            return { title: t.title || "Untitled chat", status: await status(t.id) };
          } catch {
            return null;
          }
        }),
      );
      const ok = rows.filter((r): r is { title: string; status: ClockStatus } => r !== null);
      const order = sortOverview(ok.map((r) => r.status), now).map((st) => st.threadId);
      return order.map((id) => ok.find((r) => r.status.threadId === id)!).filter((r) => r.status.lastReplyAt !== null || r.status.running);
    },
    setKeepWarm: async ({ threadId, on }) => {
      if (on) {
        await writeKeepWarm(threadId, {
          enabled: true,
          startedAt: Date.now(),
          pings: 0,
          lastPingAt: null,
          lastPingForReplyAt: null,
          lastPingCachedTokens: null,
          stoppedReason: null,
        });
        void tick();
      } else {
        await stopKeepWarm(threadId, "manual");
      }
      changed(threadId);
      return status(threadId);
    },
    requestHandoff: async ({ threadId }) => {
      await writeHandoff(threadId, { status: "requested", requestedAt: Date.now(), brief: null, error: null });
      try {
        await bb.sdk.threads.send({
          threadId,
          mode: "queue-if-active",
          input: [{ type: "text", text: HANDOFF_REQUEST, mentions: [] }],
          pluginSubmission: submission("handoff"),
        });
      } catch (error) {
        await writeHandoff(threadId, {
          status: "failed",
          requestedAt: Date.now(),
          brief: null,
          error: error instanceof Error ? error.message : String(error),
        });
      }
      changed(threadId);
      return status(threadId);
    },
    clearHandoff: async ({ threadId }) => {
      await writeHandoff(threadId, null);
      changed(threadId);
      return status(threadId);
    },
  });

  bb.cli.register({
    name: "cache-clock",
    summary: "Cache warmth, keep-warm and handoff for a thread",
    commands: [
      { name: "status", summary: "Show cache warmth for a thread", usage: "bb cache-clock status <thread-id>" },
      { name: "keep-warm", summary: "Turn keep-warm on or off", usage: "bb cache-clock keep-warm <thread-id> on|off" },
    ],
    async run(args) {
      const [command, rawId, flag] = args;
      const parsed = threadIdSchema.safeParse(rawId);
      if (!parsed.success) {
        return { exitCode: 1, stderr: "Usage: bb cache-clock status <thread-id> | keep-warm <thread-id> on|off" };
      }
      if (command === "status") return { exitCode: 0, stdout: JSON.stringify(await status(parsed.data), null, 2) };
      if (command === "keep-warm" && (flag === "on" || flag === "off")) {
        if (flag === "on") {
          await writeKeepWarm(parsed.data, {
            enabled: true, startedAt: Date.now(), pings: 0, lastPingAt: null,
            lastPingForReplyAt: null, lastPingCachedTokens: null, stoppedReason: null,
          });
        } else await stopKeepWarm(parsed.data, "manual");
        changed(parsed.data);
        return { exitCode: 0, stdout: JSON.stringify(await status(parsed.data), null, 2) };
      }
      return { exitCode: 1, stderr: "Usage: bb cache-clock status <thread-id> | keep-warm <thread-id> on|off" };
    },
  });
}
