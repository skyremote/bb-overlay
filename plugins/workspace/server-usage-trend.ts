// Usage trend for the hover card under the chat box: a background sampler that
// records every account's plan windows over time, a ledger of which chats used
// the tokens, and the card payload (series, forecasts, burn rate, busiest chats).
//
// Reads are cached only: the Account Pooler with refresh:false (it refreshes on
// its own schedule; we record its observedAt, so a stale reading is never
// counted twice), Cursor through Home's cached usage call at most every 15 min.
//
// Storage: one kv row per account, "usage-trend:v1:<id>", holding for each
// window a fine ring (3-min points, last 48 h) and a coarse ring (15-min
// buckets, up to 14 days). Points are [minute since epoch, per-mille used].
// The turns ledger "usage-turns:v1" keeps 26 h of per-turn token use per chat.
import { z } from "zod";
import type { BbPluginApi } from "@get-bb/plugin-sdk";

type Harness = "claude" | "codex" | "cursor";
type CursorReading = { email: string | null; plan: string | null; week: number | null; weekResetsAt: string | null; status: "ok" | "error" } | null;

export type TrendDeps = {
  cursorUsage(): Promise<CursorReading>;
  planLabel(harness: "claude" | "codex", raw: string | null, email: string | null): Promise<string | null>;
  /** Pool account a provider session runs on, or the provider's current account. */
  accountFor(provider: "claude" | "codex", sessionId: string | null): string | null;
};

const MIN = 60_000;
const HOUR = 60 * MIN;
const FINE_KEEP = 48 * HOUR;
const COARSE_KEEP = 14 * 24 * HOUR;
const COARSE_STEP = 15 * MIN;
const CURSOR_EVERY = 15 * MIN;
const TURNS_KEEP = 26 * HOUR;

const usageSchema = z
  .object({
    observedAt: z.number().nullable().optional(),
    usage: z
      .object({
        status: z.string(),
        accountEmail: z.string().nullable().optional(),
        planLabel: z.string().nullable().optional(),
        windows: z
          .array(z.object({ id: z.string().optional(), label: z.string(), usedPercent: z.number(), resetsAt: z.string().nullable(), kind: z.string().optional(), model: z.string().nullable().optional() }).passthrough())
          .optional(),
      })
      .passthrough(),
  })
  .passthrough();
const listSchema = z.object({ resources: z.array(z.object({ id: z.string(), providerId: z.string(), label: z.string() }).passthrough()) }).passthrough();

// ---------- Card payload ----------
const point = z.tuple([z.number(), z.number()]); // [epoch ms, percent]
export const trendWindowSchema = z.object({
  id: z.string(),
  label: z.string(),
  /** session = the five-hour window; long = weekly or monthly. */
  span: z.enum(["session", "long"]),
  model: z.string().nullable(),
  pct: z.number(),
  startsAt: z.number().nullable(),
  resetsAt: z.number().nullable(),
  /** True when a five-hour window has lapsed and no session is running. */
  idle: z.boolean(),
  series: z.array(point),
  /** Percent per hour used for the forecast, and how it was measured. */
  rate: z.number().nullable(),
  rateBasis: z.enum(["recent", "pace", "none"]),
  samples: z.number(),
  forecastAtReset: z.number().nullable(),
  hits90At: z.number().nullable(),
  hits100At: z.number().nullable(),
  /** Percent per hour over the last 30 minutes of readings. */
  burn: z.number().nullable(),
});
export const trendAccountSchema = z.object({
  id: z.string(),
  harness: z.enum(["claude", "codex", "cursor"]),
  email: z.string().nullable(),
  plan: z.string().nullable(),
  status: z.enum(["ok", "error"]),
  observedAt: z.number().nullable(),
  windows: z.array(trendWindowSchema),
  /** Burn rate of the shortest window over the last 30 minutes, percent per hour. */
  burn: z.number().nullable(),
  busiest: z.object({
    mode: z.enum(["tokens", "activity", "none"]),
    since: z.number(),
    sinceLabel: z.string(),
    rows: z.array(z.object({ threadId: z.string(), title: z.string(), share: z.number(), tokens: z.number(), turns: z.number() })),
  }),
});
export const trendSchema = z.object({ now: z.number(), sampledFrom: z.number().nullable(), accounts: z.array(trendAccountSchema) });
export type TrendAccount = z.infer<typeof trendAccountSchema>;
export type TrendWindow = z.infer<typeof trendWindowSchema>;
export type Trend = z.infer<typeof trendSchema>;

