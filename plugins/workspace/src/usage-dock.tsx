// Usage dock: a thin line under the chat box with the thread's context window
// (tokens used, share, where auto-compaction kicks in) and the provider's plan
// windows (five-hour, weekly…) with their reset times. It replaces bb's small
// context ring, which it hides while mounted and restores on unmount.
//
// bb has no slot under the composer, so an app overlay owns the data (SDK
// hooks) and writes plain, escaped markup into a slot element it inserts right
// after the composer footer. The slot carries the plugin scope attributes so
// the plugin's compiled classes apply. Polling pauses while the window is hidden.
// Hovering the line (or focusing it and pressing Enter) opens the usage card
// (usage-card.tsx) on the account this chat runs on.
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { experimental_useSidebarThreads as useSidebarThreads, useBbContext, useRpc, useSdk } from "@get-bb/plugin-sdk/app";
import { z } from "zod";
import type { rpcContract } from "../server";
import { harnessOf } from "./shared";
import { UsageHover } from "./usage-card";

const POOL_PROVIDER: Record<string, "claude" | "codex"> = { "claude-code": "claude", codex: "codex" };

const usageSchema = z
  .object({
    usage: z
      .object({
        status: z.string(),
        accountEmail: z.string().nullable().optional(),
        planLabel: z.string().nullable().optional(),
        windows: z
          .array(z.object({ label: z.string(), usedPercent: z.number(), resetsAt: z.string().nullable(), kind: z.string().optional(), model: z.string().nullable().optional() }).passthrough())
          .optional(),
      })
      .passthrough(),
  })
  .passthrough();

type Plan = { label: string | null; email: string | null; source: "pinned" | "pool" | "local" };

const FOOTER = "[data-follow-up-composer-footer]";
const RING = '[aria-label^="Context window"]';

type Ctx = { used: number | null; window: number | null; compactAt: number | null; estimated: boolean; sessionId: string | null } | null;
type Win = { label: string; pct: number; resetsAt: string | null };

function useDockSlot(): HTMLElement | null {
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  useEffect(() => {
    let current: HTMLElement | null = null;
    let hidden: HTMLElement | null = null;
    let scheduled = false;
    const sync = () => {
      scheduled = false;
      const footer = document.querySelector<HTMLElement>(FOOTER);
      if (!footer) {
        if (current) {
          current.remove();
          current = null;
          setSlot(null);
        }
        return;
      }
      if (!current || !current.isConnected || current.previousElementSibling !== footer) {
        current?.remove();
        current = document.createElement("div");
        current.setAttribute("data-bb-plugin-root", "");
        current.setAttribute("data-bb-plugin", "navaigate-workspace");
        current.setAttribute("data-nav-usage-dock", "");
        footer.insertAdjacentElement("afterend", current);
        setSlot(current);
      }
      const ring = footer.querySelector<HTMLElement>(RING);
      const target = (ring?.closest("button") as HTMLElement | null) ?? ring;
      if (target && target !== hidden) {
        if (hidden) hidden.style.display = "";
        target.style.display = "none";
        hidden = target;
      }
    };
    const schedule = () => {
      if (scheduled) return;
      scheduled = true;
      requestAnimationFrame(sync);
    };
    sync();
    const mo = new MutationObserver(schedule);
    mo.observe(document.body, { childList: true, subtree: true });
    return () => {
      mo.disconnect();
      current?.remove();
      if (hidden) hidden.style.display = "";
    };
  }, []);
  return slot;
}

