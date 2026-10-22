// Pure logic for the cache clock: countdown maths, keep-warm decisions and
// handoff brief extraction. No bb imports, so it is unit-tested directly.
import { z } from "zod";

export const PING_TEXT =
  "Keep-warm ping from the Cache Clock mod. Reply with just: ok";
export const PING_LEAD_MS = 2 * 60 * 1000;
export const TICK_MS = 15 * 1000;

export const HANDOFF_REQUEST = [
  "Write a handoff brief so a fresh thread can carry on this work with no loss of context.",
  "Wrap the whole brief in <handoff> and </handoff> tags, and write nothing outside the tags.",
  "Use British English and these headings, in this order:",
  "1. Goal: what we are trying to achieve and why.",
  "2. Decisions made: each decision and the reason for it.",
  "3. Files: every file created or edited, with its full path and one line on its state.",
  "4. Skills, tools and links used: names, commands, URLs, thread references.",
  "5. Current state: what works, what is verified, what is not.",
  "6. Open questions: anything still waiting on the user or someone else.",
  "7. Next steps: the exact next actions, in order, specific enough to start on immediately.",
  "Be complete and concrete. Do not do any other work in this turn.",
].join("\n");

export const keepWarmSchema = z.object({
  enabled: z.boolean(),
  startedAt: z.number(),
  pings: z.number().int().nonnegative(),
  lastPingAt: z.number().nullable(),
  lastPingForReplyAt: z.number().nullable(),
  lastPingCachedTokens: z.number().nullable(),
  stoppedReason: z.enum(["user-message", "time-limit", "manual", "thread-gone"]).nullable(),
  /** Newest last; capped so the stored row stays small. */
  log: z.array(z.object({ at: z.number(), cachedTokens: z.number().nullable() })).max(50).optional(),
});
export type KeepWarm = z.infer<typeof keepWarmSchema>;

export const handoffSchema = z.object({
  status: z.enum(["requested", "ready", "failed"]),
  requestedAt: z.number(),
  brief: z.string().nullable(),
  error: z.string().nullable(),
});
export type Handoff = z.infer<typeof handoffSchema>;

export const statusSchema = z.object({
  threadId: z.string(),
  supported: z.boolean(),
  providerId: z.string(),
  running: z.boolean(),
  lastReplyAt: z.number().nullable(),
  ttlMinutes: z.number(),
  expiresAt: z.number().nullable(),
  usedTokens: z.number().nullable(),
  keepWarm: keepWarmSchema.nullable(),
  keepWarmMaxHours: z.number(),
  handoff: handoffSchema.nullable(),
  now: z.number(),
});
export type ClockStatus = z.infer<typeof statusSchema>;

/** Only Claude Code threads use Anthropic prompt caching in the way this mod models. */
export function isSupportedProvider(providerId: string): boolean {
  return providerId === "claude-code" || providerId.startsWith("claude");
}

export function expiresAt(lastReplyAt: number | null, ttlMinutes: number): number | null {
  if (lastReplyAt === null) return null;
  return lastReplyAt + ttlMinutes * 60 * 1000;
}

/** Remaining milliseconds, never negative. */
export function remainingMs(expiry: number | null, now: number): number {
  if (expiry === null) return 0;
  return Math.max(0, expiry - now);
}

