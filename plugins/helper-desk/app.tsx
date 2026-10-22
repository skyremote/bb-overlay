// Helper Desk — frontend. A taskbar above the composer, and a side panel with
// a Live tab (one card per running sub-agent, cleared when a batch finishes)
// and a History tab (timeline of past agent batches on this thread).
import { useCallback, useEffect, useRef, useState, type ReactElement, type RefObject } from "react";
import {
  definePluginApp,
  experimental_usePluginId,
  useBbNavigate,
  useComposer,
  useRealtime,
  useRpc,
  useSdk,
  useSettings,
} from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import type { rpcContract } from "./server";
import {
  FADE_MS,
  fmtDuration,
  fmtTokens,
  fmtWhen,
  liveVisibility,
  nextVisibilityChange,
  taskbarProgress,
  type AgentState,
  type DeskAgent,
  type DeskHistory,
  type DeskLead,
  type DeskSnapshot,
  type HistoryBatch,
  type LiveVisibility,
} from "./model";
import { z } from "zod";
import {
  cacheClockLine,
  deskLine,
  reflectLine,
  screenShareLine,
  type CacheClockStatus,
  type HubLine,
  type ReflectStatus,
  type ScreenShareStatus,
} from "./hubmodel";
import "./desk.css";

/** Agent colours, in launch order: orange, blue, green, pink, red, purple, teal, amber. */
export const PALETTE = ["#f26b21", "#2f6fe4", "#1f9d55", "#e2457a", "#d93636", "#7c4ddb", "#0e9aa7", "#d99a00"];
const colourOf = (i: number) => PALETTE[i % PALETTE.length];

// ---------- Shared per-thread UI state (module level, survives tab switches) ----------

type Tab = "live" | "history";
const autoOpened = new Map<string, string>(); // threadId -> batch key the panel auto-opened for
const userOpened = new Set<string>(); // the user opened the panel themselves
const interacted = new Set<string>(); // the user touched the panel since it auto-opened
const desiredTab = new Map<string, Tab>();
const tabListeners = new Set<(threadId: string, tab: Tab) => void>();
function requestTab(threadId: string, tab: Tab) {
  desiredTab.set(threadId, tab);
  for (const l of tabListeners) l(threadId, tab);
}

// ---------- Settings ----------

function useHideSettings() {
  const { values } = useSettings();
  const autoHide = values?.autoHide === undefined ? true : values.autoHide === true;
  const raw = Number(values?.hideDelaySeconds ?? 8);
  const delayMs = Math.min(600, Math.max(0, Number.isFinite(raw) ? raw : 8)) * 1000;
  return { autoHide, delayMs };
}

// ---------- Live data ----------

const cache = new Map<string, DeskSnapshot>();

function useDesk(threadId: string | null) {
  const rpc = useRpc<typeof rpcContract>();
  const rpcRef = useRef(rpc);
  rpcRef.current = rpc;
  const [data, setData] = useState<DeskSnapshot | null>(threadId ? cache.get(threadId) ?? null : null);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);

  const load = useCallback(async () => {
    if (!threadId || inFlight.current) return;
    inFlight.current = true;
    try {
      const next = await rpcRef.current.call("snapshot", { threadId });
      cache.set(threadId, next);
      setData(next);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      inFlight.current = false;
    }
  }, [threadId]);

  useEffect(() => {
    setData(threadId ? cache.get(threadId) ?? null : null);
    void load();
  }, [threadId, load]);

  useRealtime("desk-changed", (payload) => {
    const p = payload as { threadId?: string } | null;
    if (p?.threadId === threadId) void load();
  });

  // Sub-agent transcripts do not move the parent thread, so poll while anything runs.
  const running = !!data?.running || (data?.todos.some((t) => t.status !== "completed") ?? false);
  useEffect(() => {
    if (!threadId) return;
    const every = running ? 3000 : 15000;
    const timer = setInterval(() => {
      if (document.visibilityState !== "hidden") void load();
    }, every);
    return () => clearInterval(timer);
  }, [threadId, running, load]);

  return { data, error };
}

/** Re-render once a second while `active`, and exactly when `wakeIn` ms elapse. */
function useNow(active: boolean, wakeIn: number | null) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [active]);
  useEffect(() => {
    if (wakeIn === null) return;
    const t = setTimeout(() => setNow(Date.now()), Math.max(0, wakeIn) + 20);
    return () => clearTimeout(t);
  }, [wakeIn]);
  return now;
}

function visibilityArgs(data: DeskSnapshot | null, now: number, s: { autoHide: boolean; delayMs: number }) {
  return {
    running: !!data?.running,
    hasContent: !!data && data.agents.length > 0,
    endedAt: data?.endedAt ?? null,
    now,
    autoHide: s.autoHide,
    delayMs: s.delayMs,
  };
}

/** Pause animations when the element is off screen or the window is hidden. */
function useOnScreen(ref: RefObject<HTMLElement | null>) {
  const [inView, setInView] = useState(true);
  const [docVisible, setDocVisible] = useState(() => document.visibilityState !== "hidden");
  useEffect(() => {
    const onVis = () => setDocVisible(document.visibilityState !== "hidden");
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, []);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver((entries) => setInView(entries.some((e) => e.isIntersecting)));
    io.observe(el);
    return () => io.disconnect();
  }, [ref]);
  return inView && docVisible;
}

