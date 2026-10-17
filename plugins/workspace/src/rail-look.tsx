// The look of the two-line rail rows: project colours, the model and effort
// line, the state glyphs, the spinner and the motion. Everything animates with
// transform and opacity only, and every animation stops under reduced motion.
//
// Model and effort are not on bb's sidebar threads, so they come from the
// plugin server in batches (thread_exec, which asks bb for each chat's current
// execution options). The answers are cached here and in localStorage, keyed
// by the chat's updatedAt, and a chat is asked again only once it has changed
// and stopped running. Rendering a row never makes a request.
import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { useRpc, type PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import type { rpcContract } from "../server";
import { harnessOf, stateOf } from "./shared";

/* ------------------------------ project colours ------------------------------ */

export const PROJECT_COLORS = ["gold", "orange", "green", "teal", "plum", "rose", "slate"] as const;
export type ProjectColor = (typeof PROJECT_COLORS)[number];
export const PROJECT_COLOR_LABEL: Record<ProjectColor, string> = {
  gold: "Gold",
  orange: "Orange",
  green: "Green",
  teal: "Teal",
  plum: "Plum",
  rose: "Rose",
  slate: "Slate",
};
export const projectCss = (c: ProjectColor) => `var(--nav-pc-${c})`;

const isProjectColor = (v: unknown): v is ProjectColor => typeof v === "string" && (PROJECT_COLORS as readonly string[]).includes(v);

/** The colour picked for a project, else a stable one from its id. */
export function projectColorOf(projectId: string, picked: Record<string, string> | undefined): ProjectColor {
  const p = picked?.[projectId];
  if (isProjectColor(p)) return p;
  let h = 5381;
  for (let i = 0; i < projectId.length; i++) h = ((h << 5) + h + projectId.charCodeAt(i)) | 0;
  return PROJECT_COLORS[Math.abs(h) % PROJECT_COLORS.length];
}

/* ---------------------------------- motion ---------------------------------- */

const STAGGER = Array.from({ length: 16 }, (_, i) => `.nav-sec-in > :nth-child(${i + 1}) { animation-delay: ${i * 20}ms; }`).join("\n");

const CSS = `
:root, .light {
  --nav-pc-gold: #b8862f; --nav-pc-orange: #c46a2e; --nav-pc-green: #2f8a5b; --nav-pc-teal: #3f7f74;
  --nav-pc-plum: #7a5c8a; --nav-pc-rose: #b4536a; --nav-pc-slate: #66707a;
}
.dark {
  --nav-pc-gold: #d4a354; --nav-pc-orange: #e08a4f; --nav-pc-green: #5fcf94; --nav-pc-teal: #8fbfb0;
  --nav-pc-plum: #b79ac4; --nav-pc-rose: #e391a5; --nav-pc-slate: #9aa3ad;
}
@keyframes nav-row-in { from { opacity: 0; transform: translateY(-4px); } to { opacity: 1; transform: none; } }
@keyframes nav-bar-grow { from { transform: scaleY(0); } to { transform: scaleY(1); } }
@keyframes nav-glyph-in { from { opacity: 0; transform: scale(.6); } to { opacity: 1; transform: none; } }
@keyframes nav-pop { 0% { opacity: 0; transform: scale(.4); } 55% { opacity: 1; transform: scale(1.22); } 100% { opacity: 1; transform: scale(1); } }
@keyframes nav-spin { to { transform: rotate(360deg); } }
@keyframes nav-l2-in { from { opacity: 0; transform: translateY(-3px); } to { opacity: 1; transform: none; } }
.nav-sec-in > * { animation: nav-row-in 240ms cubic-bezier(.23,1,.32,1) both; animation-delay: 320ms; }
${STAGGER}
.nav-bar { transform-origin: top center; }
.nav-bar-grow { animation: nav-bar-grow 380ms cubic-bezier(.23,1,.32,1) both; }
.nav-glyph-in { animation: nav-glyph-in 200ms cubic-bezier(.23,1,.32,1) both; }
.nav-pop { animation: nav-pop 420ms cubic-bezier(.34,1.56,.64,1) both; }
.nav-spin { animation: nav-spin 900ms linear infinite; transform-origin: 50% 50%; }
.nav-fade { transition: opacity 120ms ease-out; }
.nav-l2 { transition: opacity 140ms ease-in, transform 140ms ease-in; }
.nav-rows-out .nav-l2 { opacity: 0; transform: translateY(-3px); }
.nav-rows-in .nav-l2 { animation: nav-l2-in 220ms cubic-bezier(.23,1,.32,1) both; }
@media (prefers-reduced-motion: reduce) {
  .nav-sec-in > *, .nav-bar-grow, .nav-glyph-in, .nav-pop, .nav-rows-in .nav-l2 { animation: none !important; }
  .nav-spin { animation-duration: 2400ms; }
  .nav-fade, .nav-l2 { transition: none !important; }
}
`;

let injected = false;
export function ensureRailLook() {
  if (injected || typeof document === "undefined") return;
  if (!document.getElementById("nav-rail-look")) {
    const el = document.createElement("style");
    el.id = "nav-rail-look";
    el.textContent = CSS;
    document.head.appendChild(el);
  }
  injected = true;
}

/** True for one moment after `open` turns true: the section's rows and bar animate in. */
export function useJustOpened(open: boolean): boolean {
  const [seen, setSeen] = useState(open);
  const [until, setUntil] = useState(0);
  if (seen !== open) {
    setSeen(open);
    if (open) setUntil(Date.now() + 700);
  }
  const on = until > Date.now();
  useEffect(() => {
    if (!on) return;
    const t = window.setTimeout(() => setUntil(0), Math.max(0, until - Date.now()));
    return () => window.clearTimeout(t);
  }, [on, until]);
  return on;
}

/* ----------------------------- model and effort ----------------------------- */

export type Exec = { model: string; reasoningLevel: string };

const cap = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

/** "claude-opus-5-5" -> "Opus", "gpt-6.1-sol" -> "GPT-6.1 Sol", "grok-4.6" -> "Grok 4.6". */
export function shortModel(raw: string): string {
  let id = raw.trim();
  if (!id) return "";
  id = id.split(":").pop() ?? id;
  id = id.split("/").pop() ?? id;
  // Some ids carry the effort too ("grok-4.7-xhigh"); the effort has its own slot.
  const low = id.toLowerCase().replace(/-(?:low|medium|high|xhigh|max|thinking)$/, "");
  if (low === "default" || low === "auto") return "Auto";
  const fam = low.match(/(?:^|-)(opus|sonnet|haiku|fable)(?:-|$)/);
  if (fam) return cap(fam[1]);
  const gpt = low.match(/^gpt-([\d.]+)(?:-(.+))?$/);
  if (gpt) return `GPT-${gpt[1]}${gpt[2] ? ` ${gpt[2].split("-").map(cap).join(" ")}` : ""}`;
  const words = low.replace(/-\d{8}$/, "").split("-").filter(Boolean).map(cap).join(" ");
  return words.length > 20 ? `${words.slice(0, 19)}…` : words;
}

const EFFORT: Record<string, string> = { low: "Low", medium: "Medium", high: "High", xhigh: "X-High", max: "Max", ultra: "Ultra", ultracode: "Ultra" };
export const effortWord = (level: string | undefined) => (level ? EFFORT[level] ?? "" : "");

/** The muted second line: "Opus · High", or "Codex · GPT-6.1 Sol · High" when the harness is not Claude. */
export function execLine(providerId: string, exec: Exec | null | undefined): string {
  const h = harnessOf(providerId);
  if (!exec) return h.label;
  const m = shortModel(exec.model);
  const parts = h.key === "claude" && m ? [m] : [h.label, m];
  const e = effortWord(exec.reasoningLevel);
  if (e) parts.push(e);
  return parts.filter(Boolean).join(" · ");
}

type Entry = { at: number; v: Exec | null; f: number };
const STORE = "nav-skin:exec:v1";
const MAX_KEPT = 800;
const RETRY_MS = 15_000;
const BATCH = 150;

let cache: Map<string, Entry> | null = null;
const inFlight = new Set<string>();

function getCache(): Map<string, Entry> {
  if (cache) return cache;
  cache = new Map();
  try {
    const raw = JSON.parse(window.localStorage.getItem(STORE) ?? "{}") as Record<string, [number, string, string] | [number]>;
    for (const [id, e] of Object.entries(raw)) {
      if (!Array.isArray(e) || typeof e[0] !== "number") continue;
      cache.set(id, { at: e[0], v: typeof e[1] === "string" ? { model: e[1], reasoningLevel: String(e[2] ?? "") } : null, f: 0 });
    }
  } catch {
    /* unreadable: start empty */
  }
  return cache;
}

function saveCache() {
  const c = getCache();
  const rows = [...c.entries()].sort((a, b) => b[1].at - a[1].at).slice(0, MAX_KEPT);
  const out: Record<string, [number, string, string] | [number]> = {};
  for (const [id, e] of rows) out[id] = e.v ? [e.at, e.v.model, e.v.reasoningLevel] : [e.at];
  try {
    window.localStorage.setItem(STORE, JSON.stringify(out));
  } catch {
    /* full or blocked: the cache stays in memory */
  }
}

/**
 * Model and effort for every chat in the list, fetched in batches when a chat
 * is new or has changed since it was last asked (and is not running), never
 * per row and never during render. Returns a lookup by thread id.
 */
export function useThreadExec(threads: readonly PluginSidebarThread[], enabled: boolean): (id: string) => Exec | null | undefined {
  const rpc = useRpc<typeof rpcContract>();
  const [, setVersion] = useState(0);
  const latest = useRef(threads);
  latest.current = threads;
  const c = getCache();

  const want = useMemo(() => {
    if (!enabled) return "";
    const now = Date.now();
    const ids: string[] = [];
    for (const t of threads) {
      if (t.isHidden || t.isArchived || inFlight.has(t.id)) continue;
      const e = c.get(t.id);
      if (!e) ids.push(t.id);
      else if (t.updatedAt > e.at && now - e.f > RETRY_MS && stateOf(t) !== "running") ids.push(t.id);
    }
    return ids.join(",");
  }, [threads, enabled, c]);

  useEffect(() => {
    if (!want) return;
    const timer = window.setTimeout(() => {
      const ids = want.split(",").filter((id) => !inFlight.has(id));
      if (ids.length === 0) return;
      for (const id of ids) inFlight.add(id);
      const atOf = new Map(latest.current.map((t) => [t.id, t.updatedAt]));
      void (async () => {
        for (let i = 0; i < ids.length; i += BATCH) {
          const batch = ids.slice(i, i + BATCH);
          const now = Date.now();
          try {
            const r = await rpc.call("thread_exec", { ids: batch });
            for (const id of batch) {
              const prev = c.get(id);
              if (id in r) c.set(id, { at: atOf.get(id) ?? now, v: r[id] ?? null, f: now });
              else c.set(id, { at: prev?.at ?? 0, v: prev?.v ?? null, f: now });
            }
          } catch {
            for (const id of batch) {
              const prev = c.get(id);
              c.set(id, { at: prev?.at ?? 0, v: prev?.v ?? null, f: now });
            }
          } finally {
            for (const id of batch) inFlight.delete(id);
          }
          setVersion((v) => v + 1);
        }
        saveCache();
      })();
    }, 600);
    return () => window.clearTimeout(timer);
  }, [want, rpc, c]);

  return (id: string) => c.get(id)?.v;
}

/* ---------------------------------- glyphs ---------------------------------- */

export type GlyphKind = "ask" | "error" | "paused" | "done" | "none";

/** What the left gutter shows for a chat that is not flagged and not being selected. */
export function glyphOf(t: PluginSidebarThread): GlyphKind {
  if (stateOf(t) === "running") return "none";
  if (t.status === "error" || t.indicator === "unread-error" || t.indicator === "queued-failed") return "error";
  if (t.hasPendingInteraction || t.indicator === "waiting-for-input") return "ask";
  if (t.queuedWork === "waiting" || t.indicator === "queued-waiting") return "paused";
  if (t.isUnread) return "done";
  return "none";
}

export const GLYPH_LABEL: Record<GlyphKind, string> = {
  ask: "Needs an answer",
  error: "Stopped with an error",
  paused: "Message waiting",
  done: "Finished, not read yet",
  none: "",
};

/** The gutter glyph, 13px, drawn in theme tokens. */
export function StateGlyph({ kind }: { kind: GlyphKind }) {
  const s: CSSProperties = { width: 13, height: 13 };
  if (kind === "done") {
    return (
      <svg viewBox="0 0 16 16" style={s} role="img" aria-label={GLYPH_LABEL.done}>
        <path d="M3.5 8.4 6.6 11.4 12.6 4.9" fill="none" stroke="var(--success)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  if (kind === "ask") {
    return (
      <svg viewBox="0 0 16 16" style={s} role="img" aria-label={GLYPH_LABEL.ask}>
        <circle cx="8" cy="8" r="6.6" fill="color-mix(in srgb, var(--attention) 16%, transparent)" stroke="var(--attention)" strokeWidth="1.4" />
        <path d="M6.3 6.3a1.75 1.75 0 1 1 2.5 1.6c-.5.25-.8.6-.8 1.2v.2" fill="none" stroke="var(--attention)" strokeWidth="1.4" strokeLinecap="round" />
        <circle cx="8" cy="11.4" r=".85" fill="var(--attention)" />
      </svg>
    );
  }
  if (kind === "error") {
    return (
      <svg viewBox="0 0 16 16" style={s} role="img" aria-label={GLYPH_LABEL.error}>
        <circle cx="8" cy="8" r="6.6" fill="color-mix(in srgb, var(--destructive) 14%, transparent)" stroke="var(--destructive)" strokeWidth="1.4" />
        <path d="M8 4.6v4.2" stroke="var(--destructive)" strokeWidth="1.5" strokeLinecap="round" />
        <circle cx="8" cy="11.2" r=".85" fill="var(--destructive)" />
      </svg>
    );
  }
  if (kind === "paused") {
    return (
      <svg viewBox="0 0 16 16" style={s} role="img" aria-label={GLYPH_LABEL.paused}>
        <rect x="4.4" y="3.8" width="2.4" height="8.4" rx="1" fill="var(--muted-foreground)" />
        <rect x="9.2" y="3.8" width="2.4" height="8.4" rx="1" fill="var(--muted-foreground)" />
      </svg>
    );
  }
  return null;
}

/** A crisp ring spinner in gold: a faint track and a turning arc. */
export function Spinner({ size = 12, label = "Working" }: { size?: number; label?: string }) {
  return (
    <svg viewBox="0 0 16 16" width={size} height={size} role="img" aria-label={label} className="nav-spin shrink-0">
      <circle cx="8" cy="8" r="6" fill="none" stroke="var(--attention)" strokeOpacity=".22" strokeWidth="2" />
      <path d="M8 2a6 6 0 0 1 6 6" fill="none" stroke="var(--attention)" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

/** The small mark in front of a sub-agent chat's title. */
export function SubAgentGlyph() {
  return (
    <svg aria-hidden viewBox="0 0 12 12" className="size-[11px] shrink-0 text-muted-foreground" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round">
      <path d="M2.5 1.5v4.5a1.5 1.5 0 0 0 1.5 1.5h3" />
      <circle cx="9" cy="7.5" r="1.8" />
    </svg>
  );
}
