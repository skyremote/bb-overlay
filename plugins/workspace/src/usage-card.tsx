// Usage card: hover (or focus and press Enter on) the usage line under the chat
// box for every subscription's windows over time, a forecast to each reset,
// burn rate, time to limit and the chats that used the most. The data comes
// from the plugin's own sampler (server-usage-trend.ts); this file only draws.
//
// Charts are inline SVG. Motion is CSS only (transform, opacity and
// stroke-dashoffset) and switches off under prefers-reduced-motion.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { useBbNavigate, useRpc } from "@get-bb/plugin-sdk/app";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { rpcContract } from "../server";
import type { Trend, TrendAccount, TrendWindow } from "../server-usage-trend";

const GOLD = "var(--attention)";
const PLUM = "var(--pr-merged)";
const ROSE = "var(--destructive-text)";
const MUTED = "var(--input)";
const MIN = 60_000;
const HOUR = 60 * MIN;

const STYLE = `
.nuc-card[data-state=open]{animation:nuc-in 160ms cubic-bezier(.16,1,.3,1) both;transform-origin:var(--radix-hover-card-content-transform-origin)}
.nuc-card[data-state=closed]{animation:nuc-out 100ms ease-in both;transform-origin:var(--radix-hover-card-content-transform-origin)}
@keyframes nuc-in{from{opacity:0;transform:translateY(4px) scale(.96)}to{opacity:1;transform:none}}
@keyframes nuc-out{from{opacity:1;transform:none}to{opacity:0;transform:translateY(2px) scale(.98)}}
.nuc-draw{stroke-dasharray:1;stroke-dashoffset:0;animation:nuc-draw 450ms cubic-bezier(.3,.7,.2,1) both}
@keyframes nuc-draw{from{stroke-dashoffset:1}to{stroke-dashoffset:0}}
.nuc-after{animation:nuc-fade 220ms ease-out 400ms both}
@keyframes nuc-fade{from{opacity:0}to{opacity:1}}
.nuc-grow{transform-origin:left center;animation:nuc-grow 450ms cubic-bezier(.2,.8,.2,1) both}
@keyframes nuc-grow{from{transform:scaleX(0)}to{transform:scaleX(1)}}
.nuc-xin{animation:nuc-xin 180ms ease-out both}
.nuc-xout{animation:nuc-xout 140ms ease-in both}
@keyframes nuc-xin{from{opacity:0;transform:translateY(2px)}to{opacity:1;transform:none}}
@keyframes nuc-xout{from{opacity:1}to{opacity:0}}
.nuc-ind{transform-origin:left center;transition:transform 220ms cubic-bezier(.2,.8,.2,1)}
.nuc-pulse{position:absolute;inset:0;border-radius:6px;border:1px solid var(--destructive-text);opacity:0;pointer-events:none;animation:nuc-pulse 1100ms ease-out 450ms 1 both}
@keyframes nuc-pulse{0%{opacity:.7;transform:scale(1)}100%{opacity:0;transform:scale(1.04,1.25)}}
@media (prefers-reduced-motion: reduce){
  .nuc-card,.nuc-card *{animation:none!important;transition:none!important}
}
`;

const reducedMotion = () => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