// ---------- Original pixel character: a little navigator bot ----------
// 12 x 11 grid: dome body, dark visor with two eyes, antenna light, stubby feet.
type BotMode = "run" | "fresh" | "still" | "slump" | "idle";
const BODY = [
  "............",
  "......a.....",
  "...######...",
  "..########..",
  ".##vvvvvv##.",
  "##vvvvvvvv##",
  "##vvvvvvvv##",
  ".##########.",
  "..########..",
];
const FEET = {
  a: [[2, 9], [3, 9], [8, 9], [9, 9], [1, 10], [2, 10], [3, 10], [8, 10], [9, 10], [10, 10]],
  b: [[1, 9], [2, 9], [3, 9], [8, 9], [9, 9], [8, 10], [9, 10], [10, 10]],
  c: [[2, 9], [3, 9], [1, 10], [2, 10], [3, 10], [8, 9], [9, 9], [10, 9]],
} as const;

function cellsFor(rows: string[], map: Record<string, string>) {
  const out: ReactElement[] = [];
  rows.forEach((row, y) =>
    [...row].forEach((c, x) => {
      const fill = map[c];
      if (fill) out.push(<rect key={`${x}-${y}`} x={x} y={y} width={1.02} height={1.02} fill={fill} />);
    }),
  );
  return out;
}

export function Bot({ colour, mode, index = 0, size = 34, label }: { colour: string; mode: BotMode; index?: number; size?: number; label?: string }) {
  const slump = mode === "slump";
  const body = slump ? "#9aa0a8" : colour;
  const style = {
    ["--hd-c" as string]: colour,
    ["--hd-d1" as string]: `${-((index * 0.23) % 0.9).toFixed(2)}s`,
    ["--hd-d2" as string]: `${-((index * 1.37) % 5).toFixed(2)}s`,
    ["--hd-d3" as string]: `${-((index * 0.53) % 1.4).toFixed(2)}s`,
  };
  const feet = (k: keyof typeof FEET, cls: string) => (
    <g className={cls} fill={body} opacity={0.8}>
      {FEET[k].map(([x, y]) => <rect key={`${x}-${y}`} x={x} y={y} width={1.02} height={1.02} />)}
    </g>
  );
  return (
    <span className={`hd-botwrap hd-mode-${mode}`} style={style} role={label ? "img" : undefined} aria-label={label} aria-hidden={label ? undefined : true}>
      {mode === "fresh" && (
        <svg className="hd-tick" viewBox="0 0 7 6" width="12" height="10" shapeRendering="crispEdges" aria-hidden="true">
          {[[6, 0], [5, 1], [4, 2], [0, 2], [1, 3], [3, 3], [2, 4]].map(([x, y]) => <rect key={`${x}-${y}`} x={x} y={y} width={1.02} height={1.02} fill="#1f9d55" />)}
        </svg>
      )}
      <svg className="hd-bot" viewBox="0 0 12 11" width={size} height={Math.round((size * 11) / 12)} shapeRendering="crispEdges">
        <g className="hd-body">
          <g className="hd-ant">
            <rect x={5} y={0} width={2.02} height={1.02} fill={slump ? "#b8bcc2" : colour} />
          </g>
          {cellsFor(BODY, { a: body, "#": body, v: "#1d2433" })}
          {slump ? (
            <g fill="#c9ced6">
              {[3, 4, 5, 6, 7, 8].map((x) => <rect key={x} x={x} y={6} width={1.02} height={0.6} />)}
            </g>
          ) : (
            <g className="hd-eyes" fill="#ffffff">
              <rect x={4} y={5} width={1.02} height={2.02} />
              <rect x={7} y={5} width={1.02} height={2.02} />
            </g>
          )}
        </g>
        {feet("a", "hd-feet hd-fa")}
        {!slump && feet("b", "hd-feet hd-fb")}
        {!slump && feet("c", "hd-feet hd-fc")}
      </svg>
    </span>
  );
}

function botModeFor(state: AgentState, fresh: boolean): BotMode {
  if (state === "running") return "run";
  if (state === "failed" || state === "interrupted") return "slump";
  return fresh ? "fresh" : "still";
}

// ---------- Original lead character: the navigator captain (navy, gold cap) ----------
// 14 x 12 grid: gold cap with a navy badge, dark brim, navy dome head with visor, gold collar, feet.
type LeadMode = "working" | "waiting" | "needs" | "still";
const LEAD_BODY = [
  "....gggggg....",
  "...gggnnggg...",
  "..gggggggggg..",
  ".kkkkkkkkkkkk.",
  "..nnnnnnnnnn..",
  ".nnvvvvvvvvnn.",
  ".nnvvvvvvvvnn.",
  "..nnnnnnnnnn..",
  "..nggggggggn..",
  "...nnnnnnnn...",
];
const LEAD_FEET = {
  a: [[3, 10], [4, 10], [9, 10], [10, 10], [2, 11], [3, 11], [4, 11], [9, 11], [10, 11], [11, 11]],
  b: [[2, 10], [3, 10], [4, 10], [9, 10], [10, 10], [9, 11], [10, 11], [11, 11]],
  c: [[3, 10], [4, 10], [2, 11], [3, 11], [4, 11], [9, 10], [10, 10], [11, 10]],
} as const;
const NAVY = "#1f2a4d";
const GOLD = "#e0a526";

