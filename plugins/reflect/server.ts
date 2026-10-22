// Reflect: spots a lasting rule in a message you send and offers to save it
// to your voice profile, your global CLAUDE.md or a second-brain command.
//
// Detection is a deterministic heuristic (detector.ts) run in the
// message.dispatch hook. It never blocks or changes the message, never calls
// a model, and only looks at messages a human typed.
import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";
import { defineRpcContract, type BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { detectRule, normaliseRule } from "./detector";
import { DEFAULT_VOICE_SECTION, expandHome, Writers, type SaveResult } from "./writers";
import { appendLog, countToday, newestFirst, readLog, savedEntrySchema } from "./savedlog";

const threadIdSchema = z.string().regex(/^thr_[a-zA-Z0-9_-]+$/);

export const candidateSchema = z.object({
  id: z.string(),
  threadId: z.string(),
  rule: z.string(),
  topic: z.enum(["writing", "general"]),
  clauses: z.array(z.string()),
  createdAt: z.number(),
});
export type Candidate = z.infer<typeof candidateSchema>;

const saveResultSchema = z.object({
  target: z.enum(["voice", "claude", "brain"]),
  status: z.enum(["saved", "exists"]),
  where: z.string(),
  note: z.string().nullable(),
});

export const rpcContract = defineRpcContract({
  pending: {
    input: z.object({ threadId: threadIdSchema }),
    output: z.object({
      candidate: candidateSchema.nullable(),
      targets: z.object({ voice: z.boolean(), claude: z.boolean(), brain: z.boolean() }),
    }),
  },
  save: {
    input: z.object({
      threadId: threadIdSchema,
      id: z.string().min(1).max(64),
      target: z.enum(["voice", "claude", "brain"]),
      rule: z.string().trim().min(3).max(500).optional(),
    }),
    output: saveResultSchema,
  },
  dismiss: {
    input: z.object({ threadId: threadIdSchema, id: z.string().min(1).max(64) }),
    output: z.object({ dismissed: z.boolean() }),
  },
  saved: {
    input: z.object({ limit: z.number().int().min(1).max(200).optional() }),
    output: z.object({ entries: z.array(savedEntrySchema), today: z.number(), total: z.number() }),
  },
  test: {
    input: z.object({ text: z.string().max(4000) }),
    output: z.object({
      rule: z.string().nullable(),
      topic: z.enum(["writing", "general"]).nullable(),
    }),
  },
  paths: {
    input: z.null(),
    output: z.object({
      enabled: z.boolean(),
      voice: z.string(),
      voiceSection: z.string(),
      commitVoice: z.boolean(),
      pushVoice: z.boolean(),
      claude: z.string(),
      brain: z.string(),
    }),
  },
  open_panel: {
    input: z.object({ threadId: z.string().regex(/^thr_[a-zA-Z0-9_-]+$/), windowId: z.string().min(4).max(64) }),
    output: z.object({ ok: z.boolean() }),
  },
});

export const CHANGED = "reflect-changed";
const pendingKey = (threadId: string) => `pending:${threadId}`;
const BRAIN_SAVED_KEY = "brain-saved";
const SAVED_LOG_KEY = "saved-log";

export default async function plugin(bb: BbPluginApi) {
  const home = homedir();
  const settings = bb.settings.define({
    enabled: { type: "boolean", label: "Watch my messages for lasting rules", default: true },
    voiceProfilePath: {
      type: "string",
      label: "Voice profile path (markdown, optional)",
      description: "A style or voice guide your agents read. Leave empty to hide this button. ~ means your home folder.",
      default: "",
    },
    voiceSection: {
      type: "string",
      label: "Section in the voice profile",
      description: "Rules go at the end of this ## section; it is created if missing.",
      default: DEFAULT_VOICE_SECTION,
    },
    commitVoice: { type: "boolean", label: "Commit the voice profile after each save (when it is in a git repo)", default: true },
    pushVoice: { type: "boolean", label: "Also push after committing", default: false },
    claudeMdPath: {
      type: "string",
      label: "Global CLAUDE.md path",
      description: "Leave empty to hide this button.",
      default: join(home, ".claude/CLAUDE.md"),
    },
    brainCommand: {
      type: "string",
      label: "Second-brain command (optional)",
      description: "Run with {rule} and {thread} filled in, without a shell, e.g. mynotes add \"Rule: {rule}\". Leave empty to hide this button.",
      default: "",
    },
  });

  const writers = new Writers("/tmp/reflect/backups");

  async function getPending(threadId: string): Promise<Candidate | null> {
    const raw = await bb.storage.kv.get<unknown>(pendingKey(threadId));
    const parsed = candidateSchema.safeParse(raw);
    return parsed.success ? parsed.data : null;
  }

  async function setPending(threadId: string, candidate: Candidate | null): Promise<void> {
    if (candidate) await bb.storage.kv.set(pendingKey(threadId), candidate);
    else await bb.storage.kv.delete(pendingKey(threadId));
    bb.realtime.publish(CHANGED, { threadId });
  }

  async function consider(threadId: string, text: string): Promise<Candidate | null> {
    const detected = detectRule(text);
    if (!detected) return null;
    const candidate: Candidate = {
      id: randomUUID().slice(0, 8),
      threadId,
      rule: detected.rule,
      topic: detected.topic,
      clauses: detected.clauses,
      createdAt: Date.now(),
    };
    // One card per message: the newest rule replaces any unanswered one.
    await setPending(threadId, candidate);
    bb.log.info(`rule candidate on ${threadId}: ${candidate.rule}`);
    return candidate;
  }

  bb.experimental_hooks.on("message.dispatch", (ctx) => {
    // Never block or alter the message. Only human-typed messages count.
    if (ctx.initiator === "user" && ctx.senderThreadId === null) {
      const threadId = ctx.thread.id;
      const text = ctx.input.text;
      void (async () => {
        try {
          const { enabled } = await settings.get();
          if (enabled) await consider(threadId, text);
        } catch (error) {
          bb.log.warn(`reflect detection failed: ${error instanceof Error ? error.message : String(error)}`);
        }
      })();
    }
    return { action: "proceed" };
  });

  async function save(threadId: string, id: string, target: "voice" | "claude" | "brain", ruleOverride?: string): Promise<SaveResult> {
    const candidate = await getPending(threadId);
    if (!candidate || candidate.id !== id) throw new Error("That rule card has already been answered.");
    const rule = ruleOverride?.trim() || candidate.rule;
    const s = await settings.get();
    let result: SaveResult;
    if (target === "voice") {
      if (!s.voiceProfilePath.trim()) throw new Error("No voice profile is set. Add one in the Reflect settings.");
      result = await writers.saveVoice(expandHome(s.voiceProfilePath.trim()), s.voiceSection, rule, s.commitVoice, s.pushVoice);
    } else if (target === "claude") {
      if (!s.claudeMdPath.trim()) throw new Error("No CLAUDE.md path is set. Add one in the Reflect settings.");
      result = await writers.saveClaude(expandHome(s.claudeMdPath.trim()), rule);
    } else {
      const saved = (await bb.storage.kv.get<string[]>(BRAIN_SAVED_KEY)) ?? [];
      const key = normaliseRule(rule);
      result = await writers.saveBrain(s.brainCommand, rule, threadId, saved.includes(key));
      if (result.status === "saved") await bb.storage.kv.set(BRAIN_SAVED_KEY, [...saved, key].slice(-500));
    }
    await setPending(threadId, null);
    const log = readLog(await bb.storage.kv.get<unknown>(SAVED_LOG_KEY));
    await bb.storage.kv.set(
      SAVED_LOG_KEY,
      appendLog(log, { rule, target: result.target, status: result.status, where: result.where, threadId, at: Date.now() }),
    );
    bb.realtime.publish(CHANGED, { threadId, saved: true });
    bb.log.info(`rule ${result.status} to ${result.target}: ${rule}`);
    return result;
  }

  bb.rpc.register(rpcContract, {
    open_panel: async ({ threadId, windowId }) => {
      bb.realtime.publish("open-panel", { threadId, windowId });
      return { ok: true };
    },
    pending: async ({ threadId }) => {
      const s = await settings.get();
      return {
        candidate: await getPending(threadId),
        targets: { voice: !!s.voiceProfilePath.trim(), claude: !!s.claudeMdPath.trim(), brain: !!s.brainCommand.trim() },
      };
    },
    save: ({ threadId, id, target, rule }) => save(threadId, id, target, rule),
    dismiss: async ({ threadId, id }) => {
      const candidate = await getPending(threadId);
      if (!candidate || candidate.id !== id) return { dismissed: false };
      await setPending(threadId, null);
      return { dismissed: true };
    },
    saved: async ({ limit }) => {
      const log = readLog(await bb.storage.kv.get<unknown>(SAVED_LOG_KEY));
      return { entries: newestFirst(log, limit ?? 50), today: countToday(log, Date.now()), total: log.length };
    },
    test: async ({ text }) => {
      const hit = detectRule(text);
      return { rule: hit?.rule ?? null, topic: hit?.topic ?? null };
    },
    paths: async () => {
      const s = await settings.get();
      return {
        enabled: s.enabled,
        voice: s.voiceProfilePath,
        voiceSection: s.voiceSection,
        commitVoice: s.commitVoice,
        pushVoice: s.pushVoice,
        claude: s.claudeMdPath,
        brain: s.brainCommand,
      };
    },
  });

  const usage = [
    "Usage:",
    "  bb reflect test <text>         Show what Reflect would detect in a message",
    "  bb reflect pending <thread-id> Show the unanswered rule card for a thread",
    "  bb reflect paths               Show where each save button writes",
  ].join("\n");

  bb.cli.register({
    name: "reflect",
    summary: "Inspect Reflect, the lasting-rule catcher",
    commands: [
      { name: "test", summary: "Run the rule detector on some text", usage: "bb reflect test <text>" },
      { name: "pending", summary: "Show a thread's unanswered rule card", usage: "bb reflect pending <thread-id>" },
      { name: "paths", summary: "Show the save destinations", usage: "bb reflect paths" },
    ],
    async run(argv) {
      const [command, ...rest] = argv;
      if (command === "test") {
        const text = rest.join(" ").trim();
        if (!text) return { exitCode: 1, stderr: usage };
        return { exitCode: 0, stdout: JSON.stringify(detectRule(text), null, 2) };
      }
      if (command === "pending") {
        const parsed = threadIdSchema.safeParse(rest[0]);
        if (!parsed.success) return { exitCode: 1, stderr: usage };
        return { exitCode: 0, stdout: JSON.stringify(await getPending(parsed.data), null, 2) };
      }
      if (command === "paths") {
        const s = await settings.get();
        return {
          exitCode: 0,
          stdout: [
            `enabled:      ${s.enabled}`,
            `voice:        ${s.voiceProfilePath || "(off)"}, section "${s.voiceSection}" (commit: ${s.commitVoice}, push: ${s.pushVoice})`,
            `claude:       ${s.claudeMdPath || "(off)"}`,
            `brain:        ${s.brainCommand || "(off)"}`,
            `backups:      /tmp/reflect/backups`,
          ].join("\n"),
        };
      }
      return { exitCode: command ? 1 : 0, stdout: command ? undefined : usage, stderr: command ? usage : undefined };
    },
  });
}