function useCountUp(target: number, ms = 500): number {
  const [v, setV] = useState(() => (reducedMotion() ? target : 0));
  const from = useRef(reducedMotion() ? target : 0);
  useEffect(() => {
    if (reducedMotion()) {
      setV(target);
      from.current = target;
      return;
    }
    const start = performance.now();
    const a = from.current;
    let raf = 0;
    const step = (now: number) => {
      const k = Math.min(1, (now - start) / ms);
      const e = 1 - (1 - k) ** 3;
      setV(a + (target - a) * e);
      if (k < 1) raf = requestAnimationFrame(step);
      else from.current = target;
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target, ms]);
  return v;
}

// ---------- Formatting (British English, 24-hour clock) ----------
const clock = (t: number) => new Date(t).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
const dayClock = (t: number) => {
  const d = new Date(t);
  const sameDay = new Date().toDateString() === d.toDateString();
  return sameDay ? clock(t) : `${d.toLocaleDateString("en-GB", { weekday: "short" })} ${clock(t)}`;
};
function dur(ms: number): string {
  const m = Math.max(0, Math.round(ms / MIN));
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h ${String(m % 60).padStart(2, "0")}m`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
}
const pct = (p: number) => `${Math.round(p)}%`;
const tone = (p: number) => (p >= 90 ? ROSE : p >= 75 ? "var(--warning-text)" : GOLD);
const harnessName = (h: TrendAccount["harness"]) => (h === "claude" ? "Claude" : h === "codex" ? "ChatGPT" : "Cursor");

function tabLabel(a: TrendAccount, all: TrendAccount[]): string {
  const name = harnessName(a.harness);
  if (all.filter((x) => x.harness === a.harness).length < 2) return name;
  const local = (a.email ?? "").split("@")[0];
  return `${name} · ${local.length > 10 ? `${local.slice(0, 9)}…` : local}`;
}

// ---------- Charts ----------
/** forecast: the dotted continuation from the last reading (to the limit, then flat to the reset). */
type Line = { pts: Array<[number, number]>; color: string; label: string; forecast: Array<[number, number]> | null };

function Chart({ t0, t1, now, lines, ticks, tipTime, height = 92 }: { t0: number; t1: number; now: number; lines: Line[]; ticks: Array<{ t: number; label: string }>; tipTime: (t: number) => string; height?: number }) {
  const W = 360;
  const H = height;
  const L = 4;
  const R = 22;
  const T = 6;
  const B = 16;
  const x = (t: number) => L + ((t - t0) / Math.max(1, t1 - t0)) * (W - L - R);
  const y = (p: number) => T + (1 - Math.max(0, Math.min(100, p)) / 100) * (H - T - B);
  const [hover, setHover] = useState<{ x: number; y: number; t: number; p: number; label: string; color: string } | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return;
    const px = ((e.clientX - rect.left) / rect.width) * W;
    const py = ((e.clientY - rect.top) / rect.height) * H;
    let best: typeof hover = null;
    let bestD = Infinity;
    for (const l of lines)
      for (const [t, p] of l.pts) {
        const d = Math.abs(x(t) - px) + Math.abs(y(p) - py) * 0.35;
        if (d < bestD) {
          bestD = d;
          best = { x: x(t), y: y(p), t, p, label: l.label, color: l.color };
        }
      }
    setHover(bestD < 40 ? best : null);
  };

  const path = (pts: Array<[number, number]>) => pts.map(([t, p], i) => `${i ? "L" : "M"}${x(t).toFixed(1)} ${y(p).toFixed(1)}`).join(" ");
  const nowX = x(Math.min(now, t1));

  return (
    <div className="relative">
      <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} width="100%" height={H} className="block overflow-visible" onPointerMove={onMove} onPointerLeave={() => setHover(null)} role="img" aria-label={lines.map((l) => `${l.label} ${l.pts.length ? pct(l.pts[l.pts.length - 1][1]) : "no readings"}`).join(", ")}>
        {/* grid and reference lines */}
        <line x1={L} x2={W - R} y1={y(0)} y2={y(0)} stroke="var(--border)" strokeWidth={1} />
        <line x1={L} x2={W - R} y1={y(75)} y2={y(75)} stroke={MUTED} strokeWidth={1} strokeDasharray="3 3" />
        <line x1={L} x2={W - R} y1={y(90)} y2={y(90)} stroke={ROSE} strokeOpacity={0.7} strokeWidth={1} strokeDasharray="3 3" />
        <text x={W - R + 4} y={y(75) + 3} fontSize={9} fill="var(--muted-foreground)">75</text>
        <text x={W - R + 4} y={y(90) + 3} fontSize={9} fill={ROSE}>90</text>
        {ticks.map((k) => (
          <g key={k.t}>
            <line x1={x(k.t)} x2={x(k.t)} y1={T} y2={y(0)} stroke="var(--border)" strokeOpacity={0.5} strokeWidth={1} />
            <text x={x(k.t)} y={H - 3} fontSize={9} fill="var(--muted-foreground)" textAnchor={x(k.t) < 20 ? "start" : x(k.t) > W - R - 20 ? "end" : "middle"}>
              {k.label}
            </text>
          </g>
        ))}
        {now < t1 && <line x1={nowX} x2={nowX} y1={T} y2={y(0)} stroke="var(--foreground)" strokeOpacity={0.25} strokeWidth={1} />}
        {lines.map((l, i) =>
          l.pts.length > 1 ? (
            <g key={l.label}>
              <path d={`${path(l.pts)} L${x(l.pts[l.pts.length - 1][0]).toFixed(1)} ${y(0)} L${x(l.pts[0][0]).toFixed(1)} ${y(0)} Z`} fill={l.color} fillOpacity={i === 0 ? 0.08 : 0.04} className="nuc-after" />
              <path d={path(l.pts)} pathLength={1} fill="none" stroke={l.color} strokeWidth={i === 0 ? 1.75 : 1.4} strokeLinejoin="round" strokeLinecap="round" className="nuc-draw" />
            </g>
          ) : null,
        )}
        {lines.map((l) => {
          const last = l.pts[l.pts.length - 1];
          if (!last) return null;
          return (
            <g key={`${l.label}-f`} className="nuc-after">
              {l.forecast && <path d={path([last, ...l.forecast])} fill="none" stroke={l.color} strokeWidth={1.5} strokeDasharray="1.5 3" strokeLinecap="round" strokeLinejoin="round" />}
              <circle cx={x(last[0])} cy={y(last[1])} r={2.6} fill={l.color} />
            </g>
          );
        })}
        {hover && (
          <g pointerEvents="none">
            <line x1={hover.x} x2={hover.x} y1={T} y2={y(0)} stroke={hover.color} strokeOpacity={0.4} />
            <circle cx={hover.x} cy={hover.y} r={3.5} fill="var(--popover)" stroke={hover.color} strokeWidth={1.5} />
          </g>
        )}
      </svg>
      <Tooltip open={!!hover}>
        <TooltipTrigger asChild>
          <span aria-hidden className="pointer-events-none absolute size-px" style={{ left: `${((hover?.x ?? 0) / W) * 100}%`, top: hover?.y ?? 0 }} />
        </TooltipTrigger>
        <TooltipContent side="top" sideOffset={8} updatePositionStrategy="always" className="pointer-events-none px-2 py-1 text-[11px]" style={{ fontVariantNumeric: "tabular-nums" }}>
          {hover ? `${tipTime(hover.t)} · ${hover.label} ${pct(hover.p)}` : ""}
        </TooltipContent>
      </Tooltip>
    </div>
  );
}

function sessionTicks(t0: number, t1: number) {
  const out: Array<{ t: number; label: string }> = [];
  const first = Math.ceil(t0 / HOUR) * HOUR;
  for (let t = first; t <= t1; t += HOUR) out.push({ t, label: clock(t).slice(0, 2) });
  return out;
}
function dayTicks(t0: number, t1: number) {
  const out: Array<{ t: number; label: string }> = [];
  const d = new Date(t0);
  d.setHours(24, 0, 0, 0);
  const span = t1 - t0;
  const step = span > 10 * 24 * HOUR ? 7 : 1;
  for (let t = d.getTime(); t < t1 - HOUR; t += step * 24 * HOUR) {
    const dd = new Date(t);
    out.push({ t, label: step === 1 ? dd.toLocaleDateString("en-GB", { weekday: "short" }) : dd.toLocaleDateString("en-GB", { day: "numeric", month: "short" }) });
  }
  return out;
}

// ---------- Pieces ----------
function Bar({ value, color, className }: { value: number; color: string; className?: string }) {
  return (
    <span className={cn("relative block h-1.5 overflow-hidden rounded-full bg-muted", className)}>
      <span className="nuc-grow absolute inset-y-0 left-0 rounded-full" style={{ width: `${Math.max(0, Math.min(100, value))}%`, background: color }} />
    </span>
  );
}

function Caption({ children }: { children: ReactNode }) {
  return <div className="text-[10.5px] font-medium uppercase tracking-[0.14em] text-muted-foreground">{children}</div>;
}

function Count({ value, suffix = "%" }: { value: number; suffix?: string }) {
  const v = useCountUp(value);
  return (
    <>
      {Math.round(v)}
      {suffix}
    </>
  );
}

function forecastLine(w: TrendWindow): { text: string; warn: "none" | "amber" | "red" } {
  if (w.idle) return { text: "No session running. A new five-hour window starts with your next message.", warn: "none" };
  if (w.rate === null || w.resetsAt === null)
    return { text: w.span === "session" ? "Collecting usage, forecast in a few minutes." : "Forecast after the first day of this window.", warn: "none" };
  const reset = w.resetsAt;
  if (w.hits100At !== null && w.hits100At < reset) return { text: `Runs out at ${dayClock(w.hits100At)}, ${dur(reset - w.hits100At)} before it resets.`, warn: "red" };
  if (w.hits90At !== null && w.hits90At < reset) return { text: `Hits 90% at ${dayClock(w.hits90At)}, ${dur(reset - w.hits90At)} before it resets.`, warn: "amber" };
  const by = w.span === "session" ? "when the session resets" : `by the reset (${dayClock(reset)})`;
  const basis = w.rateBasis === "pace" ? ` at its average pace so far` : "";
  return { text: `On track: about ${pct(w.forecastAtReset ?? w.pct)} used ${by}${basis}.`, warn: "none" };
}

function Panel({ a, now, isThisChat, sampledFrom }: { a: TrendAccount; now: number; isThisChat: boolean; sampledFrom: number | null }) {
  const nav = useBbNavigate();
  const session = a.windows.find((w) => w.span === "session") ?? null;
  const longs = a.windows.filter((w) => w.span === "long");
  const mainLong = longs.find((w) => !w.model) ?? longs[0] ?? null;
  const head = session && !session.idle ? session : (mainLong ?? session);
  const others = a.windows.filter((w) => w !== head && !(w === session && session?.idle));
  const fc = head ? forecastLine(head) : null;
  const longName = mainLong && mainLong.startsAt !== null && mainLong.resetsAt !== null && mainLong.resetsAt - mainLong.startsAt > 10 * 24 * HOUR ? "This month" : "This week";

  // Time to limit at the current rate, and which window resets first.
  const ttl = (() => {
    const cands = [session && !session.idle ? { name: "session", w: session } : null, mainLong ? { name: longName === "This month" ? "monthly" : "weekly", w: mainLong } : null].filter(
      (x): x is { name: string; w: TrendWindow } => !!x,
    );
    if (cands.every((c) => c.w.rate === null)) return { value: "Collecting", sub: "Needs a few readings first." };
    // Only a limit reached before its own window resets counts.
    const hits = cands
      .filter((c) => c.w.hits100At !== null && c.w.resetsAt !== null && c.w.hits100At < c.w.resetsAt)
      .sort((p, q) => (p.w.hits100At ?? 0) - (q.w.hits100At ?? 0));
    const resets = cands.filter((c) => c.w.resetsAt !== null).sort((p, q) => (p.w.resetsAt ?? 0) - (q.w.resetsAt ?? 0));
    const firstReset = resets[0];
    const resetText = firstReset ? `The ${firstReset.name} window resets first, in ${dur((firstReset.w.resetsAt ?? now) - now)}.` : "";
    const first = hits[0];
    if (!first) return { value: "Not at this rate", sub: resetText };
    return { value: dur((first.w.hits100At ?? now) - now), sub: `The ${first.name} limit, ${dur((first.w.resetsAt ?? now) - (first.w.hits100At ?? now))} before it resets.` };
  })();

  const headPct = head?.pct ?? 0;
  const lineFor = (w: TrendWindow, color: string): Line => ({
    pts: w.series,
    color,
    label: w.label,
    forecast:
      w.rate === null || w.resetsAt === null || w.forecastAtReset === null || !w.series.length
        ? null
        : w.hits100At !== null && w.hits100At < w.resetsAt
          ? [[w.hits100At, 100], [w.resetsAt, 100]]
          : [[w.resetsAt, w.forecastAtReset]],
  });

  return (
    <div className="space-y-3">
      {/* Header */}
      {head ? (
        <div>
          <div className="flex items-baseline justify-between gap-3">
            <Caption>{head.span === "session" ? "Session" : head.label}</Caption>
            {head.resetsAt !== null && !head.idle && <span className="text-[11px] text-muted-foreground">resets in {dur(head.resetsAt - now)} · {dayClock(head.resetsAt)}</span>}
          </div>
          <div className="mt-1 flex items-center gap-3">
            <span className="w-[58px] text-[26px] font-semibold leading-none text-foreground" style={{ fontVariantNumeric: "tabular-nums" }}>
              <Count value={headPct} />
            </span>
            <Bar value={headPct} color={tone(headPct)} className="h-2 flex-1" />
          </div>
          {fc && (
            <div
              className={cn(
                "relative mt-2 rounded-md px-2 py-1.5 text-[12px] leading-snug",
                fc.warn === "red" ? "bg-destructive/15 font-medium text-[var(--destructive-text)]" : fc.warn === "amber" ? "bg-destructive/10 text-[var(--destructive-text)]" : "bg-muted text-muted-foreground",
              )}
            >
              {fc.warn !== "none" && <span aria-hidden className="nuc-pulse" />}
              {fc.text}
            </div>
          )}
        </div>
      ) : (
        <div className="text-[12px] text-muted-foreground">No usage windows reported for this account yet.</div>
      )}

      {others.length > 0 && (
        <div className="grid grid-cols-2 gap-x-4 gap-y-2">
          {others.map((w) => (
            <div key={w.id} className="min-w-0">
              <div className="flex items-baseline justify-between gap-2 text-[11px]">
                <span className="truncate text-muted-foreground">{w.label}</span>
                <span className="text-foreground" style={{ fontVariantNumeric: "tabular-nums" }}>
                  <Count value={w.pct} />
                </span>
              </div>
              <Bar value={w.pct} color={w.model ? PLUM : tone(w.pct)} className="mt-1" />
              {w.resetsAt !== null && <div className="mt-0.5 text-[10.5px] text-muted-foreground/80">resets {dayClock(w.resetsAt)}</div>}
            </div>
          ))}
        </div>
      )}

      <div className="flex min-w-0 items-center gap-1.5 text-[11.5px] text-muted-foreground">
        <span className="truncate">{a.email ?? harnessName(a.harness)}</span>
        {a.plan && (
          <Badge variant="secondary" className="shrink-0 rounded px-1.5 py-0 text-[10.5px] font-medium">
            {a.plan}
          </Badge>
        )}
        {isThisChat && (
          <Badge variant="outline" className="shrink-0 rounded border-[color:var(--attention)] px-1.5 py-0 text-[10.5px] font-medium text-[var(--warning-text)]">
            This chat
          </Badge>
        )}
        {a.status === "error" && <span className="shrink-0 text-[var(--destructive-text)]">last reading failed</span>}
      </div>

      {/* This session */}
      {session && (
        <section>
          <div className="mb-1 flex items-baseline justify-between">
            <Caption>This session</Caption>
            {!session.idle && session.startsAt !== null && <span className="text-[10.5px] text-muted-foreground">since {clock(session.startsAt)}</span>}
          </div>
          {session.idle || session.startsAt === null || session.resetsAt === null ? (
            <div className="rounded-md border border-dashed border-border px-3 py-4 text-center text-[11.5px] text-muted-foreground">No session running right now.</div>
          ) : (
            <Chart t0={session.startsAt} t1={session.resetsAt} now={now} lines={[lineFor(session, GOLD)]} ticks={sessionTicks(session.startsAt, session.resetsAt)} tipTime={clock} />
          )}
        </section>
      )}

      {/* This week / this month */}
      {mainLong && mainLong.startsAt !== null && mainLong.resetsAt !== null && (
        <section>
          <div className="mb-1 flex items-baseline justify-between gap-2">
            <Caption>{longName}</Caption>
            <span className="flex items-center gap-2 text-[10.5px] text-muted-foreground">
              <span className="flex items-center gap-1">
                <span className="inline-block h-0.5 w-2.5 rounded" style={{ background: GOLD }} />
                All models
              </span>
              {longs
                .filter((w) => w.model)
                .map((w) => (
                  <span key={w.id} className="flex items-center gap-1">
                    <span className="inline-block h-0.5 w-2.5 rounded" style={{ background: PLUM }} />
                    {w.model ? `${w.model.charAt(0).toUpperCase()}${w.model.slice(1)}` : ""}
                  </span>
                ))}
            </span>
          </div>
          <Chart
            t0={mainLong.startsAt}
            t1={mainLong.resetsAt}
            now={now}
            lines={[lineFor(mainLong, GOLD), ...longs.filter((w) => w.model).map((w) => lineFor(w, PLUM))]}
            ticks={dayTicks(mainLong.startsAt, mainLong.resetsAt)}
            tipTime={dayClock}
          />
        </section>
      )}

      {/* Burn rate and time to limit */}
      <div className="grid grid-cols-2 gap-2">
        <div className="rounded-md bg-muted/60 px-2.5 py-2">
          <Caption>Burn rate</Caption>
          <div className="mt-0.5 text-[15px] font-semibold text-foreground" style={{ fontVariantNumeric: "tabular-nums" }}>
            {a.burn === null ? "Collecting" : `${a.burn === 0 ? "0" : a.burn.toFixed(a.burn < 10 ? 1 : 0)}% an hour`}
          </div>
          <div className="text-[10.5px] text-muted-foreground">{a.burn === null ? "Needs 30 minutes of readings." : `Last 30 min, ${session && !session.idle ? "session" : "main"} window`}</div>
        </div>
        <div className="rounded-md bg-muted/60 px-2.5 py-2">
          <Caption>Time to limit</Caption>
          <div className="mt-0.5 text-[15px] font-semibold text-foreground" style={{ fontVariantNumeric: "tabular-nums" }}>
            {ttl.value}
          </div>
          <div className="text-[10.5px] leading-snug text-muted-foreground">{ttl.sub}</div>
        </div>
      </div>

      {/* Busiest chats */}
      <section>
        <div className="mb-1.5 flex items-baseline justify-between gap-2">
          <Caption>{a.busiest.mode === "activity" ? "Most active chats" : "Busiest chats"}</Caption>
          <Tooltip>
            <TooltipTrigger asChild>
              <span tabIndex={0} className="cursor-help text-[10.5px] text-muted-foreground underline decoration-dotted underline-offset-2">
                {a.busiest.mode === "tokens" ? `share of tokens ${a.busiest.sinceLabel}` : a.busiest.mode === "activity" ? `by turns ${a.busiest.sinceLabel}` : a.busiest.sinceLabel}
              </span>
            </TooltipTrigger>
            <TooltipContent side="top" className="max-w-[260px] text-[11px] leading-snug">
              {a.busiest.mode === "tokens"
                ? "Estimate. Each finished turn's tokens, weighted like API prices (cache reads count a tenth, output five times), credited to the account the chat's session is pinned to. The provider does not report usage per chat, and a turn counts once it finishes."
                : "No token reports for this account, so chats are ranked by finished turns instead."}
            </TooltipContent>
          </Tooltip>
        </div>
        {a.busiest.rows.length === 0 ? (
          <div className="text-[11.5px] text-muted-foreground">No finished turns on this account {a.busiest.sinceLabel}.</div>
        ) : (
          <div className="space-y-1.5">
            {a.busiest.rows.map((r, i) => (
              <button key={r.threadId} type="button" onClick={() => nav.toThread(r.threadId)} className="group block w-full text-left" title={`Open ${r.title}`}>
                <div className="flex items-baseline justify-between gap-3 text-[12px]">
                  <span className="truncate text-foreground group-hover:underline">{r.title}</span>
                  <span className="shrink-0 text-muted-foreground" style={{ fontVariantNumeric: "tabular-nums" }}>
                    <Count value={r.share * 100} />
                  </span>
                </div>
                <Bar value={r.share * 100} color={i === 0 ? GOLD : "color-mix(in oklch, var(--attention) 55%, var(--muted))"} className="mt-0.5 h-1" />
              </button>
            ))}
          </div>
        )}
      </section>

      <div className="border-t border-border pt-2 text-[10.5px] leading-snug text-muted-foreground/90">
        {a.observedAt ? `Read ${dur(now - a.observedAt)} ago from ${a.harness === "cursor" ? "Cursor's usage page" : "the Account Pooler"}` : "No reading yet"}
        {sampledFrom ? `, sampled every ${a.harness === "cursor" ? "15" : "3"} min since ${dayClock(sampledFrom)}.` : "."} Forecasts are straight-line estimates.
      </div>
    </div>
  );
}

/** Account tabs with a sliding gold indicator; the panel crossfades between accounts. */
function AccountTabs({ trend, active, setActive, thisChat }: { trend: Trend; active: string; setActive: (id: string) => void; thisChat: string | null }) {
  const listRef = useRef<HTMLDivElement>(null);
  const [ind, setInd] = useState<{ x: number; w: number } | null>(null);
  const [leaving, setLeaving] = useState<string | null>(null);
  const prev = useRef(active);

  useLayoutEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-acct="${cssEscape(active)}"]`);
    if (el) setInd({ x: el.offsetLeft, w: el.offsetWidth });
  }, [active, trend.accounts.length]);

  useEffect(() => {
    if (prev.current === active) return;
    setLeaving(prev.current);
    prev.current = active;
    const t = window.setTimeout(() => setLeaving(null), 150);
    return () => window.clearTimeout(t);
  }, [active]);

  const acct = trend.accounts.find((x) => x.id === active) ?? trend.accounts[0];
  const old = leaving ? trend.accounts.find((x) => x.id === leaving) : null;

  return (
    <Tabs value={acct.id} onValueChange={setActive}>
      {trend.accounts.length > 1 && (
        <TabsList ref={listRef} className="relative mb-3 w-full justify-start gap-0.5 bg-transparent p-0">
          {trend.accounts.map((x) => (
            <TabsTrigger key={x.id} value={x.id} data-acct={x.id} className="relative gap-1 rounded-md px-2 py-1 text-[11.5px] text-muted-foreground hover:text-foreground focus-visible:ring-1">
              {tabLabel(x, trend.accounts)}
              {x.id === thisChat && <span aria-label="this chat" className="size-1 rounded-full" style={{ background: GOLD }} />}
            </TabsTrigger>
          ))}
          {ind && (
            <span
              aria-hidden
              className="nuc-ind pointer-events-none absolute bottom-[-3px] left-0 h-[2px] w-px rounded-full"
              style={{ background: GOLD, transform: `translateX(${ind.x}px) scaleX(${ind.w})` }}
            />
          )}
        </TabsList>
      )}
      <div className="relative">
        {old && old.id !== acct.id && (
          <div aria-hidden className="nuc-xout pointer-events-none absolute inset-x-0 top-0">
            <Panel a={old} now={trend.now} isThisChat={old.id === thisChat} sampledFrom={trend.sampledFrom} />
          </div>
        )}
        <TabsContent value={acct.id} key={acct.id} className="nuc-xin">
          <Panel a={acct} now={trend.now} isThisChat={acct.id === thisChat} sampledFrom={trend.sampledFrom} />
        </TabsContent>
      </div>
    </Tabs>
  );
}

