// Home page data for NavAIgate Workspace: every subscription's usage (Claude
// and Codex through the Account Pooler, Cursor through its own usage API),
// a daily history for plan advice, the agenda, and the daily brief.
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import Database from "better-sqlite3";
import { z } from "zod";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { readKey } from "./server-profile";

type Settings = { get(): Promise<Record<string, unknown>> };

export const homeAccountSchema = z.object({
  id: z.string(),
  harness: z.enum(["claude", "codex", "cursor"]),
  label: z.string(),
  email: z.string().nullable(),
  plan: z.string().nullable(),
  session: z.number().nullable(),
  sessionResetsAt: z.string().nullable(),
  week: z.number().nullable(),
  weekResetsAt: z.string().nullable(),
  cycleLabel: z.string(),
  history: z.array(z.object({ day: z.string(), peak: z.number() })),
  advice: z.string().nullable(),
  status: z.enum(["ok", "error"]),
});
export type HomeAccount = z.infer<typeof homeAccountSchema>;

export const agendaSchema = z.object({
  configured: z.boolean(),
  error: z.string().nullable(),
  reconnect: z.array(z.string()),
  events: z.array(z.object({ title: z.string(), start: z.string(), end: z.string().nullable(), allDay: z.boolean(), account: z.string(), location: z.string().nullable(), link: z.string().nullable() })),
});

const usageSchema = z
  .object({
    usage: z
      .object({
        status: z.string(),
        accountEmail: z.string().nullable().optional(),
        planLabel: z.string().nullable().optional(),
        windows: z.array(z.object({ label: z.string(), usedPercent: z.number(), resetsAt: z.string().nullable(), kind: z.string().optional(), model: z.string().nullable().optional() }).passthrough()).optional(),
      })
      .passthrough(),
  })
  .passthrough();
const listSchema = z.object({ resources: z.array(z.object({ id: z.string(), providerId: z.string(), label: z.string() }).passthrough()) }).passthrough();

// Published monthly prices (USD) used only to word plan advice.
const PRICES: Record<string, number> = { "Max 20x": 200, "Max 5x": 100, Pro: 20, "Cursor Ultra": 200, "Cursor Pro+": 60, "Cursor Pro": 20 };

const today = () => new Date().toISOString().slice(0, 10);

export const BRIEF_DIR = path.join(os.homedir(), "Documents", "Daily_Brief");