export function LeadBot({ mode, size = 46 }: { mode: LeadMode; size?: number }) {
  const feet = (k: keyof typeof LEAD_FEET, cls: string) => (
    <g className={cls} fill={NAVY}>
      {LEAD_FEET[k].map(([x, y]) => <rect key={`${x}-${y}`} x={x} y={y} width={1.02} height={1.02} />)}
    </g>
  );
  return (
    <span className={`hd-botwrap hd-lead hd-lmode-${mode}`} aria-hidden="true">
      {mode === "needs" && <span className="hd-lead-alert">!</span>}
      <svg className="hd-bot" viewBox="0 0 14 12" width={size} height={Math.round((size * 12) / 14)} shapeRendering="crispEdges">
        <g className="hd-body">
          {cellsFor(LEAD_BODY, { g: GOLD, k: "#141b33", n: NAVY, v: "#0d1222" })}
          <g className="hd-badge-px" fill={NAVY}>
            <rect x={6} y={1} width={2.02} height={1.02} />
          </g>
          <g className="hd-eyes" fill="#ffffff">
            <rect x={5} y={5} width={1.02} height={2.02} />
            <rect x={8} y={5} width={1.02} height={2.02} />
          </g>
        </g>
        {feet("a", "hd-feet hd-fa")}
        {feet("b", "hd-feet hd-fb")}
        {feet("c", "hd-feet hd-fc")}
      </svg>
    </span>
  );
}

const LEAD_STATE_LABEL: Record<DeskLead["state"], string> = { working: "Working", waiting: "Waiting for you", "needs-you": "Needs you" };

function LeadCard({ lead }: { lead: DeskLead }) {
  const mode: LeadMode = lead.state === "working" ? "working" : lead.state === "needs-you" ? "needs" : "waiting";
  return (
    <article className={"hd-leadcard hd-lead-" + lead.state} aria-label={`${lead.label}, ${LEAD_STATE_LABEL[lead.state]}`}>
      <LeadBot mode={mode} />
      <div className="hd-card-body">
        <div className="hd-card-top">
          <strong className="hd-name">{lead.label} · {lead.model}</strong>
          <span className={"hd-lead-chip hd-lead-chip-" + lead.state}>{LEAD_STATE_LABEL[lead.state]}</span>
        </div>
        <div className="hd-lead-activity">
          {lead.state === "working" && <span className="hd-spin hd-spin-navy" aria-hidden="true" />}
          {lead.activity}
        </div>
      </div>
      <div className="hd-lead-stats">
        {lead.contextUsed !== null && (
          <span title="Context used">
            {fmtTokens(lead.contextUsed)}
            {lead.contextPct !== null ? ` · ${lead.contextPct}%` : ""}
          </span>
        )}
        {lead.costUsd !== null && <span title="Session cost">{money(lead.costUsd, "USD", lead.costEstimated)}</span>}
      </div>
    </article>
  );
}

// ---------- Agent tree with connector lines ----------

type TreeAgent = { id: string; parentId: string | null; colour: number; state: AgentState };

function AgentTree<T extends TreeAgent>({ agents, render, pulse }: { agents: T[]; render: (a: T) => ReactElement; pulse?: (a: T) => "launch" | "loop" | "return" | null }) {
  const ids = new Set(agents.map((a) => a.id));
  const roots = agents.filter((a) => !a.parentId || !ids.has(a.parentId));
  const branch = (a: T, depth: number): ReactElement => {
    const kids = depth < 4 ? agents.filter((c) => c.parentId === a.id && c.id !== a.id) : [];
    const p = pulse?.(a) ?? null;
    return (
      <div className="hd-branch" key={a.id} style={{ ["--hd-c" as string]: colourOf(a.colour), ["--hd-pd" as string]: `${-((a.colour * 0.7) % 2.4).toFixed(2)}s` }}>
        <div className="hd-row">
          <span className="hd-elbow" aria-hidden="true" />
          {p === "launch" && <span className="hd-pulse hd-pulse-launch" aria-hidden="true" />}
          {(p === "launch" || p === "loop") && <span className="hd-pulse hd-pulse-loop" aria-hidden="true" />}
          {p === "return" && <span className="hd-pulse hd-pulse-return" aria-hidden="true" />}
          {render(a)}
        </div>
        {kids.length > 0 && <div className="hd-subtree">{kids.map((k) => branch(k, depth + 1))}</div>}
      </div>
    );
  };
  return <div className="hd-tree">{roots.map((r) => branch(r, 0))}</div>;
}

// When this window first saw an agent in a state. Pulses and the hop key off this,
// not the server time, so a client that hears about a change a little late still plays it.
const firstSeen = new Map<string, number>();
function seenFor(id: string, state: string, serverAt: number | null): number {
  const key = `${id}:${state}`;
  let t = firstSeen.get(key);
  if (t === undefined) {
    // Something that happened long before we looked is not "new".
    t = serverAt !== null && Date.now() - serverAt > 30_000 ? 0 : Date.now();
    firstSeen.set(key, t);
  }
  return t;
}