const cssEscape = (s: string) => (window.CSS?.escape ? window.CSS.escape(s) : s.replace(/["\\]/g, ""));

/**
 * Wraps the usage line. Hover for ~250 ms (or focus it and press Enter) to open;
 * it stays open while the pointer is on the line or the card, and closes on
 * leaving or Escape.
 */
export function UsageHover({ children, thisAccount }: { children: ReactNode; thisAccount: string | null }) {
  const rpc = useRpc<typeof rpcContract>();
  const [open, setOpen] = useState(false);
  const pinned = useRef(false);
  const [trend, setTrend] = useState<Trend | null>(null);
  const [failed, setFailed] = useState(false);
  const [active, setActive] = useState<string | null>(null);
  const triggerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      setTrend(await rpc.call("usage_trend", null));
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, [rpc]);

  useEffect(() => {
    if (!open) return;
    void load();
    const id = window.setInterval(() => void load(), 60_000);
    return () => window.clearInterval(id);
  }, [open, load]);

  // Default to the account this chat runs on, each time the card opens.
  useEffect(() => {
    if (open) setActive(null);
  }, [open, thisAccount]);
  const accounts = trend?.accounts ?? [];
  const current = active ?? (accounts.some((a) => a.id === thisAccount) ? thisAccount : (accounts[0]?.id ?? null));

  const change = (o: boolean) => {
    if (!o && pinned.current) return;
    setOpen(o);
  };
  const close = () => {
    pinned.current = false;
    setOpen(false);
  };

  const body = useMemo(() => {
    if (!trend) return <div className="py-6 text-center text-[12px] text-muted-foreground">{failed ? "Couldn't load usage. Try again in a moment." : "Loading usage…"}</div>;
    if (accounts.length === 0 || !current)
      return <div className="py-6 text-center text-[12px] text-muted-foreground">Collecting usage. The first readings land within three minutes.</div>;
    return <AccountTabs trend={trend} active={current} setActive={setActive} thisChat={thisAccount} />;
  }, [trend, failed, accounts.length, current, thisAccount]);

  return (
    <TooltipProvider delayDuration={200}>
      <HoverCard open={open} onOpenChange={change} openDelay={250} closeDelay={120}>
        <HoverCardTrigger asChild>
          <div
            ref={triggerRef}
            tabIndex={0}
            role="button"
            aria-haspopup="dialog"
            aria-expanded={open}
            aria-label="Usage details. Press Enter for the usage card."
            className="rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring"
            onPointerEnter={() => {
              if (!trend) void load();
            }}
            // Keyboard opens with Enter, not on focus, so tabbing past the line stays quiet.
            onFocus={(e) => e.preventDefault()}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                pinned.current = true;
                setOpen(true);
                window.setTimeout(() => contentRef.current?.querySelector<HTMLElement>('[role="tab"][data-state="active"], button, [tabindex="0"]')?.focus(), 30);
              } else if (e.key === "Escape" && open) {
                e.preventDefault();
                close();
              }
            }}
          >
            {children}
          </div>
        </HoverCardTrigger>
        <HoverCardContent
          ref={contentRef}
          side="top"
          align="start"
          sideOffset={8}
          className="nuc-card w-[392px] max-w-[calc(100vw-24px)] p-3.5"
          onEscapeKeyDown={() => {
            close();
            triggerRef.current?.focus();
          }}
          onPointerDownOutside={close}
          onFocusOutside={(e) => {
            if (triggerRef.current?.contains(e.target as Node)) e.preventDefault();
            else close();
          }}
        >
          <style>{STYLE}</style>
          {body}
        </HoverCardContent>
      </HoverCard>
    </TooltipProvider>
  );
}