export function createHome(bb: BbPluginApi, settings: Settings) {
  async function tiers(): Promise<Map<string, string>> {
    const s = await settings.get();
    const m = new Map<string, string>();
    for (const line of String(s.planTiers ?? "").split(/\n|;/)) {
      const [who, plan] = line.split("|").map((x) => x.trim());
      if (who && plan) m.set(who.toLowerCase(), plan);
    }
    return m;
  }

  /** "Max 20x", "ChatGPT Pro"…, unless the planTiers setting corrects it. */
  function planOf(t: Map<string, string>, harness: "claude" | "codex", raw: string | null, email: string | null): string | null {
    // A correction only applies to the matching harness: Claude plans to Claude, ChatGPT plans to Codex.
    const o = t.get(String(email).toLowerCase());
    const override = o && (harness === "codex" ? /chatgpt/i.test(o) : !/chatgpt/i.test(o)) ? o : undefined;
    return (
      override ??
      (harness === "claude" ? (raw && /20x/i.test(raw) ? "Max 20x" : raw && /5x/i.test(raw) ? "Max 5x" : raw ? `Claude ${raw}` : null) : raw ? `ChatGPT ${raw}` : null)
    );
  }
  const planLabel = async (harness: "claude" | "codex", raw: string | null, email: string | null) => planOf(await tiers(), harness, raw, email);

  // ---------- Cursor: plan and billing-cycle use from its own usage API ----------
  let cursorCache: { at: number; value: Omit<HomeAccount, "history" | "advice"> | null } = { at: 0, value: null };
  async function cursorUsage(): Promise<Omit<HomeAccount, "history" | "advice"> | null> {
    if (Date.now() - cursorCache.at < 5 * 60_000) return cursorCache.value;
    const db = path.join(os.homedir(), "Library", "Application Support", "Cursor", "User", "globalStorage", "state.vscdb");
    let value: Omit<HomeAccount, "history" | "advice"> | null = null;
    try {
      if (!fs.existsSync(db)) return null;
      const c = new Database(db, { readonly: true, fileMustExist: true });
      const get = (k: string) => (c.prepare("select value from ItemTable where key = ?").get(k) as { value?: string } | undefined)?.value ?? null;
      const token = get("cursorAuth/accessToken");
      const email = get("cursorAuth/cachedEmail");
      const member = get("cursorAuth/stripeMembershipType");
      c.close();
      if (!token) return null;
      const sub = String(JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8")).sub ?? "").split("|").pop();
      const r = await fetch("https://cursor.com/api/usage-summary", { headers: { Cookie: `WorkosCursorSessionToken=${sub}%3A%3A${token}` }, signal: AbortSignal.timeout(15_000) });
      if (!r.ok) throw new Error(`Cursor ${r.status}`);
      const d = (await r.json()) as {
        billingCycleEnd?: string;
        membershipType?: string;
        individualUsage?: { plan?: { totalPercentUsed?: number } };
      };
      const plan = d.membershipType ?? member ?? null;
      value = {
        id: "cursor",
        harness: "cursor",
        label: "Cursor",
        email,
        plan: plan ? `Cursor ${plan === "ultra" ? "Ultra" : plan === "pro_plus" ? "Pro+" : plan.charAt(0).toUpperCase() + plan.slice(1)}` : null,
        session: null,
        sessionResetsAt: null,
        week: typeof d.individualUsage?.plan?.totalPercentUsed === "number" ? d.individualUsage.plan.totalPercentUsed : null,
        weekResetsAt: d.billingCycleEnd ?? null,
        cycleLabel: "This month",
        status: "ok",
      };
    } catch (e) {
      bb.log.warn(`cursor usage: ${String(e)}`);
      value = { id: "cursor", harness: "cursor", label: "Cursor", email: null, plan: null, session: null, sessionResetsAt: null, week: null, weekResetsAt: null, cycleLabel: "This month", status: "error" };
    }
    cursorCache = { at: Date.now(), value };
    return value;
  }

  // ---------- Claude + Codex through the Account Pooler ----------
  async function poolAccounts(): Promise<Array<Omit<HomeAccount, "history" | "advice">>> {
    const out: Array<Omit<HomeAccount, "history" | "advice">> = [];
    let list: z.infer<typeof listSchema>;
    try {
      list = await bb.sdk.plugins.callRpc({ pluginId: "account-pool", method: "provider-usage.v1.listResources", input: {} as never, outputSchema: listSchema });
    } catch {
      return out;
    }
    const t = await tiers();
    for (const res of list.resources) {
      const harness = res.providerId.includes("codex") ? "codex" : res.providerId.includes("claude") ? "claude" : null;
      if (!harness) continue;
      try {
        const r = await bb.sdk.plugins.callRpc({ pluginId: "account-pool", method: "provider-usage.v1.getResource", input: { resourceId: res.id, refresh: false } as never, outputSchema: usageSchema });
        const ws = r.usage.windows ?? [];
        const sess = ws.find((w) => w.kind === "five-hour" || /five|5h|session/i.test(w.label));
        const week = ws.find((w) => w.kind === "weekly" && !w.model) ?? ws.find((w) => w.kind === "weekly");
        const email = r.usage.accountEmail ?? res.label;
        const plan = planOf(t, harness, r.usage.planLabel ?? null, email);
        out.push({
          id: res.id,
          harness,
          label: harness === "claude" ? "Claude" : "Codex",
          email,
          plan,
          session: sess ? sess.usedPercent : null,
          sessionResetsAt: sess?.resetsAt ?? null,
          week: week ? week.usedPercent : null,
          weekResetsAt: week?.resetsAt ?? null,
          cycleLabel: "This week",
          status: r.usage.status === "ok" ? "ok" : "error",
        });
      } catch {
        out.push({ id: res.id, harness, label: harness === "claude" ? "Claude" : "Codex", email: res.label, plan: null, session: null, sessionResetsAt: null, week: null, weekResetsAt: null, cycleLabel: "This week", status: "error" });
      }
    }
    return out;
  }

  // ---------- History and plan advice ----------
  type History = Record<string, Record<string, number>>; // accountId -> day -> peak %
  async function record(accounts: Array<Omit<HomeAccount, "history" | "advice">>) {
    const h = ((await bb.storage.kv.get<History>("usage-history")) ?? {}) as History;
    const d = today();
    for (const a of accounts) {
      if (a.week === null) continue;
      const days = (h[a.id] ??= {});
      days[d] = Math.max(days[d] ?? 0, Math.round(a.week * 10) / 10);
      const keep = Object.keys(days).sort().slice(-60);
      h[a.id] = Object.fromEntries(keep.map((k) => [k, days[k]]));
    }
    await bb.storage.kv.set("usage-history", h);
    return h;
  }

  function advise(a: Omit<HomeAccount, "history" | "advice">, hist: Array<{ day: string; peak: number }>): string | null {
    if (hist.length < 14) return `Collecting usage: advice after 14 days (${hist.length} so far).`;
    const peak = Math.max(...hist.slice(-28).map((x) => x.peak));
    if (a.plan === "Max 20x" && peak < 20)
      return `Peaked at ${Math.round(peak)}% of the weekly limit over the last ${Math.min(hist.length, 28)} days. Max 5x has a quarter of the allowance, so it would have covered that and saves $${PRICES["Max 20x"] - PRICES["Max 5x"]} a month.`;
    if (a.plan === "Max 20x" && peak > 85) return `Peaked at ${Math.round(peak)}% of the weekly limit, so this account is close to its ceiling. Spread work onto the other account before it runs out.`;
    if (a.plan === "Cursor Ultra" && peak < 25)
      return `Used ${Math.round(peak)}% of this month's allowance at most. Pro+ costs $${PRICES["Cursor Ultra"] - PRICES["Cursor Pro+"]} a month less; check its allowance covers your heaviest month before switching.`;
    if (peak >= 70) return `Peaked at ${Math.round(peak)}%: this plan is earning its keep.`;
    return null;
  }

  async function accounts(): Promise<HomeAccount[]> {
    const live = [...(await poolAccounts())];
    const cur = await cursorUsage();
    if (cur) live.push(cur);
    const h = await record(live);
    return live.map((a) => {
      const hist = Object.entries(h[a.id] ?? {})
        .sort(([x], [y]) => x.localeCompare(y))
        .map(([day, peak]) => ({ day, peak }));
      return { ...a, history: hist.slice(-28), advice: advise(a, hist) };
    });
  }

  // ---------- Agenda: Google Calendar through Composio ----------
  const composioKey = () => readKey("COMPOSIO_API_KEY");
  async function agenda(): Promise<z.infer<typeof agendaSchema>> {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const end = new Date(start.getTime() + 2 * 86_400_000); // today and tomorrow
    const r = await events(start, end, 40);
    if (r.configured && !r.error) {
      // Snapshot for other tools (the daily brief reads it when present).
      try {
        const dir = path.join(os.homedir(), ".cache", "navaigate");
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, "agenda.json"), JSON.stringify({ at: new Date().toISOString(), events: r.events }, null, 2));
      } catch {
        /* best effort */
      }
    }
    return { ...r, events: r.events.slice(0, 30) };
  }

  /** Events from every active Google Calendar in Composio between start and end, de-duplicated across calendars. */
  async function events(start: Date, end: Date, perCalendar = 250): Promise<z.infer<typeof agendaSchema>> {
    const key = composioKey();
    if (!key) return { configured: false, error: null, reconnect: [], events: [] };
    const api = async (p: string, init?: RequestInit) => {
      const r = await fetch(`https://backend.composio.dev/api/v3${p}`, { ...init, headers: { "x-api-key": key, "Content-Type": "application/json" }, signal: AbortSignal.timeout(25_000) });
      if (!r.ok) throw new Error(`Composio ${r.status}`);
      return r.json() as Promise<Record<string, unknown>>;
    };
    try {
      const list = (await api("/connected_accounts?toolkit_slugs=googlecalendar&limit=50")) as { items?: Array<{ id: string; status: string; user_id: string; toolkit?: { slug?: string } }> };
      const cal = (list.items ?? []).filter((a) => (a.toolkit?.slug ?? "googlecalendar") === "googlecalendar");
      const active = cal.filter((a) => a.status === "ACTIVE");
      const seen = new Set(active.map((a) => a.user_id));
      const reconnect = Array.from(new Set(cal.filter((a) => a.status === "EXPIRED" && !seen.has(a.user_id)).map((a) => a.user_id)));
      if (!active.length) return { configured: true, error: null, reconnect, events: [] };
      const events: z.infer<typeof agendaSchema>["events"] = [];
      for (const a of active) {
        const r = (await api("/tools/execute/GOOGLECALENDAR_EVENTS_LIST", {
          method: "POST",
          body: JSON.stringify({ connected_account_id: a.id, user_id: a.user_id, arguments: { calendarId: "primary", timeMin: start.toISOString(), timeMax: end.toISOString(), singleEvents: true, orderBy: "startTime", maxResults: perCalendar } }),
        })) as { successful?: boolean; error?: string | null; data?: { items?: unknown[]; response_data?: { items?: unknown[] } } };
        const items = (r.data?.items ?? r.data?.response_data?.items ?? []) as Array<{
          summary?: string;
          start?: { dateTime?: string; date?: string };
          end?: { dateTime?: string; date?: string };
          location?: string;
          hangoutLink?: string;
          htmlLink?: string;
          status?: string;
        }>;
        for (const e of items) {
          if (e.status === "cancelled") continue;
          events.push({
            title: (e.summary ?? "(no title)").slice(0, 140),
            start: e.start?.dateTime ?? e.start?.date ?? "",
            end: e.end?.dateTime ?? e.end?.date ?? null,
            allDay: !e.start?.dateTime,
            account: a.user_id,
            location: e.location ?? null,
            link: e.hangoutLink ?? e.htmlLink ?? null,
          });
        }
      }
      events.sort((x, y) => x.start.localeCompare(y.start));
      // The same event often sits in both calendars ("LH 772" / "LH772"): keep one.
      const norm = (t: string) => t.toLowerCase().replace(/[^a-z0-9]/g, "");
      const seenKey = new Set<string>();
      const unique = events.filter((e) => {
        const k = `${new Date(e.start).getTime() || e.start}|${norm(e.title)}`;
        if (seenKey.has(k)) return false;
        seenKey.add(k);
        return true;
      });
      return { configured: true, error: null, reconnect, events: unique };
    } catch (e) {
      return { configured: true, error: String(e instanceof Error ? e.message : e), reconnect: [], events: [] };
    }
  }

  // ---------- Daily brief (read the latest; "Run today's brief" starts a chat that writes it) ----------
  // A local folder only, read asynchronously, so a slow disk can never block the plugin.
  let briefCache: { at: number; value: { date: string | null; headline: string | null; path: string | null } } | null = null;
  const headlineOf = (html: string) => {
    // One line from the brief's sections: "Needs a reply 3 · Open tasks 5 · ..."
    const clean = (x: string) => x.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
    const parts = html.split(/<h2[^>]*>/i).slice(1, 5).map((chunk) => {
      const title = clean(chunk.split(/<\/h2>/i)[0]);
      const items = (chunk.match(/<li[\s>]/gi) ?? []).length;
      return items ? `${title} ${items}` : title;
    });
    const text = parts.join(" · ").slice(0, 240);
    return text || null;
  };
  async function briefLatest(): Promise<{ date: string | null; headline: string | null; path: string | null }> {
    if (briefCache && Date.now() - briefCache.at < 60_000) return briefCache.value;
    const empty = { date: null, headline: null, path: null };
    try {
      const files = (await fs.promises.readdir(BRIEF_DIR)).filter((f) => /^\d{4}-\d{2}-\d{2}\.html$/.test(f)).sort();
      const name = files.at(-1);
      const html = name ? await fs.promises.readFile(path.join(BRIEF_DIR, name), "utf8") : "";
      const value = name ? { date: name.slice(0, 10), headline: headlineOf(html), path: path.join(BRIEF_DIR, name) } : empty;
      briefCache = { at: Date.now(), value };
      return value;
    } catch {
      return briefCache?.value ?? empty;
    }
  }

  return { accounts, agenda, events, briefLatest, composioKey, cursorUsage, planLabel };
}
