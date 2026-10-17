// bb-plugin-navaigate-workspace — backend entry.
//
// One read-only job: tell the usage dock which pooled account a chat is
// actually running on. bb's Account Pooler pins each provider session to an
// account (table pool_affinity) and keeps a current fallback per provider
// (pool_active_account). It does not publish that mapping over RPC, so we read
// its SQLite file read-only. If the file or tables are missing (pooler off or
// changed) we return nulls and the dock falls back to the local login.
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import { defineRpcContract, type BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { createTodoEngine, todoItemSchema, TODO_STATUSES } from "./server-todo";
import { createVoice } from "./server-voice";
import { agendaSchema, createHome, homeAccountSchema } from "./server-home";
import { createInbox, inboxSchema } from "./server-inbox";
import { createInboxPage, messageSchema, pageSchema, sortStatusSchema } from "./server-inbox-page";
import { createSocial, socialSchema } from "./server-social";
import { calendarInput, calendlySchema, createCalendar } from "./server-calendar";
import { AUDIENCE_PLATFORMS, audienceSchema, createAudience } from "./server-audience";
import { HARNESSES, askLogOutput, askRouteInput, askRouteOutput, createAsk } from "./server-ask";
import { createMachine, handOff, machineHandoffInput, machineHandoffOutput, machineLog, machineLogOutput, machineStateSchema, machineTell } from "./server-machine";
import { createWhere, machineAnswers, whereSchema } from "./server-where";
import { KEY_NAMES, keyStatus, profile, profileSchema, saveKeys, saveProfile, testKey } from "./server-profile";
import { poolList, poolListSchema, poolPutFirst } from "./server-pool";
import { createMachines, hostMachineSchema } from "./server-machines";
import { createHolds, holdStateSchema } from "./server-hold";
import { createTeleport, teleportLinkSchema, teleportMoveInput, teleportMoveOutput } from "./server-teleport";
import { createUsageTrend, trendSchema } from "./server-usage-trend";

// ---- Rail state: tags, "come back later" marks, section order (synced via bb) ----

const TAG_COLORS = ["gold", "ink", "green", "red", "plum", "teal", "sand"] as const;
const tagSchema = z.object({ id: z.string(), name: z.string().min(1).max(32), color: z.enum(TAG_COLORS) });
const laterSchema = z.object({ reason: z.enum(["revisit", "done", "mistake"]), at: z.number() });
// Rail groups: the member's own folders that hold whole projects (and other
// groups). They live only here, so nothing changes on disk or in bb itself.
// `within` maps a section id ("project:<id>" or "group:<id>") to its group id.
// Both fields default, so state saved before groups existed loads unchanged.
const groupSchema = z.object({ id: z.string(), name: z.string().min(1).max(48) });
const sectionId = z.string().min(1).max(80).regex(/^(project|group):/);
const stateSchema = z.object({
  tags: z.array(tagSchema),
  assign: z.record(z.string(), z.array(z.string())),
  later: z.record(z.string(), laterSchema),
  order: z.array(z.string()),
  collapsed: z.array(z.string()),
  groups: z.array(groupSchema).default([]),
  within: z.record(z.string(), z.string()).default({}),
  // Project colours for the rail (projectId -> palette name). Plain strings so a
  // name the rail no longer knows never fails the parse; the rail falls back.
  colors: z.record(z.string(), z.string().max(16)).default({}),
});
export type RailState = z.infer<typeof stateSchema>;
const EMPTY: RailState = { tags: [], assign: {}, later: {}, order: [], collapsed: [], groups: [], within: {}, colors: {} };
const PROJECT_COLORS = ["gold", "orange", "green", "teal", "plum", "rose", "slate"] as const;
const execSchema = z.object({ model: z.string(), reasoningLevel: z.string() });
const ids = z.array(z.string().min(1).max(64)).min(1).max(200);

export const rpcContract = defineRpcContract({
  state_get: { input: z.null(), output: stateSchema },
  machine_state: { input: z.null(), output: machineStateSchema },
  machine_refresh: { input: z.null(), output: machineStateSchema },
  machine_handoff: { input: machineHandoffInput, output: machineHandoffOutput },
  machine_log: { input: z.object({ threadId: z.string().min(1) }), output: machineLogOutput },
  machine_tell: { input: z.object({ threadId: z.string().min(1), text: z.string().trim().min(1).max(20_000) }), output: z.object({ ok: z.boolean() }) },
  machine_test: { input: z.object({ sshHost: z.string().trim().min(1).max(120) }), output: z.object({ ok: z.boolean(), message: z.string() }) },
  where_now: { input: z.null(), output: whereSchema },
  // The always-on machine as a second machine of this bb: its host and this project's checkout there.
  machine_host: { input: z.object({ projectId: z.string().min(1).nullable() }), output: hostMachineSchema },
  machine_host_link: { input: z.object({ projectId: z.string().min(1) }), output: hostMachineSchema },
  // Hold a message until the chat's sub-agents finish.
  hold_state: { input: z.object({ threadId: z.string().min(1) }), output: holdStateSchema },
  hold_create: { input: z.object({ threadId: z.string().min(1), text: z.string().trim().min(1).max(100_000) }), output: holdStateSchema },
  hold_cancel: { input: z.object({ threadId: z.string().min(1) }), output: z.object({ text: z.string().nullable() }) },
  // Teleport-lite: move a chat to the always-on machine and back (a brief, since bb cannot fork across machines).
  teleport_link: { input: z.object({ threadId: z.string().min(1) }), output: teleportLinkSchema },
  teleport_move: { input: teleportMoveInput, output: teleportMoveOutput },
  teleport_back: { input: z.object({ threadId: z.string().min(1) }), output: teleportMoveOutput },
  profile_get: { input: z.null(), output: profileSchema },
  profile_save: { input: profileSchema, output: profileSchema },
  keys_status: { input: z.null(), output: z.record(z.enum(KEY_NAMES), z.boolean()) },
  // Partial: Set up sends only the keys the member entered (any number from none to all).
  keys_save: { input: z.partialRecord(z.enum(KEY_NAMES), z.string().max(400)), output: z.record(z.enum(KEY_NAMES), z.boolean()) },
  keys_test: { input: z.object({ name: z.enum(KEY_NAMES), value: z.string().max(400) }), output: z.object({ ok: z.boolean(), message: z.string() }) },
  tag_create: { input: z.object({ name: z.string().trim().min(1).max(32), color: z.enum(TAG_COLORS) }), output: tagSchema },
  tag_update: { input: z.object({ id: z.string(), name: z.string().trim().min(1).max(32).optional(), color: z.enum(TAG_COLORS).optional() }), output: stateSchema },
  tag_delete: { input: z.object({ id: z.string() }), output: stateSchema },
  tag_apply: { input: z.object({ threadIds: ids, tagId: z.string(), on: z.boolean() }), output: stateSchema },
  later_set: { input: z.object({ threadIds: ids, reason: z.enum(["revisit", "done", "mistake"]).nullable() }), output: stateSchema },
  order_set: { input: z.object({ order: z.array(z.string().max(80)).max(200) }), output: stateSchema },
  collapsed_set: { input: z.object({ id: z.string().max(80), collapsed: z.boolean() }), output: stateSchema },
  forget_threads: { input: z.object({ threadIds: ids }), output: stateSchema },
  project_color_set: { input: z.object({ projectId: z.string().min(1).max(80), color: z.enum(PROJECT_COLORS).nullable() }), output: stateSchema },
  // Model and effort per chat for the two-line rail rows, asked in batches.
  thread_exec: { input: z.object({ ids: z.array(z.string().min(1).max(64)).min(1).max(200) }), output: z.record(z.string(), execSchema.nullable()) },
  group_create: {
    input: z.object({ name: z.string().trim().min(1).max(48), parentId: z.string().nullable(), members: z.array(sectionId).max(50).optional() }),
    output: groupSchema,
  },
  group_update: { input: z.object({ id: z.string(), name: z.string().trim().min(1).max(48) }), output: stateSchema },
  group_delete: { input: z.object({ id: z.string() }), output: stateSchema },
  group_place: {
    input: z.object({ ids: z.array(sectionId).min(1).max(50), groupId: z.string().nullable(), order: z.array(z.string().max(80)).max(200).optional() }),
    output: stateSchema,
  },
  todo_list: { input: z.null(), output: z.object({ items: z.array(todoItemSchema), available: z.boolean() }) },
  todo_add: {
    input: z.object({
      titles: z.array(z.string().trim().min(1).max(300)).min(1).max(50),
      bbProjectId: z.string().min(1),
      bbProjectName: z.string().min(1).max(80),
      folderId: z.string().nullable(),
      threadId: z.string().nullable(),
    }),
    output: z.object({ keys: z.array(z.string()) }),
  },
  todo_status: { input: z.object({ taskId: z.string(), status: z.enum(TODO_STATUSES) }), output: z.object({ ok: z.boolean() }) },
  todo_move: {
    input: z.object({ taskId: z.string(), status: z.enum(TODO_STATUSES), beforeTaskId: z.string().nullable(), afterTaskId: z.string().nullable() }),
    output: z.object({ ok: z.boolean() }),
  },
  todo_rename: { input: z.object({ taskId: z.string(), title: z.string().trim().min(1).max(300) }), output: z.object({ ok: z.boolean() }) },
  todo_delete: { input: z.object({ taskId: z.string() }), output: z.object({ ok: z.boolean() }) },
  todo_link_thread: { input: z.object({ taskId: z.string(), threadId: z.string(), on: z.boolean() }), output: z.object({ ok: z.boolean() }) },
  todo_link_folder: { input: z.object({ taskId: z.string(), folderId: z.string().nullable() }), output: z.object({ ok: z.boolean() }) },
  agents_list: {
    input: z.null(),
    output: z.object({
      agents: z.array(z.object({ name: z.string(), description: z.string(), model: z.string().nullable(), color: z.string().nullable(), group: z.string().nullable(), file: z.string() })),
    }),
  },
  home_accounts: { input: z.null(), output: z.object({ accounts: z.array(homeAccountSchema) }) },
  home_agenda: { input: z.null(), output: agendaSchema },
  home_inbox: { input: z.null(), output: inboxSchema },
  ask_route: { input: askRouteInput, output: askRouteOutput },
  ask_commit: { input: z.object({ decisionId: z.string(), harness: z.enum(HARNESSES).nullable() }), output: z.object({ ok: z.boolean() }) },
  ask_log: { input: z.null(), output: askLogOutput },
  home_social: { input: z.null(), output: socialSchema },
  home_audience: { input: z.null(), output: audienceSchema },
  calendar_range: { input: calendarInput, output: agendaSchema },
  calendar_calendly: { input: z.null(), output: calendlySchema },
  inbox_resort: { input: z.null(), output: z.object({ started: z.boolean() }) },
  inbox_status: { input: z.null(), output: z.object({ running: z.boolean(), done: z.number(), total: z.number(), startedAt: z.number() }) },
  // Inbox page: read-only list, Jev sort with live status, one message body.
  inbox_list: { input: z.object({ days: z.union([z.literal(7), z.literal(30)]), refresh: z.boolean() }), output: pageSchema },
  inbox_sort: {
    input: z.object({ days: z.union([z.literal(7), z.literal(30)]), all: z.boolean() }),
    output: z.object({ started: z.boolean(), total: z.number(), remembered: z.number(), count: z.number() }),
  },
  inbox_sort_status: { input: z.null(), output: sortStatusSchema },
  inbox_message: { input: z.object({ account: z.string().email().max(200), id: z.string().regex(/^[A-Za-z0-9_-]{6,64}$/) }), output: messageSchema },
  audience_link: { input: z.object({ platform: z.enum(AUDIENCE_PLATFORMS), url: z.string().trim().url().startsWith("https://").max(300).nullable() }), output: audienceSchema },
  home_brief: { input: z.null(), output: z.object({ date: z.string().nullable(), headline: z.string().nullable(), path: z.string().nullable() }) },
  voice_status: { input: z.null(), output: z.object({ configured: z.boolean(), agentId: z.string().nullable() }) },
  voice_token: { input: z.null(), output: z.object({ token: z.string(), agentId: z.string() }) },
  pool_account: {
    input: z.object({ provider: z.enum(["claude", "codex"]), sessionId: z.string().max(200).nullable() }),
    output: z.object({ accountId: z.string().nullable(), activeAccountId: z.string().nullable() }),
  },
  // Hover card under the chat box: every account's windows over time, forecasts, busiest chats.
  usage_trend: { input: z.null(), output: trendSchema },
  // Claude accounts for the account chip: list, and put one first in the failover order.
  pool_list: { input: z.null(), output: poolListSchema },
  pool_put_first: { input: z.object({ accountId: z.string().uuid() }), output: poolListSchema },
});

function poolDbPath(): string {
  const dataDir = process.env.BB_DATA_DIR || path.join(os.homedir(), ".bb");
  return path.join(dataDir, "plugins", "account-pool", "data.db");
}

export default async function plugin(bb: BbPluginApi) {
  bb.log.info("navaigate-workspace loaded");

  let db: Database.Database | null = null;
  const open = (): Database.Database | null => {
    if (db) return db;
    const file = poolDbPath();
    if (!fs.existsSync(file)) return null;
    try {
      db = new Database(file, { readonly: true, fileMustExist: true });
      return db;
    } catch (e) {
      bb.log.warn(`account-pool db unavailable: ${String(e)}`);
      return null;
    }
  };
  bb.onDispose(() => {
    db?.close();
    db = null;
  });

  // Serialised read-modify-write over one kv record; every change is broadcast
  // so every open window (and the other Mac) refetches.
  let chain: Promise<unknown> = Promise.resolve();
  const read = async (): Promise<RailState> => {
    const raw = await bb.storage.kv.get<unknown>("rail-state");
    const parsed = stateSchema.safeParse(raw);
    return parsed.success ? parsed.data : { ...EMPTY };
  };
  const mutate = (fn: (s: RailState) => RailState | void): Promise<RailState> => {
    const next = chain.then(async () => {
      const s = await read();
      const out = fn(s) ?? s;
      await bb.storage.kv.set("rail-state", out);
      bb.realtime.publish("rail-state", { at: Date.now() });
      return out;
    });
    chain = next.catch(() => undefined);
    return next;
  };

  /** Put a project or group section inside `groupId` (null = top level); a group can never go inside itself. */
  const placeIn = (s: RailState, member: string, groupId: string | null) => {
    if (!groupId) {
      delete s.within[member];
      return;
    }
    for (let cur: string | undefined = groupId; cur; cur = s.within[`group:${cur}`])
      if (`group:${cur}` === member) throw new Error("A group cannot go inside itself.");
    s.within[member] = groupId;
  };

  const poolAccount = (provider: "claude" | "codex", sessionId: string | null): { accountId: string | null; activeAccountId: string | null } => {
    const conn = open();
    if (!conn) return { accountId: null, activeAccountId: null };
    try {
      const active = conn.prepare("SELECT account_id FROM pool_active_account WHERE provider = ?").get(provider) as
        | { account_id: string }
        | undefined;
      let pinned: { account_id: string } | undefined;
      if (sessionId) {
        // affinity_key is JSON: ["claude","host_…","session:<id>"]
        pinned = conn
          .prepare("SELECT account_id FROM pool_affinity WHERE affinity_key LIKE ? AND affinity_key LIKE ? ORDER BY last_used_at DESC LIMIT 1")
          .get(`["${provider}",%`, `%"session:${sessionId.replace(/[%_"\\]/g, "")}"]`) as { account_id: string } | undefined;
      }
      return { accountId: pinned?.account_id ?? null, activeAccountId: active?.account_id ?? null };
    } catch (e) {
      bb.log.warn(`pool lookup failed: ${String(e)}`);
      return { accountId: null, activeAccountId: null };
    }
  };

  const todo = createTodoEngine(bb);
  const voice = createVoice(bb);
  const home = createHome(bb, voice.settings as unknown as { get(): Promise<Record<string, unknown>> });
  const inbox = createInbox(bb);
  const inboxPage = createInboxPage(bb, home.composioKey);
  const ask = createAsk(bb);
  const social = createSocial(bb);
  const calendar = createCalendar(bb, home);
  const audience = createAudience(bb, voice.settings as unknown as Parameters<typeof createAudience>[1]);
  const machine = createMachine(bb);
  const where = createWhere();
  const machines = createMachines(bb);
  const holds = createHolds(bb);
  const teleport = createTeleport(bb, machines);
  const ok = { ok: true };

  /** A service stops at once on reload, even while its current pass waits on the network. */
  const orAbort = (work: Promise<unknown>, signal: AbortSignal) =>
    new Promise<void>((resolve) => {
      signal.addEventListener("abort", () => resolve(), { once: true });
      work.then(() => resolve(), () => resolve());
    });

  // Real-signal pass every 20s: chats starting or finishing move their tasks.
  bb.background.service("todo-sync", {
    async start(signal) {
      while (!signal.aborted) {
        await orAbort(todo.sync().catch((e) => bb.log.warn(`todo sync: ${String(e)}`)), signal);
        if (signal.aborted) break;
        await new Promise((r) => {
          const t = setTimeout(r, 20_000);
          signal.addEventListener("abort", () => { clearTimeout(t); r(null); }, { once: true });
        });
      }
    },
  });

  // Usage history for plan advice, kept even when the Home page is closed.
  bb.background.service("usage-history", {
    async start(signal) {
      while (!signal.aborted) {
        await orAbort(home.accounts().catch((e) => bb.log.warn(`usage history: ${String(e)}`)), signal);
        if (signal.aborted) break;
        await new Promise((r) => {
          const t = setTimeout(r, 30 * 60_000);
          signal.addEventListener("abort", () => { clearTimeout(t); r(null); }, { once: true });
        });
      }
    },
  });

  // Usage trend for the hover card: every account's windows every 3 minutes
  // (cached reads only; Cursor at most every 15 minutes) and the chats behind them.
  const trend = createUsageTrend(bb, {
    cursorUsage: () => home.cursorUsage(),
    planLabel: (harness, raw, email) => home.planLabel(harness, raw, email),
    accountFor: (provider, sessionId) => {
      const r = poolAccount(provider, sessionId);
      return r.accountId ?? r.activeAccountId;
    },
  });
  bb.background.service("usage-trend", {
    async start(signal) {
      while (!signal.aborted) {
        await orAbort(trend.sample(), signal);
        if (signal.aborted) break;
        await new Promise((r) => {
          const t = setTimeout(r, 3 * 60_000);
          signal.addEventListener("abort", () => { clearTimeout(t); r(null); }, { once: true });
        });
      }
    },
  });

  // Daily follower snapshot for the Audience cards, kept even when Home is closed.
  bb.background.service("audience-snapshot", {
    async start(signal) {
      while (!signal.aborted) {
        await orAbort(audience.audience().catch((e) => bb.log.warn(`audience: ${String(e)}`)), signal);
        if (signal.aborted) break;
        await new Promise((r) => {
          const t = setTimeout(r, 6 * 60 * 60_000);
          signal.addEventListener("abort", () => { clearTimeout(t); r(null); }, { once: true });
        });
      }
    },
  });

  // "We've got this, this and this to do" -> tasks linked to the chat it was said in.
  bb.agents.registerTool({
    name: "workspace_todo",
    description:
      "Manage the user's to-do list in NavAIgate Workspace (stored in bb Tasks). action=add with items[] records each as a task linked to this chat; action=list shows open items for this chat; action=done marks keys (e.g. NAV-4) done.",
    instructions:
      "When the user lists things that need doing (\"we've got X, Y and Z to do\", \"add that to the list\", \"remind me to…\"), call workspace_todo with action=add and one short imperative item per thing. Do not mark items done unless they say so. Mention the keys you created.",
    presentation: { label: { pending: "Updating the to-do list", completed: "Updated the to-do list" } },
    parameters: z.object({
      action: z.enum(["add", "list", "done"]),
      items: z.array(z.string().trim().min(1).max(300)).max(30).optional(),
      keys: z.array(z.string()).max(30).optional(),
    }),
    async execute({ action, items, keys }, { threadId, projectId }) {
      if (action === "add") {
        if (!items?.length) return "Nothing to add: pass items[].";
        if (!projectId) return "This chat has no project, so there is nowhere to file the to-do items.";
        const proj = await bb.sdk.projects.get({ projectId }).catch(() => null);
        const name = (proj as { name?: string } | null)?.name ?? "Personal";
        const created = await todo.add({ titles: items, bbProjectId: projectId, bbProjectName: name, folderId: null, threadId: threadId ?? null });
        return `Added ${created.length} to-do item${created.length === 1 ? "" : "s"}, linked to this chat: ${created.join(", ")}. They show in the To-do panel (⌘⇧D) and on the Board.`;
      }
      const all = await todo.list();
      if (action === "done") {
        const wanted = new Set((keys ?? []).map((k) => k.toUpperCase()));
        const hit = all.filter((t) => wanted.has(t.key.toUpperCase()));
        for (const t of hit) await todo.setStatus(t.id, "done", "Agent");
        return hit.length ? `Marked done: ${hit.map((t) => t.key).join(", ")}.` : "No matching keys.";
      }
      const mine = all.filter((t) => t.threads.some((x) => x.threadId === threadId) && t.status !== "done" && t.status !== "canceled");
      return mine.length ? mine.map((t) => `${t.key} [${t.status}] ${t.title}`).join("\n") : "No open to-do items linked to this chat.";
    },
  });

  bb.rpc.register(rpcContract, {
    machine_state: () => machine.get(),
    machine_refresh: () => machine.refresh(),
    where_now: () => where.where(),
    machine_host: ({ projectId }) => machines.forProject(projectId),
    machine_host_link: ({ projectId }) => machines.link(projectId),
    hold_state: ({ threadId }) => holds.state(threadId),
    hold_create: ({ threadId, text }) => holds.create(threadId, text),
    hold_cancel: ({ threadId }) => holds.cancel(threadId),
    teleport_link: ({ threadId }) => teleport.getLink(threadId),
    teleport_move: async (input) => {
      const res = await teleport.move(input);
      if (res.via === "handoff") await machine.refresh();
      return res;
    },
    teleport_back: ({ threadId }) => teleport.back(threadId),
    machine_log: ({ threadId }) => machineLog(threadId),
    machine_tell: ({ threadId, text }) => machineTell(threadId, text),
    machine_handoff: async (input) => {
      const res = await handOff(input);
      await machine.refresh();
      return res;
    },
    machine_test: async ({ sshHost }) => {
      const ok = await machineAnswers(sshHost);
      return ok ? { ok, message: "Connected over SSH." } : { ok, message: "SSH didn't answer. Check the host name, that the machine is on, and that your SSH key is set up." };
    },
    profile_get: () => profile(),
    profile_save: async (p) => {
      const saved = saveProfile(p);
      bb.realtime.publish("profile", { at: Date.now() });
      await machine.refresh().catch(() => undefined);
      return saved;
    },
    keys_status: () => keyStatus(),
    keys_save: (keys) => saveKeys(keys),
    keys_test: ({ name, value }) => testKey(name, value),
    agents_list: () => ({ agents: listAgents() }),
    home_accounts: async () => ({ accounts: await home.accounts() }),
    home_agenda: () => home.agenda(),
    home_inbox: () => inbox.inbox(),
    ask_route: (input) => ask.route(input),
    ask_commit: ({ decisionId, harness }) => ask.commit(decisionId, harness),
    ask_log: () => ask.recent(),
    home_social: () => social.social(),
    home_audience: () => audience.audience(),
    calendar_range: ({ from, to }) => calendar.range(from, to),
    calendar_calendly: () => calendar.calendly(),
    inbox_resort: () => inbox.resort(),
    inbox_status: () => inbox.status(),
    inbox_list: ({ days, refresh }) => inboxPage.list(days, refresh),
    inbox_sort: ({ days, all }) => inboxPage.sort(days, all),
    inbox_sort_status: () => inboxPage.status(),
    inbox_message: ({ account, id }) => inboxPage.message(account, id),
    audience_link: ({ platform, url }) => audience.link(platform, url),
    home_brief: () => home.briefLatest(),
    voice_status: () => voice.status(),
    voice_token: () => voice.token(),
    todo_list: async () => {
      try {
        return { items: await todo.list(), available: true };
      } catch (e) {
        bb.log.warn(`todo list: ${String(e)}`);
        return { items: [], available: false };
      }
    },
    todo_add: async (input) => ({ keys: await todo.add(input) }),
    todo_status: async ({ taskId, status }) => (await todo.setStatus(taskId, status), ok),
    todo_move: async ({ taskId, status, beforeTaskId, afterTaskId }) => (await todo.move(taskId, status, beforeTaskId, afterTaskId), ok),
    todo_rename: async ({ taskId, title }) => (await todo.rename(taskId, title), ok),
    todo_delete: async ({ taskId }) => (await todo.remove(taskId), ok),
    todo_link_thread: async ({ taskId, threadId, on }) => (await todo.linkThread(taskId, threadId, on), ok),
    todo_link_folder: async ({ taskId, folderId }) => (await todo.linkFolder(taskId, folderId), ok),
    state_get: () => read(),
    tag_create: async ({ name, color }) => {
      const tag = { id: `t_${randomUUID().slice(0, 8)}`, name, color };
      await mutate((s) => {
        if (s.tags.some((t) => t.name.toLowerCase() === name.toLowerCase())) throw new Error(`A tag called "${name}" already exists.`);
        if (s.tags.length >= 24) throw new Error("Tag limit reached (24).");
        s.tags.push(tag);
      });
      return tag;
    },
    tag_update: ({ id, name, color }) =>
      mutate((s) => {
        const t = s.tags.find((x) => x.id === id);
        if (!t) throw new Error("Tag not found.");
        if (name) t.name = name;
        if (color) t.color = color;
      }),
    tag_delete: ({ id }) =>
      mutate((s) => {
        s.tags = s.tags.filter((t) => t.id !== id);
        for (const k of Object.keys(s.assign)) {
          s.assign[k] = s.assign[k].filter((x) => x !== id);
          if (s.assign[k].length === 0) delete s.assign[k];
        }
      }),
    tag_apply: ({ threadIds, tagId, on }) =>
      mutate((s) => {
        if (!s.tags.some((t) => t.id === tagId)) throw new Error("Tag not found.");
        for (const id of threadIds) {
          const cur = new Set(s.assign[id] ?? []);
          if (on) cur.add(tagId);
          else cur.delete(tagId);
          if (cur.size) s.assign[id] = [...cur];
          else delete s.assign[id];
        }
      }),
    later_set: ({ threadIds, reason }) =>
      mutate((s) => {
        for (const id of threadIds) {
          if (reason) s.later[id] = { reason, at: Date.now() };
          else delete s.later[id];
        }
      }),
    order_set: ({ order }) =>
      mutate((s) => {
        s.order = order;
      }),
    collapsed_set: ({ id, collapsed }) =>
      mutate((s) => {
        const set = new Set(s.collapsed);
        if (collapsed) set.add(id);
        else set.delete(id);
        s.collapsed = [...set];
      }),
    project_color_set: ({ projectId, color }) =>
      mutate((s) => {
        if (color) s.colors[projectId] = color;
        else delete s.colors[projectId];
      }),
    // bb keeps a chat's model and effort per turn, not on its list row, so ask
    // for each chat's current execution options, eight at a time. A chat that
    // has never run answers null; one that fails is left out and asked later.
    thread_exec: async ({ ids: threadIds }) => {
      const out: Record<string, { model: string; reasoningLevel: string } | null> = {};
      let next = 0;
      const worker = async () => {
        while (next < threadIds.length) {
          const threadId = threadIds[next++];
          try {
            const r = await bb.sdk.threads.defaultExecutionOptions({ threadId });
            out[threadId] = r ? { model: r.model, reasoningLevel: r.reasoningLevel } : null;
          } catch {
            /* left out: the rail asks again later */
          }
        }
      };
      await Promise.all(Array.from({ length: Math.min(8, threadIds.length) }, worker));
      return out;
    },
    forget_threads: ({ threadIds }) =>
      mutate((s) => {
        for (const id of threadIds) {
          delete s.assign[id];
          delete s.later[id];
        }
      }),
    group_create: async ({ name, parentId, members }) => {
      const group = { id: `g_${randomUUID().slice(0, 8)}`, name };
      await mutate((s) => {
        if (s.groups.length >= 60) throw new Error("Group limit reached (60).");
        if (parentId && !s.groups.some((g) => g.id === parentId)) throw new Error("Group not found.");
        s.groups.push(group);
        if (parentId) s.within[`group:${group.id}`] = parentId;
        for (const m of members ?? []) placeIn(s, m, group.id);
      });
      return group;
    },
    group_update: ({ id, name }) =>
      mutate((s) => {
        const g = s.groups.find((x) => x.id === id);
        if (!g) throw new Error("Group not found.");
        g.name = name;
      }),
    group_delete: ({ id }) =>
      mutate((s) => {
        const sid = `group:${id}`;
        if (!s.groups.some((g) => g.id === id)) throw new Error("Group not found.");
        // Its contents move up one level, keeping their place in the order.
        const up = s.within[sid];
        for (const [k, v] of Object.entries(s.within)) {
          if (v !== id) continue;
          if (up) s.within[k] = up;
          else delete s.within[k];
        }
        delete s.within[sid];
        s.groups = s.groups.filter((g) => g.id !== id);
        s.order = s.order.filter((x) => x !== sid);
        s.collapsed = s.collapsed.filter((x) => x !== sid);
      }),
    group_place: ({ ids: members, groupId, order }) =>
      mutate((s) => {
        if (groupId && !s.groups.some((g) => g.id === groupId)) throw new Error("Group not found.");
        for (const m of members) placeIn(s, m, groupId);
        if (order) s.order = order;
      }),
    pool_list: () => poolList(),
    pool_put_first: async ({ accountId }) => {
      const res = await poolPutFirst(accountId);
      bb.log.info(`pool failover order set: ${res.accounts.map((a) => `${a.short}=${a.priority}`).join(", ")}`);
      bb.realtime.publish("pool-order", { at: Date.now() });
      return res;
    },
    pool_account: ({ provider, sessionId }) => poolAccount(provider, sessionId),
    usage_trend: () => trend.card(),
  });
}

// Defined agents (Claude Code format: one .md per agent with YAML front matter)
// from ~/.claude/agents — the fleet the Agents panel can start with one click.
function listAgents() {
  const dir = path.join(os.homedir(), ".claude", "agents");
  let files: string[] = [];
  try {
    files = fs.readdirSync(dir).filter((f) => f.endsWith(".md") && f.toLowerCase() !== "readme.md");
  } catch {
    return [];
  }
  const out: Array<{ name: string; description: string; model: string | null; color: string | null; group: string | null; file: string }> = [];
  for (const f of files) {
    try {
      const text = fs.readFileSync(path.join(dir, f), "utf8").slice(0, 8000);
      const m = text.match(/^---\n([\s\S]*?)\n---/);
      if (!m) continue;
      const lines = m[1].split("\n");
      const field = (k: string) => {
        const i = lines.findIndex((l) => l.startsWith(`${k}:`));
        if (i < 0) return null;
        const v = lines[i].slice(k.length + 1).trim();
        // YAML block scalars (description: > or |): join the indented lines below.
        if (/^[>|][+-]?$/.test(v)) {
          const body: string[] = [];
          for (let j = i + 1; j < lines.length && (/^\s/.test(lines[j]) || lines[j] === ""); j++) body.push(lines[j].trim());
          return body.join(" ").replace(/\s+/g, " ").trim() || null;
        }
        return v.replace(/^["']|["']$/g, "") || null;
      };
      const name = field("name") ?? f.replace(/\.md$/, "");
      out.push({ name, description: (field("description") ?? "").slice(0, 220), model: field("model"), color: field("color"), group: field("group"), file: path.join(dir, f) });
    } catch {
      /* unreadable file: skip */
    }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}