// ---------- Storage shapes ----------
type Ring = { fine: number[]; coarse: number[] }; // flat [minute, permille, minute, permille, ...]
type WinMeta = { label: string; kind: string; model: string | null; resetsAt: number | null; pct: number };
type Stored = { v: 1; first: number; lastObservedAt: number; harness: Harness; email: string | null; plan: string | null; status: "ok" | "error"; meta: Record<string, WinMeta>; rings: Record<string, Ring> };
type Turns = { v: 1; seen: Record<string, [number, number]>; scannedAt: number; turns: Array<[number, string, string, number]> }; // seen: threadId -> [lastSeq, at]; turn: [at, threadId, accountId, weighted tokens]

const key = (id: string) => `usage-trend:v1:${id}`;

function pairs(flat: number[]): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (let i = 0; i + 1 < flat.length; i += 2) out.push([flat[i] * MIN, flat[i + 1] / 10]);
  return out;
}

/** Append one reading; fold fine points older than 48 h into 15-min buckets (last value wins) and trim at 14 days. */
function push(ring: Ring, at: number, pct: number) {
  const m = Math.round(at / MIN);
  const v = Math.round(pct * 10);
  const n = ring.fine.length;
  if (n >= 2 && ring.fine[n - 2] >= m) return;
  ring.fine.push(m, v);
  const cutoff = (at - FINE_KEEP) / MIN;
  let i = 0;
  while (i < ring.fine.length && ring.fine[i] < cutoff) {
    const bucket = Math.floor((ring.fine[i] * MIN) / COARSE_STEP) * (COARSE_STEP / MIN);
    const cn = ring.coarse.length;
    if (cn >= 2 && ring.coarse[cn - 2] === bucket) ring.coarse[cn - 1] = ring.fine[i + 1];
    else ring.coarse.push(bucket, ring.fine[i + 1]);
    i += 2;
  }
  if (i > 0) ring.fine.splice(0, i);
  const oldest = (at - COARSE_KEEP) / MIN;
  let j = 0;
  while (j < ring.coarse.length && ring.coarse[j] < oldest) j += 2;
  if (j > 0) ring.coarse.splice(0, j);
}

/** Least-squares slope in percent per hour, or null with fewer than three points or no time spread. */
function slope(pts: Array<[number, number]>): number | null {
  if (pts.length < 3) return null;
  const t0 = pts[0][0];
  const xs = pts.map(([t]) => (t - t0) / HOUR);
  const ys = pts.map(([, p]) => p);
  const mx = xs.reduce((a, b) => a + b, 0) / xs.length;
  const my = ys.reduce((a, b) => a + b, 0) / ys.length;
  let num = 0;
  let den = 0;
  for (let i = 0; i < xs.length; i++) {
    num += (xs[i] - mx) * (ys[i] - my);
    den += (xs[i] - mx) ** 2;
  }
  if (den <= 0 || xs[xs.length - 1] < 10 / 60) return null;
  return Math.max(0, num / den);
}

function spanOf(kind: string, label: string): { span: "session" | "long"; ms: number } {
  if (kind === "five-hour" || /five|5h|session/i.test(label)) return { span: "session", ms: 5 * HOUR };
  if (kind === "daily") return { span: "long", ms: 24 * HOUR };
  if (kind === "monthly") return { span: "long", ms: 30 * 24 * HOUR };
  return { span: "long", ms: 7 * 24 * HOUR };
}