/** mm:ss under an hour, h:mm:ss above. */
export function formatCountdown(ms: number): string {
  const total = Math.ceil(Math.max(0, ms) / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

/** Fraction of the cache life left, 0..1, for the draining bar. */
export function fractionLeft(expiry: number | null, ttlMinutes: number, now: number): number {
  if (expiry === null || ttlMinutes <= 0) return 0;
  return Math.min(1, remainingMs(expiry, now) / (ttlMinutes * 60 * 1000));
}

export function formatTokens(tokens: number | null): string {
  if (tokens === null || !Number.isFinite(tokens)) return "the";
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
  if (tokens >= 1000) return `${Math.round(tokens / 1000)}k`;
  return String(Math.round(tokens));
}

export function ttlLabel(ttlMinutes: number): string {
  if (ttlMinutes === 60) return "1 hour";
  if (ttlMinutes % 60 === 0) return `${ttlMinutes / 60} hour`;
  return `${ttlMinutes} minute`;
}

export type KeepWarmDecision =
  | { action: "wait" }
  | { action: "ping" }
  | { action: "stop"; reason: "time-limit" };

/**
 * Decide what the keep-warm loop does for one thread on one tick.
 * One ping per reply: once we have pinged for a given lastReplyAt we wait for
 * the ping's own reply to move lastReplyAt forward.
 */
export function decideKeepWarm(input: {
  keepWarm: KeepWarm;
  lastReplyAt: number | null;
  ttlMinutes: number;
  maxHours: number;
  running: boolean;
  now: number;
}): KeepWarmDecision {
  const { keepWarm, lastReplyAt, ttlMinutes, maxHours, running, now } = input;
  if (!keepWarm.enabled) return { action: "wait" };
  if (now - keepWarm.startedAt >= maxHours * 60 * 60 * 1000) return { action: "stop", reason: "time-limit" };
  if (running || lastReplyAt === null) return { action: "wait" };
  if (keepWarm.lastPingForReplyAt === lastReplyAt) return { action: "wait" };
  // A ping sent less than a minute ago whose reply has not landed yet.
  if (keepWarm.lastPingAt !== null && now - keepWarm.lastPingAt < 60 * 1000) return { action: "wait" };
  const expiry = expiresAt(lastReplyAt, ttlMinutes)!;
  const lead = Math.min(PING_LEAD_MS, (ttlMinutes * 60 * 1000) / 3);
  return now >= expiry - lead ? { action: "ping" } : { action: "wait" };
}

/** When the next ping is due, for the "next in" label. */
export function nextPingAt(lastReplyAt: number | null, ttlMinutes: number): number | null {
  const expiry = expiresAt(lastReplyAt, ttlMinutes);
  if (expiry === null) return null;
  return expiry - Math.min(PING_LEAD_MS, (ttlMinutes * 60 * 1000) / 3);
}

/** Pull the last <handoff>…</handoff> block out of an assistant reply. */
export function extractHandoff(text: string | null): string | null {
  if (!text) return null;
  const matches = [...text.matchAll(/<handoff>([\s\S]*?)<\/handoff>/gi)];
  const last = matches.at(-1);
  if (!last) return null;
  const brief = last[1]!.trim();
  return brief.length > 0 ? brief : null;
}

export function handoffPrompt(threadId: string, brief: string): string {
  return `Continue from @thread:${threadId}\n\n${brief}`;
}

export function isPingText(text: string): boolean {
  return text.trim() === PING_TEXT || text.includes(PING_TEXT);
}

export function isHandoffRequestText(text: string): boolean {
  return text.includes("<handoff> and </handoff>");
}

/** Append one ping to the keep-warm log, keeping the newest 50. */
export function appendPingLog(log: KeepWarm["log"], at: number, cachedTokens: number | null): NonNullable<KeepWarm["log"]> {
  return [...(log ?? []), { at, cachedTokens }].slice(-50);
}

/** Rail page: threads worth a cache clock — Claude threads touched recently, newest first, bounded. */
export function pickRecentClaudeThreads<T extends { id: string; providerId: string; updatedAt: number; archivedAt?: number | null }>(
  threads: readonly T[],
  now: number,
  windowMs: number,
  max: number,
): T[] {
  return threads
    .filter((t) => isSupportedProvider(t.providerId) && !t.archivedAt && now - t.updatedAt <= windowMs)
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, max);
}

/** Rail page order: running turns first, then warm caches soonest to go cold, then cold ones (most recent first). */
export function sortOverview(rows: readonly ClockStatus[], now: number): ClockStatus[] {
  const rank = (s: ClockStatus) => (s.running ? 0 : remainingMs(s.expiresAt, now) > 0 ? 1 : 2);
  return [...rows].sort((a, b) => {
    const ra = rank(a), rb = rank(b);
    if (ra !== rb) return ra - rb;
    if (ra === 1) return (a.expiresAt ?? 0) - (b.expiresAt ?? 0);
    return (b.lastReplyAt ?? 0) - (a.lastReplyAt ?? 0);
  });
}