// ---------- Live tab ----------

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <div className="hd-tile">
      <span>{label}</span>
      <strong className="hd-accent">{value}</strong>
    </div>
  );
}

function AgentCard({ agent, now, freshMs }: { agent: DeskAgent; now: number; freshMs: number }) {
  const colour = colourOf(agent.colour);
  const elapsed = (agent.finishedAt ?? now) - agent.startedAt;
  const done = agent.state === "finished";
  const seen = agent.state === "finished" ? seenFor(agent.id, "finished", agent.finishedAt) : 0;
  const fresh = seen > 0 && Math.max(now, Date.now()) - seen < freshMs;
  return (
    <article className={"hd-card hd-" + agent.state} style={{ ["--hd-c" as string]: colour }}>
      <Bot colour={colour} mode={botModeFor(agent.state, fresh)} index={agent.colour} />
      <div className="hd-card-body">
        <div className="hd-card-top">
          <strong className="hd-name" title={agent.name}>{agent.name}</strong>
          <span className="hd-meta">
            {agent.tokens > 0 ? `${fmtTokens(agent.tokens)} tokens · ` : ""}
            {fmtDuration(elapsed)}
          </span>
          {done ? <span className="hd-check" aria-label="Finished">&#10003;</span> : agent.state !== "running" ? <span className="hd-fail" aria-label={agent.state === "failed" ? "Failed" : "Interrupted"}>!</span> : <span className="hd-dot" aria-label="Running" />}
        </div>
        <div className="hd-sub">{agent.agentType} · {agent.model}</div>
        <div className={done ? "hd-step hd-step-done" : agent.state === "running" ? "hd-step" : "hd-step hd-step-bad"}>
          {agent.state === "running" && <span className="hd-spin" aria-hidden="true" />}
          {agent.stepLabel}
        </div>
        {agent.details.map((d, i) => (
          <div className="hd-detail" key={i}>{d}</div>
        ))}
        <div className="hd-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(agent.progress * 100)}>
          <i style={{ width: `${Math.round(agent.progress * 100)}%` }} />
        </div>
      </div>
    </article>
  );
}

function money(amount: number | null | undefined, currency = "USD", estimated = true): string {
  if (amount === null || amount === undefined) return "—";
  const sym = currency === "USD" ? "$" : currency === "EUR" ? "€" : currency === "GBP" ? "£" : currency + " ";
  return `${sym}${amount.toFixed(2)}${estimated ? " est." : ""}`;
}

function LiveTab({ threadId, data, error, visibility, now, delayMs, onHistory }: { threadId: string; data: DeskSnapshot | null; error: string | null; visibility: LiveVisibility; now: number; delayMs: number; onHistory: () => void }) {
  useDoneToasts(data);
  if (!data) return <p className="hd-empty">{error ? `Could not load: ${error}` : "Loading Helper Desk…"}</p>;
  const showAgents = visibility === "live" || visibility === "fading";
  const running = data.agents.filter((a) => a.state === "running");
  const finished = data.agents.filter((a) => a.state !== "running");
  const time = data.startedAt ? fmtDuration((data.endedAt ?? now) - data.startedAt) : "0:00";
  const pulse = (a: DeskAgent) => {
    const t = Date.now();
    if (a.state === "running") {
      const seen = seenFor(a.id, "running", a.startedAt);
      return seen > 0 && t - seen < 1600 ? "launch" : "loop";
    }
    if (a.state === "finished") {
      const seen = seenFor(a.id, "finished", a.finishedAt);
      return seen > 0 && t - seen < 1500 ? "return" : null;
    }
    return null;
  };
  return (
    <div className="hd-live-wrap" data-thread={threadId}>
      <LeadCard lead={data.lead} />
      {showAgents && data.agents.length > 0 ? (
        <div className={visibility === "fading" ? "hd-live hd-leaving" : "hd-live"}>
          <AgentTree agents={data.agents} pulse={pulse} render={(a) => <AgentCard agent={a} now={now} freshMs={a.state === "running" ? delayMs : Math.min(delayMs, 4000)} />} />
          <div className="hd-chips">
            {running.length > 0 && <span className="hd-section-run">Running · {running.length}</span>}
            {finished.length > 0 && <span className="hd-section-done">Finished · {finished.length}</span>}
          </div>
          <div className="hd-tiles">
            <Tile label="Subagent tokens" value={fmtTokens(data.subagentTokens)} />
            <Tile label="Time" value={time} />
            <Tile label="Total chat cost" value={data.cost ? money(data.cost.amount, data.cost.currency, data.cost.estimated) : "—"} />
          </div>
          <p className="hd-foot">Tokens are each sub-agent's latest context size. Cost is the API-equivalent estimate unless bb reports a real figure. Progress assumes about eight steps until an agent reports back.</p>
        </div>
      ) : (
        <div className="hd-tree hd-tree-idle">
          <div className="hd-branch hd-branch-idle">
            <div className="hd-row">
              <span className="hd-elbow" aria-hidden="true" />
              <div className="hd-idle-row" role="status">
                No agents running · <button type="button" className="hd-link" onClick={onHistory}>View history</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------- History tab ----------

function useHistory(threadId: string, active: boolean, batchKey: string | undefined) {
  const rpc = useRpc<typeof rpcContract>();
  const rpcRef = useRef(rpc);
  rpcRef.current = rpc;
  const [data, setData] = useState<DeskHistory | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    try {
      setData(await rpcRef.current.call("history", { threadId }));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [threadId]);
  useEffect(() => {
    if (active) void load();
  }, [active, load, batchKey]);
  useRealtime("desk-changed", (payload) => {
    const p = payload as { threadId?: string } | null;
    if (active && p?.threadId === threadId) void load();
  });
  return { data, error };
}

const STATE_LABEL: Record<AgentState, string> = { running: "Running", finished: "Finished", failed: "Failed", interrupted: "Interrupted" };

function HistoryAgent({ agent }: { agent: HistoryBatch["agents"][number] }) {
  const [more, setMore] = useState(false);
  const colour = colourOf(agent.colour);
  const long = agent.summary.length > 220;
  return (
    <div className={"hd-hcard hd-" + agent.state} style={{ ["--hd-c" as string]: colour }}>
      <Bot colour={colour} mode={agent.state === "failed" || agent.state === "interrupted" ? "slump" : agent.state === "running" ? "run" : "idle"} index={agent.colour} size={24} />
      <div className="hd-card-body">
        <div className="hd-card-top">
          <strong className="hd-name" title={agent.name}>{agent.name}</strong>
          <span className={"hd-badge hd-badge-" + agent.state}>{STATE_LABEL[agent.state]}</span>
        </div>
        <div className="hd-sub">{agent.agentType} · {agent.model}</div>
        <div className="hd-sub">
          {agent.tokens > 0 ? `${fmtTokens(agent.tokens)} tokens · ` : ""}
          {fmtDuration(agent.durationMs)} · {agent.steps} {agent.steps === 1 ? "step" : "steps"}
        </div>
        {agent.summary && (
          <p className="hd-summary">
            {more || !long ? agent.summary : agent.summary.slice(0, 220).trimEnd() + "…"}
            {long && (
              <button type="button" className="hd-link hd-more" onClick={() => setMore(!more)}>
                {more ? "Show less" : "Show more"}
              </button>
            )}
          </p>
        )}
      </div>
    </div>
  );
}

function HistoryNode({ batch, now, defaultOpen, lead }: { batch: HistoryBatch; now: number; defaultOpen: boolean; lead: { label: string; model: string } }) {
  const [open, setOpen] = useState(defaultOpen);
  const bad = batch.agents.some((a) => a.state === "failed" || a.state === "interrupted");
  const t = batch.totals;
  return (
    <li className={"hd-node" + (batch.running ? " hd-node-run" : bad ? " hd-node-bad" : "")}>
      <span className="hd-node-dot" aria-hidden="true" />
      <button type="button" className="hd-node-head" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span className="hd-node-when">{fmtWhen(batch.startedAt, now)}{batch.running ? " · running" : ""}</span>
        <span className="hd-node-req" title={batch.request}>{batch.request}</span>
        <span className="hd-node-totals">
          {t.agents} {t.agents === 1 ? "agent" : "agents"} · {fmtTokens(t.tokens)} tokens · {fmtDuration(t.durationMs)}
          {t.costUsd !== null ? ` · ${money(t.costUsd)}` : ""}
        </span>
        <span className={"hd-chev" + (open ? " hd-chev-open" : "")} aria-hidden="true">&#8250;</span>
      </button>
      {open && (
        <div className="hd-node-agents">
          <div className="hd-hlead">
            <LeadBot mode="still" size={26} />
            <span className="hd-hlead-text" title={batch.request}><strong>{lead.label} · {lead.model}</strong> · {batch.request}</span>
          </div>
          <AgentTree agents={batch.agents} render={(a) => <HistoryAgent agent={a} />} />
        </div>
      )}
    </li>
  );
}

function HistoryTab({ threadId, active, batchKey }: { threadId: string; active: boolean; batchKey: string | undefined }) {
  const { data, error } = useHistory(threadId, active, batchKey);
  const now = Date.now();
  if (!data) return <p className="hd-empty">{error ? `Could not load history: ${error}` : "Loading history…"}</p>;
  if (data.batches.length === 0) return <p className="hd-empty">No agent runs on this thread yet.</p>;
  return (
    <div className="hd-history">
      <h3 className="hd-title">{data.batches.length} agent {data.batches.length === 1 ? "run" : "runs"} on this thread</h3>
      <ol className="hd-tl">
        {data.batches.map((b, i) => <HistoryNode key={b.key} batch={b} now={now} lead={data.lead} defaultOpen={i === 0 && data.batches.length === 1} />)}
      </ol>
    </div>
  );
}

// ---------- Panel ----------

export function DeskPanel({ threadId }: { threadId: string }) {
  const settings = useHideSettings();
  const { data, error } = useDesk(threadId);
  const [tab, setTab] = useState<Tab>(() => desiredTab.get(threadId) ?? "live");
  const rootRef = useRef<HTMLDivElement>(null);
  const onScreen = useOnScreen(rootRef);
  useEffect(() => {
    const l = (id: string, t: Tab) => {
      if (id === threadId) setTab(t);
    };
    tabListeners.add(l);
    const wanted = desiredTab.get(threadId);
    if (wanted) setTab(wanted);
    return () => {
      tabListeners.delete(l);
    };
  }, [threadId]);
  const pre = visibilityArgs(data, Date.now(), settings);
  const now = useNow(!!data?.running && tab === "live" && onScreen, nextVisibilityChange(pre));
  const visibility = liveVisibility(visibilityArgs(data, now, settings));
  const choose = (t: Tab) => {
    desiredTab.set(threadId, t);
    setTab(t);
  };
  const mark = () => interacted.add(threadId);
  return (
    <div ref={rootRef} className={"hd-root" + (onScreen ? "" : " hd-paused")} onPointerDown={mark} onKeyDown={mark} onWheel={mark}>
      <div className="hd-tabs" role="tablist" aria-label="Helper Desk view">
        <button type="button" role="tab" aria-selected={tab === "live"} onClick={() => choose("live")}>
          Live{data?.running ? <span className="hd-tab-count">{data.agents.filter((a) => a.state === "running").length}</span> : null}
        </button>
        <button type="button" role="tab" aria-selected={tab === "history"} onClick={() => choose("history")}>History</button>
      </div>
      {tab === "live" ? (
        <LiveTab threadId={threadId} data={data} error={error} visibility={visibility} now={now} delayMs={settings.delayMs} onHistory={() => choose("history")} />
      ) : (
        <HistoryTab threadId={threadId} active={tab === "history"} batchKey={data?.turnKey} />
      )}
    </div>
  );
}

// ---------- Toasts: "Done: <agent>" ----------

const announced = new Set<string>();
const seededThreads = new Set<string>();
function useDoneToasts(data: DeskSnapshot | null) {
  useEffect(() => {
    if (!data) return;
    if (!seededThreads.has(data.threadId)) {
      // Do not toast agents that had already finished before we were watching.
      for (const a of data.agents) if (a.state !== "running") announced.add(a.id);
      seededThreads.add(data.threadId);
      return;
    }
    for (const a of data.agents) {
      if (a.state === "running" || announced.has(a.id)) continue;
      announced.add(a.id);
      if (a.state === "finished") toast.success(`Done: ${a.name}`);
      else toast.error(`${a.state === "failed" ? "Failed" : "Interrupted"}: ${a.name}`);
    }
  }, [data]);
}

// ---------- Panel auto-open and auto-close ----------

async function closeDeskTab(sdk: ReturnType<typeof useSdk>, threadId: string, pluginId: string) {
  try {
    const current = await sdk.threads.tabs.get({ threadId });
    const tabs = current.tabs.filter((t) => !(t.kind === "plugin-panel" && "pluginId" in t && t.pluginId === pluginId && "actionId" in t && t.actionId === "desk"));
    if (tabs.length === current.tabs.length) return;
    await sdk.threads.tabs.update({ threadId, expectedRevision: current.revision, tabs: tabs as Parameters<typeof sdk.threads.tabs.update>[0]["tabs"] });
  } catch {
    // Another window changed the tabs, or the API refused: leave the panel as it is.
  }
}

function useAutoPanel(threadId: string | null, data: DeskSnapshot | null, visibility: LiveVisibility) {
  const nav = useBbNavigate();
  const sdk = useSdk();
  const pluginId = experimental_usePluginId();
  useEffect(() => {
    if (!threadId || !data) return;
    if (data.running && autoOpened.get(threadId) !== data.turnKey && !seenBatches.has(data.turnKey)) {
      seenBatches.add(data.turnKey);
      autoOpened.set(threadId, data.turnKey);
      interacted.delete(threadId);
      desiredTab.set(threadId, "live");
      for (const l of tabListeners) l(threadId, "live");
      nav.openThreadPanel({ actionId: "desk", title: "Helper Desk" });
    }
    if (visibility === "hidden" && autoOpened.get(threadId) === data.turnKey) {
      autoOpened.delete(threadId);
      if (!interacted.has(threadId) && !userOpened.has(threadId)) void closeDeskTab(sdk, threadId, pluginId);
    }
  }, [threadId, data, visibility, nav, sdk, pluginId]);
}
const seenBatches = new Set<string>();

// ---------- Composer taskbar ----------

const dismissed = new Set<string>();

function Taskbar() {
  const composer = useComposer();
  const threadId = composer.scope.kind === "thread" ? composer.scope.threadId : null;
  const settings = useHideSettings();
  const { data } = useDesk(threadId);
  const [, force] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const onScreen = useOnScreen(ref);
  const p = data ? taskbarProgress(data) : null;
  const usingTodos = p?.label === "Tasks";
  const args = {
    running: usingTodos ? (data?.todos.some((t) => t.status !== "completed") ?? false) : !!data?.running,
    hasContent: !!p,
    endedAt: usingTodos ? data?.todosUpdatedAt ?? null : data?.endedAt ?? null,
    now: Date.now(),
    autoHide: settings.autoHide,
    delayMs: settings.delayMs,
  };
  const now = useNow(false, nextVisibilityChange(args));
  const barVis = liveVisibility({ ...args, now });
  const panelVis = liveVisibility(visibilityArgs(data, now, settings));
  useAutoPanel(threadId, data, panelVis);
  useDoneToasts(data);
  if (!threadId || !data || !p || barVis === "hidden" || barVis === "empty") return null;
  const key = `${threadId}:${p.key}`;
  if (dismissed.has(key)) return null;
  const allDone = p.done === p.total;
  return (
    <div ref={ref} className={"hd-taskbar" + (barVis === "fading" ? " hd-tb-leaving" : "") + (onScreen ? "" : " hd-paused")} role="status" aria-label={`${p.label} ${p.done} of ${p.total}`}>
      <div className="hd-tb-row">
        <span className={"hd-tb-dot" + (allDone ? " hd-tb-dot-done" : "")} aria-hidden="true" />
        <strong className="hd-tb-title" title={data.title}>{data.title}</strong>
        <div className="hd-tb-trackwrap">
          <div className="hd-tb-track">
            <i style={{ width: `${Math.max(p.pct, 2)}%` }} />
            <span className="hd-tb-pill">{p.label} {p.done}/{p.total}</span>
            {Array.from({ length: Math.max(0, p.total - 1) }, (_, i) => (
              <b key={i} style={{ left: `${((i + 1) / p.total) * 100}%` }} />
            ))}
          </div>
          <span className="hd-walker" style={{ left: `${Math.max(p.pct, 2)}%` }}>
            <Bot colour="#ffffff" mode={allDone ? "still" : "run"} size={15} />
          </span>
        </div>
        <span className="hd-tb-pct">{p.pct}%</span>
        <button
          type="button"
          className="hd-tb-close"
          aria-label="Hide the taskbar for this run"
          onClick={() => {
            dismissed.add(key);
            force((n) => n + 1);
          }}
        >
          &#215;
        </button>
      </div>
      <div className="hd-tb-now">{allDone ? (usingTodos ? "All tasks done" : "All sub-agents finished") : `Now: ${p.now ?? ""}`}</div>
    </div>
  );
}

// ---------- Header button ----------

function HeaderButton({ threadId, isCompactViewport }: { threadId: string; isCompactViewport: boolean }) {
  const nav = useBbNavigate();
  const { data } = useDesk(threadId);
  const count = data?.agents.filter((a) => a.state === "running").length ?? 0;
  const lead = data?.lead;
  const mode: LeadMode = lead?.state === "working" ? "working" : lead?.state === "needs-you" ? "needs" : "waiting";
  return (
    <button
      type="button"
      className="hd-header-button"
      aria-label={count > 0 ? `Open Helper Desk, ${count} agents running` : "Open Helper Desk history"}
      title={count > 0 ? "Helper Desk: live agents" : "Helper Desk: agent history"}
      onClick={() => {
        userOpened.add(threadId);
        requestTab(threadId, count > 0 ? "live" : "history");
        nav.openThreadPanel({ actionId: "desk", title: "Helper Desk" });
      }}
    >
      <LeadBot mode={mode} size={18} />
      {count > 0 && <span className="hd-hb-count">{count}</span>}
      {!isCompactViewport && <span>{count > 0 ? `${count} running` : "Helper Desk"}</span>}
    </button>
  );
}

// ---------- Mods hub tab ----------

const hubSchemas = {
  screen: z.object({ enabled: z.boolean() }).passthrough(),
  clock: z
    .object({
      supported: z.boolean(),
      running: z.boolean(),
      lastReplyAt: z.number().nullable(),
      expiresAt: z.number().nullable(),
      now: z.number(),
      keepWarm: z.object({ enabled: z.boolean() }).passthrough().nullable(),
    })
    .passthrough(),
  reflect: z.object({ today: z.number(), total: z.number() }).passthrough(),
  ok: z.object({ ok: z.boolean() }),
};

function hubWindowId(): string {
  const w = window as unknown as { __nbmWindowId?: string };
  if (!w.__nbmWindowId) w.__nbmWindowId = Math.random().toString(36).slice(2) + Date.now().toString(36);
  return w.__nbmWindowId;
}

function ModGlyph({ kind }: { kind: "screen" | "clock" | "reflect" }) {
  if (kind === "screen")
    return (
      <svg viewBox="0 0 20 20" aria-hidden="true"><rect x="2" y="4" width="16" height="10" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.5" /><rect x="5" y="7" width="6" height="1.8" fill="currentColor" opacity=".5" /><rect x="5" y="10" width="9" height="1.8" fill="currentColor" opacity=".5" /><path d="M7 17h6" stroke="currentColor" strokeWidth="1.5" /></svg>
    );
  if (kind === "clock")
    return (
      <svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="7" fill="none" stroke="currentColor" strokeWidth="1.5" /><path d="M10 6v4l2.6 1.7" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
    );
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M5 3h10v14l-5-3.2L5 17z" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" /><path d="M7.5 8.5l1.8 1.8 3.4-3.6" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
  );
}

function ModsHub({ threadId }: { threadId: string }) {
  const sdk = useSdk();
  const nav = useBbNavigate();
  const { data } = useDesk(threadId);
  const [screen, setScreen] = useState<ScreenShareStatus | null>(null);
  const [clock, setClock] = useState<{ s: CacheClockStatus; offset: number } | null>(null);
  const [reflect, setReflect] = useState<ReflectStatus | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [, tick] = useState(0);

  const load = useCallback(() => {
    sdk.plugins
      .callRpc({ pluginId: "screen-share", method: "state_get", input: null, outputSchema: hubSchemas.screen })
      .then((r) => setScreen({ enabled: r.enabled }), () => setScreen(null));
    sdk.plugins
      .callRpc({ pluginId: "cache-clock", method: "status", input: { threadId }, outputSchema: hubSchemas.clock })
      .then((r) => setClock({ s: r, offset: r.now - Date.now() }), () => setClock(null));
    sdk.plugins
      .callRpc({ pluginId: "reflect", method: "saved", input: { limit: 1 }, outputSchema: hubSchemas.reflect })
      .then((r) => setReflect({ today: r.today, total: r.total }), () => setReflect(null));
  }, [sdk, threadId]);

  useEffect(() => {
    load();
    const slow = setInterval(load, 15_000);
    const fast = setInterval(() => tick((n) => n + 1), 1000);
    return () => {
      clearInterval(slow);
      clearInterval(fast);
    };
  }, [load]);

  const open = async (pluginId: string, label: string) => {
    setNote(null);
    try {
      await sdk.plugins.callRpc({
        pluginId,
        method: "open_panel",
        input: { threadId, windowId: hubWindowId() },
        outputSchema: hubSchemas.ok,
      });
    } catch {
      setNote(`Could not reach ${label}. Open it from the + in this panel, under Actions.`);
    }
  };
  const flipScreen = async () => {
    try {
      const r = await sdk.plugins.callRpc({
        pluginId: "screen-share",
        method: "state_set",
        input: { enabled: !(screen?.enabled ?? false), source: "hub" },
        outputSchema: hubSchemas.screen,
      });
      setScreen({ enabled: r.enabled });
    } catch {
      setNote("Screen share is not installed or is switched off.");
    }
  };

  const running = data?.agents.filter((a) => a.state === "running").length ?? 0;
  const leadMode: LeadMode = data?.lead?.state === "working" ? "working" : data?.lead?.state === "needs-you" ? "needs" : "waiting";
  const rows: { key: string; name: string; line: HubLine; glyph: ReactElement; onOpen: () => void; extra?: ReactElement }[] = [
    {
      key: "desk",
      name: "Helper Desk",
      line: deskLine(running, data?.lead?.state === "working"),
      glyph: <LeadBot mode={leadMode} size={26} />,
      onOpen: () => {
        userOpened.add(threadId);
        requestTab(threadId, running > 0 ? "live" : "history");
        nav.openThreadPanel({ actionId: "desk", title: "Helper Desk" });
      },
    },
    {
      key: "screen",
      name: "Screen share",
      line: screenShareLine(screen),
      glyph: <ModGlyph kind="screen" />,
      onOpen: () => void open("screen-share", "Screen share"),
      extra: screen ? (
        <button
          type="button"
          role="switch"
          aria-checked={screen.enabled}
          aria-label="Screen-share mode"
          className={"hd-hub-switch" + (screen.enabled ? " hd-hub-switch-on" : "")}
          onClick={() => void flipScreen()}
        >
          <i />
        </button>
      ) : undefined,
    },
    {
      key: "clock",
      name: "Cache clock",
      line: cacheClockLine(clock?.s ?? null, Date.now(), clock?.offset ?? 0),
      glyph: <ModGlyph kind="clock" />,
      onOpen: () => void open("cache-clock", "Cache clock"),
    },
    {
      key: "reflect",
      name: "Reflect",
      line: reflectLine(reflect),
      glyph: <ModGlyph kind="reflect" />,
      onOpen: () => void open("reflect", "Reflect"),
    },
  ];

  return (
    <div className="hd-hub">
      <p className="hd-hub-intro">Your mods for this thread. Open one to see its full tab.</p>
      {rows.map((r) => (
        <div key={r.key} className={"hd-hub-row hd-hub-" + r.line.tone}>
          <span className="hd-hub-glyph">{r.glyph}</span>
          <span className="hd-hub-text">
            <strong>{r.name}</strong>
            <span className="hd-hub-line">
              <i className="hd-hub-dot" aria-hidden="true" />
              {r.line.text}
            </span>
          </span>
          {r.extra}
          <button type="button" className="hd-hub-open" disabled={r.line.tone === "missing"} onClick={r.onOpen}>
            Open
          </button>
        </div>
      ))}
      {note && <p className="hd-hub-note">{note}</p>}
      <p className="hd-hub-foot">Switch a whole mod off with bb plugins disable, then its id.</p>
    </div>
  );
}

export default definePluginApp((app) => {
  app.slots.threadPanelAction({
    id: "desk",
    title: "Helper Desk",
    icon: "Bot",
    layout: "flush",
    component: ({ threadId }) => <DeskPanel threadId={threadId} />,
    run: ({ threadId, openPanel }) => {
      userOpened.add(threadId);
      openPanel({ title: "Helper Desk" });
    },
  });
  app.slots.threadPanelAction({
    id: "mods",
    title: "Mods",
    icon: "LayoutGrid",
    layout: "padded",
    component: ({ threadId }) => <ModsHub threadId={threadId} />,
  });
  app.slots.experimental_threadHeaderAction({ id: "desk-open", title: "Helper Desk", component: HeaderButton });
  app.composer.customize({
    id: "helper-desk",
    scopes: ["thread"],
    banners: [{ id: "taskbar", chrome: "bare", component: Taskbar }],
  });
});

export { FADE_MS };