function usePoll(fn: () => Promise<void>, ms: number, deps: unknown[]) {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => {
    let stop = false;
    const tick = () => {
      if (!stop && document.visibilityState === "visible") void ref.current().catch(() => undefined);
    };
    tick();
    const id = window.setInterval(tick, ms);
    const onVis = () => tick();
    document.addEventListener("visibilitychange", onVis);
    return () => {
      stop = true;
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVis);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);

function k(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`;
  if (n >= 1000) return `${Math.round(n / 1000)}k`;
  return String(n);
}

function tone(pct: number): string {
  if (pct >= 90) return "var(--destructive)";
  if (pct >= 70) return "var(--warning-text)";
  return "var(--attention)";
}

function resetLabel(iso: string | null): string {
  if (!iso) return "";
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "";
  const d = new Date(t);
  const diff = t - Date.now();
  if (diff <= 0) return "resetting";
  if (diff < 24 * 3600_000) return `resets ${d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}`;
  return `resets ${d.toLocaleDateString("en-GB", { weekday: "short" })} ${d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}`;
}

function bar(pct: number, width: number, marker: number | null): string {
  const p = Math.max(0, Math.min(100, pct));
  const m = marker === null ? "" : `<span class="absolute inset-y-[-2px] w-px bg-foreground/50" style="left:${Math.max(0, Math.min(100, marker))}%"></span>`;
  return `<span class="relative inline-block h-[5px] shrink-0 rounded-full bg-muted" style="width:${width}px"><span class="absolute inset-y-0 left-0 rounded-full" style="width:${p}%;background:${tone(p)}"></span>${m}</span>`;
}

/* Comet dial (after React Bits' CometDial): a 270° gauge whose lit arc ends in
   a bright head with a fading tail behind it, plus a tick where auto-compaction
   starts. Static SVG, redrawn on each reading. */
function polar(deg: number, r: number): [number, number] {
  const a = (deg * Math.PI) / 180;
  return [12 + Math.cos(a) * r, 12 + Math.sin(a) * r];
}
function arc(a0: number, a1: number, r: number): string {
  const [x0, y0] = polar(a0, r);
  const [x1, y1] = polar(a1, r);
  return `M ${x0.toFixed(2)} ${y0.toFixed(2)} A ${r} ${r} 0 ${a1 - a0 > 180 ? 1 : 0} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
}
function comet(pct: number, marker: number | null): string {
  const START = 135;
  const SWEEP = 270;
  const R = 8.5;
  const p = Math.max(0, Math.min(100, pct));
  const head = START + (p / 100) * SWEEP;
  const color = tone(p);
  const parts = [`<path d="${arc(START, START + SWEEP, R)}" fill="none" stroke="var(--muted)" stroke-width="2.5" stroke-linecap="round"/>`];
  if (p > 0.5) {
    parts.push(`<path d="${arc(START, head, R)}" fill="none" stroke="${color}" stroke-opacity=".28" stroke-width="2.5" stroke-linecap="round"/>`);
    const tail = Math.min(70, head - START);
    const segs = 6;
    for (let i = 0; i < segs; i++) {
      const a0 = head - tail + (tail / segs) * i;
      const a1 = head - tail + (tail / segs) * (i + 1);
      if (a1 - a0 < 0.5) continue;
      parts.push(`<path d="${arc(a0, a1, R)}" fill="none" stroke="${color}" stroke-opacity="${(0.25 + (0.75 * (i + 1)) / segs).toFixed(2)}" stroke-width="${(1.6 + (1.4 * (i + 1)) / segs).toFixed(2)}" stroke-linecap="round"/>`);
    }
    const [hx, hy] = polar(head, R);
    parts.push(`<circle cx="${hx.toFixed(2)}" cy="${hy.toFixed(2)}" r="2.6" fill="${color}" style="filter:drop-shadow(0 0 2px ${color})"/>`);
  }
  if (marker !== null) {
    const m = START + (Math.max(0, Math.min(100, marker)) / 100) * SWEEP;
    const [ix, iy] = polar(m, R - 3.2);
    const [ox, oy] = polar(m, R + 3.2);
    parts.push(`<line x1="${ix.toFixed(2)}" y1="${iy.toFixed(2)}" x2="${ox.toFixed(2)}" y2="${oy.toFixed(2)}" stroke="var(--foreground)" stroke-opacity=".45" stroke-width="1"/>`);
  }
  return `<svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true" class="shrink-0">${parts.join("")}</svg>`;
}

const cap = (s: string) => `<span class="text-[10.5px] font-medium uppercase tracking-[0.14em] text-muted-foreground">${esc(s)}</span>`;

function render(ctx: Ctx, harness: string, wins: Win[] | null, plan: Plan | null, width = 800): string {
  const parts: string[] = [];
  if (ctx && ctx.used !== null && ctx.window) {
    const pct = (ctx.used / ctx.window) * 100;
    const compactPct = ctx.compactAt ? (ctx.compactAt / ctx.window) * 100 : null;
    const left = ctx.compactAt ? Math.max(0, ctx.compactAt - ctx.used) : null;
    const title = `Context: ${ctx.used.toLocaleString("en-GB")} of ${ctx.window.toLocaleString("en-GB")} tokens${ctx.estimated ? " (estimated)" : ""}${ctx.compactAt ? `. Auto-compacts at ${ctx.compactAt.toLocaleString("en-GB")}.` : ""}`;
    parts.push(
      `<span class="flex items-center gap-2" title="${esc(title)}">${cap("Context")}${comet(pct, compactPct)}` +
        `<span class="text-foreground">${k(ctx.used)}</span><span>/ ${k(ctx.window)} · ${Math.round(pct)}%</span>` +
        (left !== null && width >= 860 ? `<span class="text-muted-foreground/80">· ${k(left)} to compact</span>` : "") +
        `</span>`,
    );
  } else if (ctx && ctx.used !== null) {
    parts.push(
      `<span class="flex items-center gap-2" title="${esc(`Context: about ${ctx.used.toLocaleString("en-GB")} tokens in use; bb has not reported this model's window size yet.`)}">${cap("Context")}${comet(0, null)}<span class="text-foreground">${k(ctx.used)}</span><span>in use</span></span>`,
    );
  } else {
    parts.push(`<span class="flex items-center gap-2">${cap("Context")}${comet(0, null)}<span>waiting for the first turn</span></span>`);
  }
  if (wins && wins.length > 0) {
    parts.push(`<span aria-hidden class="h-3 w-px bg-border"></span>`);
    if (plan && (plan.label || plan.email) && width >= 660) {
      const who = plan.email ?? "";
      const how = plan.source === "pinned" ? "this chat is pinned to" : plan.source === "pool" ? "the pool's current account" : "local login";
      parts.push(
        `<span class="flex min-w-0 items-center gap-1.5" title="${esc(`${planName(harness, plan.label)}${plan.email ? ` · ${plan.email}` : ""} (${how}). Usage is live from the provider; the plan tier is what bb recorded when this account was signed in, so re-sign-in after changing plan.`)}">${cap(planName(harness, plan.label))}${who ? `<span class="truncate text-muted-foreground/80">${esc(who)}</span>` : ""}</span>`,
      );
    }
    // Session always, then whichever other window is fullest; the rest live in the tooltip.
    const session = wins.find((w) => w.label === "Session");
    const others = wins.filter((w) => w !== session).sort((a, b) => b.pct - a.pct);
    const shown = [session, others[0]].filter((w): w is Win => !!w);
    for (const w of shown) {
      const r = resetLabel(w.resetsAt);
      parts.push(
        `<span class="flex items-center gap-2" title="${esc(`${harness} ${w.label}: ${Math.round(w.pct)}% used${r ? `, ${r}` : ""}`)}">${cap(w.label)}${bar(w.pct, 44, null)}` +
          `<span class="text-foreground">${Math.round(w.pct)}%</span>${r && w.pct >= 70 ? `<span class="text-muted-foreground/80">${esc(r)}</span>` : ""}</span>`,
      );
    }
  }
  return `<div class="flex h-7 min-w-0 items-center gap-4 overflow-hidden whitespace-nowrap px-1.5 pt-1 text-[11.5px] text-muted-foreground" style="font-variant-numeric:tabular-nums">${parts.join("")}</div>`;
}

/** "Claude Max", "ChatGPT Pro"… The provider is named so a Codex plan is never
 *  mistaken for a Claude one, and the 5x/20x multiplier is dropped because bb
 *  only records it at sign-in and it goes stale after a plan change. */
function planName(harness: string, label: string | null): string {
  const provider = harness === "Codex" ? "ChatGPT" : harness === "Claude" ? "Claude" : harness;
  const base = (label ?? "").replace(/\s*\(?\d+\s*x\)?/gi, "").trim();
  return base ? `${provider} ${base}` : provider;
}

function shortLabel(w: { label: string; kind?: string; model?: string | null }): string {
  const model = w.model ? ` · ${w.model.charAt(0).toUpperCase()}${w.model.slice(1)}` : "";
  if (w.kind === "five-hour") return "Session";
  if (w.kind === "weekly") return `Week${model}`;
  if (w.kind === "daily") return `Day${model}`;
  const l = w.label.toLowerCase();
  if (l.includes("session")) return "Session";
  if (l.includes("week")) return `Week${model}`;
  return w.label.length > 16 ? `${w.label.slice(0, 15)}…` : w.label;
}

export function UsageDock() {
  const slot = useDockSlot();
  const { threadId } = useBbContext();
  const sdk = useSdk();
  const rpc = useRpc<typeof rpcContract>();
  const { threads } = useSidebarThreads();
  const thread = threadId ? threads.find((t) => t.id === threadId) : undefined;
  const providerId = thread?.providerId ?? null;
  const running = thread ? thread.status === "active" || thread.status === "starting" : false;
  const [ctx, setCtx] = useState<Ctx>(null);
  // Remembered across reloads, so one bad estimate cannot shrink the window.
  const bestWindow = useRef<Map<string, number>>(
    (() => {
      try {
        return new Map(Object.entries(JSON.parse(window.localStorage.getItem("nav-skin:ctxwin") ?? "{}") as Record<string, number>));
      } catch {
        return new Map<string, number>();
      }
    })(),
  );
  const [wins, setWins] = useState<Win[] | null>(null);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [acct, setAcct] = useState<string | null>(null);
  const sessionId = ctx?.sessionId ?? null;

  useEffect(() => {
    setCtx(null);
    setWins(null);
    setPlan(null);
    setAcct(null);
  }, [threadId]);

  usePoll(
    async () => {
      if (!threadId || !slot) return;
      const r = (await sdk.threads.context({ threadId })) as unknown as {
        usage: null | {
          usedTokens?: number | null;
          modelContextWindow?: number | null;
          estimated?: boolean;
          snapshot?: { autoCompactAtTokens?: number | null; usedTokens?: number; contextWindowTokens?: number; providerSessionId?: string };
        };
      };
      const u = r.usage;
      // bb sometimes falls back to an estimate with a default 200k window even
      // on 1M-context models. Keep the largest real window seen for this chat,
      // and never trust a window smaller than what is already in use.
      const reported = Math.max(u?.snapshot?.contextWindowTokens ?? 0, u?.modelContextWindow ?? 0);
      const known = Math.max(reported, bestWindow.current.get(threadId) ?? 0);
      if (known > 0 && known !== bestWindow.current.get(threadId)) {
        bestWindow.current.set(threadId, known);
        try {
          window.localStorage.setItem("nav-skin:ctxwin", JSON.stringify(Object.fromEntries([...bestWindow.current].slice(-200))));
        } catch {
          /* storage blocked: memory only */
        }
      }
      const used = u ? (u.usedTokens ?? u.snapshot?.usedTokens ?? null) : null;
      setCtx(
        u
          ? {
              used,
              window: known > 0 && (used === null || used <= known) ? known : null,
              compactAt: u.snapshot?.autoCompactAtTokens ?? null,
              estimated: !!u.estimated,
              sessionId: u.snapshot?.providerSessionId ?? null,
            }
          : null,
      );
    },
    running ? 4000 : 15000,
    [threadId, slot, running, sdk],
  );

  usePoll(
    async () => {
      if (!providerId || !slot) return;
      // 1. The subscription this chat really runs on: its pooled account if the
      //    Account Pooler routes this provider, else the pool's current account.
      const poolProvider = POOL_PROVIDER[providerId];
      if (poolProvider) {
        try {
          const { accountId, activeAccountId } = await rpc.call("pool_account", { provider: poolProvider, sessionId });
          const id = accountId ?? activeAccountId;
          if (id) {
            const r = await sdk.plugins.callRpc({
              pluginId: "account-pool",
              method: "provider-usage.v1.getResource",
              input: { resourceId: id, refresh: false },
              outputSchema: usageSchema,
            });
            if (r.usage.status === "ok" && r.usage.windows) {
              setWins(r.usage.windows.map((w) => ({ label: shortLabel({ label: w.label, kind: w.kind, model: w.model ?? undefined }), pct: w.usedPercent, resetsAt: w.resetsAt })));
              setPlan({ label: r.usage.planLabel ?? null, email: r.usage.accountEmail ?? null, source: accountId ? "pinned" : "pool" });
              setAcct(id);
              return;
            }
          }
        } catch {
          /* pooler off or changed: fall through to the local login */
        }
      }
      // 2. Fallback: the provider's own local login.
      setAcct(providerId.includes("cursor") ? "cursor" : null);
      const all = (await sdk.system.usageLimits({ providerId })) as Record<
        string,
        { status: string; planLabel?: string | null; accountEmail?: string | null; windows?: Array<{ label: string; usedPercent: number; resetsAt: string | null; kind?: string; model?: string }> }
      >;
      const entry = all[providerId] ?? Object.values(all)[0];
      if (entry && entry.status === "ok" && entry.windows) {
        setWins(entry.windows.map((w) => ({ label: shortLabel(w), pct: w.usedPercent, resetsAt: w.resetsAt })));
        setPlan({ label: entry.planLabel ?? null, email: entry.accountEmail ?? null, source: "local" });
      } else {
        setWins(null);
        setPlan(null);
      }
    },
    60_000,
    [providerId, slot, sdk, rpc, sessionId],
  );

  if (!slot || !threadId) return null;
  // The card replaces the line's native tooltips, which would otherwise pop up over it.
  const html = render(ctx, providerId ? harnessOf(providerId).label : "", wins, plan, slot.clientWidth || 800).replace(/ title="/g, ' data-tip="');
  return createPortal(
    <UsageHover thisAccount={acct}>
      <div dangerouslySetInnerHTML={{ __html: html }} />
    </UsageHover>,
    slot,
  );
}