function prettyLabel(kind: string, label: string, model: string | null): string {
  const m = model ? `${model.charAt(0).toUpperCase()}${model.slice(1)}` : null;
  if (kind === "five-hour" || /five|5h|session/i.test(label)) return "Session";
  if (kind === "monthly") return m ? `Month · ${m}` : "Month";
  if (kind === "daily") return m ? `Day · ${m}` : "Day";
  return m ? `Week · ${m}` : "Week";
}

/** Claude limits weigh tokens roughly like API prices: cache reads cheap, output dear. */
function weigh(provider: string, u: Record<string, number | undefined>): number {
  const input = u.inputTokens ?? 0;
  const out = u.outputTokens ?? 0;
  if (provider.includes("claude")) return input + 1.25 * (u.cacheWriteInputTokens ?? 0) + 0.1 * (u.cacheReadInputTokens ?? u.cachedInputTokens ?? 0) + 5 * out;
  const cached = u.cachedInputTokens ?? 0;
  return Math.max(0, input - cached) + 0.1 * cached + 4 * out;
}

const fmtSince = (start: number) => new Date(start).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });

export function createUsageTrend(bb: BbPluginApi, deps: TrendDeps) {
  let cursorAt = 0;
  let chain: Promise<unknown> = Promise.resolve();
  const serial = <T>(fn: () => Promise<T>): Promise<T> => {
    const next = chain.then(fn);
    chain = next.catch(() => undefined);
    return next;
  };

  async function load(id: string): Promise<Stored | null> {
    return ((await bb.storage.kv.get<Stored>(key(id))) ?? null) as Stored | null;
  }

  async function record(id: string, harness: Harness, email: string | null, plan: string | null, status: "ok" | "error", observedAt: number, wins: Array<{ id: string; label: string; kind: string; model: string | null; pct: number; resetsAt: number | null }>) {
    const s: Stored = (await load(id)) ?? { v: 1, first: observedAt, lastObservedAt: 0, harness, email, plan, status, meta: {}, rings: {} };
    s.harness = harness;
    s.email = email;
    s.plan = plan;
    s.status = status;
    if (observedAt > s.lastObservedAt) {
      for (const w of wins) {
        // A lapsed five-hour window reads as its last value until the next message; it is really 0.
        const lapsed = w.resetsAt !== null && w.resetsAt < observedAt;
        push((s.rings[w.id] ??= { fine: [], coarse: [] }), observedAt, lapsed ? 0 : w.pct);
      }
      s.lastObservedAt = observedAt;
    }
    for (const w of wins) s.meta[w.id] = { label: w.label, kind: w.kind, model: w.model, resetsAt: w.resetsAt, pct: w.pct };
    await bb.storage.kv.set(key(id), s);
  }

  // ---------- One sampling pass ----------
  async function samplePlans() {
    let list: z.infer<typeof listSchema> | null = null;
    try {
      list = await bb.sdk.plugins.callRpc({ pluginId: "account-pool", method: "provider-usage.v1.listResources", input: {} as never, outputSchema: listSchema });
    } catch {
      list = null;
    }
    const ids: string[] = [];
    for (const res of list?.resources ?? []) {
      const harness = res.providerId.includes("codex") ? "codex" : res.providerId.includes("claude") ? "claude" : null;
      if (!harness) continue;
      ids.push(res.id);
      try {
        const r = await bb.sdk.plugins.callRpc({ pluginId: "account-pool", method: "provider-usage.v1.getResource", input: { resourceId: res.id, refresh: false } as never, outputSchema: usageSchema });
        const email = r.usage.accountEmail ?? res.label;
        const plan = await deps.planLabel(harness, r.usage.planLabel ?? null, email);
        const observedAt = r.observedAt ?? 0;
        const wins = (r.usage.windows ?? []).map((w) => ({
          id: w.id ?? `${w.kind ?? "w"}:${w.model ?? ""}:${w.label}`,
          label: w.label,
          kind: w.kind ?? "",
          model: w.model ?? null,
          pct: w.usedPercent,
          resetsAt: w.resetsAt ? Date.parse(w.resetsAt) || null : null,
        }));
        await record(res.id, harness, email, plan, r.usage.status === "ok" ? "ok" : "error", r.usage.status === "ok" ? observedAt : 0, wins);
      } catch (e) {
        bb.log.warn(`usage trend ${res.id}: ${String(e)}`);
      }
    }
    if (Date.now() - cursorAt >= CURSOR_EVERY) {
      cursorAt = Date.now();
      const c = await deps.cursorUsage().catch(() => null);
      if (c) {
        ids.push("cursor");
        const resetsAt = c.weekResetsAt ? Date.parse(c.weekResetsAt) || null : null;
        await record("cursor", "cursor", c.email, c.plan, c.status, c.status === "ok" ? Date.now() : 0, c.week === null ? [] : [{ id: "month", label: "This month", kind: "monthly", model: null, pct: c.week, resetsAt }]);
      }
    }
    // Remember which accounts exist so the card can list them without touching providers.
    const known = new Set(((await bb.storage.kv.get<string[]>("usage-trend:v1:accounts")) ?? []) as string[]);
    if (list) for (const k of [...known]) if (k !== "cursor" && !ids.includes(k)) known.delete(k);
    for (const id of ids) known.add(id);
    await bb.storage.kv.set("usage-trend:v1:accounts", [...known]);
  }

  async function sampleTurns() {
    const now = Date.now();
    const t = ((await bb.storage.kv.get<Turns>("usage-turns:v1")) ?? { v: 1, seen: {}, scannedAt: 0, turns: [] }) as Turns;
    const since = Math.max(t.scannedAt - 5 * MIN, now - 6 * HOUR);
    const threads = (await bb.sdk.threads.list({ includeHidden: true })) as unknown as Array<{ id: string; providerId: string; updatedAt: number }>;
    for (const th of threads) {
      if (!th.updatedAt || th.updatedAt < since) continue;
      const provider = th.providerId.includes("codex") ? "codex" : th.providerId.includes("claude") ? "claude" : th.providerId.includes("cursor") ? "cursor" : null;
      if (!provider) continue;
      const after = t.seen[th.id]?.[0];
      // The events API returns at most 100 rows: a chat seen for the first time
      // reads its newest 100 reports; after that, every report since the last one.
      type Row = { seq: number; createdAt: number; type: string; data: unknown };
      let rows: Row[] = [];
      try {
        const types = ["thread/tokenUsage/updated", "turn/completed"] as const;
        if (after === undefined) {
          rows = ((await bb.sdk.threads.events.list({ threadId: th.id, types: [...types], order: "desc", limit: "100" })) as unknown as Row[]).reverse();
        } else {
          let cursor = after;
          for (let page = 0; page < 20; page++) {
            const got = (await bb.sdk.threads.events.list({ threadId: th.id, types: [...types], order: "asc", limit: "100", afterSeq: String(cursor) })) as unknown as Row[];
            rows.push(...got);
            if (got.length < 100) break;
            cursor = got[got.length - 1].seq;
          }
        }
      } catch (e) {
        bb.log.warn(`usage turns ${th.id}: ${String(e)}`);
        continue;
      }
      let last = after ?? 0;
      for (const r of rows) {
        last = Math.max(last, r.seq);
        if (r.createdAt < now - TURNS_KEEP) continue;
        if (r.type === "thread/tokenUsage/updated") {
          const d = r.data as { providerThreadId?: string; tokenUsage?: { last?: Record<string, number> } };
          const acct = provider === "cursor" ? "cursor" : deps.accountFor(provider, d.providerThreadId ?? null);
          if (acct && d.tokenUsage?.last) t.turns.push([r.createdAt, th.id, acct, Math.round(weigh(th.providerId, d.tokenUsage.last))]);
        } else if (provider === "cursor" || !rows.some((x) => x.type === "thread/tokenUsage/updated")) {
          // Turns with no token report still count as activity.
          const acct = provider === "cursor" ? "cursor" : deps.accountFor(provider, null);
          if (acct) t.turns.push([r.createdAt, th.id, acct, 0]);
        }
      }
      t.seen[th.id] = [last, now];
    }
    t.turns = t.turns.filter((x) => x[0] >= now - TURNS_KEEP).sort((a, b) => a[0] - b[0]);
    for (const [id, [, at]] of Object.entries(t.seen)) if (at < now - 3 * 24 * HOUR) delete t.seen[id];
    t.scannedAt = now;
    await bb.storage.kv.set("usage-turns:v1", t);
  }

  function sample(): Promise<void> {
    return serial(async () => {
      await samplePlans().catch((e) => bb.log.warn(`usage trend: ${String(e)}`));
      await sampleTurns().catch((e) => bb.log.warn(`usage turns: ${String(e)}`));
    });
  }

  // ---------- Card payload ----------
  function windowOf(id: string, meta: WinMeta, ring: Ring | undefined, now: number, daily: Record<string, number>): TrendWindow {
    const { span, ms } = spanOf(meta.kind, meta.label);
    const idle = span === "session" && (meta.resetsAt === null || meta.resetsAt <= now);
    const startsAt = meta.resetsAt !== null && !idle ? meta.resetsAt - ms : null;
    const all = ring ? [...pairs(ring.coarse), ...pairs(ring.fine)] : [];
    const series = startsAt !== null ? all.filter(([t]) => t >= startsAt && t <= now) : [];
    const pct = idle ? 0 : meta.pct;
    // Forecast: the session from a linear fit on the last 30 to 60 minutes of
    // readings. A week or month from its average pace since it began, once a
    // day of it is behind us (one busy morning would read as a runaway week).
    const recent = series.filter(([t]) => t >= now - 60 * MIN);
    let rate: number | null = null;
    let basis: "recent" | "pace" | "none" = "none";
    if (span === "session") {
      rate = slope(recent);
      if (rate !== null) basis = "recent";
    } else if (startsAt !== null && now - startsAt >= 24 * HOUR) {
      rate = pct / ((now - startsAt) / HOUR);
      basis = "pace";
    }
    let forecastAtReset: number | null = null;
    let hits90At: number | null = null;
    let hits100At: number | null = null;
    if (rate !== null && meta.resetsAt !== null && !idle) {
      forecastAtReset = Math.min(100, Math.max(pct, pct + (rate * (meta.resetsAt - now)) / HOUR));
      if (rate > 0) {
        if (pct < 90) hits90At = now + ((90 - pct) / rate) * HOUR;
        if (pct < 100) hits100At = now + ((100 - pct) / rate) * HOUR;
      }
    }
    // Long windows ship at 30-minute resolution; the chart cannot show more.
    let shipped = series;
    if (span === "long") {
      const byBucket = new Map<number, [number, number]>();
      for (const p of series) byBucket.set(Math.floor(p[0] / (30 * MIN)), p);
      shipped = [...byBucket.values()];
      // Before the sampler's first reading, the daily peaks Home already keeps
      // (main weekly or monthly window only), each placed at the end of its day.
      if (!meta.model && startsAt !== null) {
        const first = shipped[0]?.[0] ?? now;
        const firstValue = shipped[0]?.[1] ?? pct;
        const early: Array<[number, number]> = [];
        for (const [day, peak] of Object.entries(daily)) {
          const end = Date.parse(`${day}T23:59:00Z`); // Home keys days in UTC
          // A day that began before the window opened also holds the last window's peak.
          if (Date.parse(`${day}T00:00:00Z`) >= startsAt && end < first && end < now) early.push([end, Math.min(peak, firstValue)]);
        }
        shipped = [...early.sort((a, b) => a[0] - b[0]), ...shipped];
      }
    }
    // Every window starts at 0% when it opens.
    if (startsAt !== null && (shipped[0]?.[0] ?? Infinity) > startsAt) shipped = [[startsAt, 0], ...shipped];
    return {
      id,
      label: prettyLabel(meta.kind, meta.label, meta.model),
      span,
      model: meta.model,
      pct,
      startsAt,
      resetsAt: meta.resetsAt,
      idle,
      series: shipped,
      rate,
      rateBasis: basis,
      samples: recent.length,
      forecastAtReset,
      hits90At,
      hits100At,
      burn: slope(series.filter(([t]) => t >= now - 30 * MIN)),
    };
  }

  async function card(): Promise<Trend> {
    const now = Date.now();
    const ids = ((await bb.storage.kv.get<string[]>("usage-trend:v1:accounts")) ?? []) as string[];
    const turns = ((await bb.storage.kv.get<Turns>("usage-turns:v1")) ?? { turns: [] }) as Turns;
    const history = ((await bb.storage.kv.get<Record<string, Record<string, number>>>("usage-history")) ?? {}) as Record<string, Record<string, number>>;
    let titles: Map<string, string> | null = null;
    const titleOf = async (id: string) => {
      if (!titles) {
        const list = (await bb.sdk.threads.list({ includeHidden: true }).catch(() => [])) as unknown as Array<{ id: string; title: string | null; titleFallback?: string | null }>;
        titles = new Map(list.map((x) => [x.id, x.title || x.titleFallback || "Untitled chat"]));
      }
      return titles.get(id) ?? "Untitled chat";
    };
    const accounts: TrendAccount[] = [];
    let sampledFrom: number | null = null;
    for (const id of ids) {
      const s = await load(id);
      if (!s) continue;
      sampledFrom = sampledFrom === null ? s.first : Math.min(sampledFrom, s.first);
      const windows = Object.entries(s.meta)
        .map(([wid, m]) => windowOf(wid, m, s.rings[wid], now, history[id] ?? {}))
        .sort((a, b) => (a.span === b.span ? (a.model ? 1 : 0) - (b.model ? 1 : 0) : a.span === "session" ? -1 : 1));
      const shortest = windows.find((w) => w.span === "session" && !w.idle) ?? windows.find((w) => !w.model) ?? null;
      const burn = shortest?.burn ?? null;
      // Busiest chats over this session's window, or the last five hours (a day for Cursor).
      const session = windows.find((w) => w.span === "session" && !w.idle);
      const since = session?.startsAt ?? now - (s.harness === "cursor" ? 24 : 5) * HOUR;
      const sinceLabel = session ? `since ${fmtSince(since)}` : s.harness === "cursor" ? "in the last 24 hours" : "in the last 5 hours";
      const mine = turns.turns.filter((x) => x[2] === id && x[0] >= since);
      const per = new Map<string, { tokens: number; turns: number }>();
      for (const [, th, , w] of mine) {
        const e = per.get(th) ?? { tokens: 0, turns: 0 };
        e.tokens += w;
        e.turns += 1;
        per.set(th, e);
      }
      const totalTokens = [...per.values()].reduce((a, b) => a + b.tokens, 0);
      const mode = per.size === 0 ? "none" : totalTokens > 0 ? "tokens" : "activity";
      const totalTurns = [...per.values()].reduce((a, b) => a + b.turns, 0);
      const ranked = [...per.entries()].sort((a, b) => (mode === "tokens" ? b[1].tokens - a[1].tokens : b[1].turns - a[1].turns)).slice(0, 3);
      const rows = [];
      for (const [threadId, e] of ranked)
        rows.push({ threadId, title: await titleOf(threadId), share: mode === "tokens" ? e.tokens / totalTokens : e.turns / Math.max(1, totalTurns), tokens: e.tokens, turns: e.turns });
      accounts.push({ id, harness: s.harness, email: s.email, plan: s.plan, status: s.status, observedAt: s.lastObservedAt || null, windows, burn, busiest: { mode, since, sinceLabel, rows } });
    }
    const order: Record<Harness, number> = { claude: 0, codex: 1, cursor: 2 };
    accounts.sort((a, b) => order[a.harness] - order[b.harness]);
    return { now, sampledFrom, accounts };
  }

  return { sample, card };
}
