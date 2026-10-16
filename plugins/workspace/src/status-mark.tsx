// StatusMark — after React Bits' StatusMark, rebuilt as pure SVG + CSS for the
// "come back later" flag:
//   revisit  a dashed gold ring that slowly turns and breathes (unfinished)
//   done     a solid green ring that draws in, then a check stroke; a soft halo
//            pings every few seconds so a "done, check it" chat stays visible
//   mistake  the same with a red ring and a cross
import type { LaterReason } from "./rail-state";

const CSS = `
@keyframes nav-sm-spin { to { transform: rotate(360deg); } }
@keyframes nav-sm-breathe { 50% { opacity: .45; } }
@keyframes nav-sm-draw { from { stroke-dashoffset: var(--len); } to { stroke-dashoffset: 0; } }
@keyframes nav-sm-ping { 0% { transform: scale(.7); opacity: .55; } 70%, 100% { transform: scale(1.55); opacity: 0; } }
.nav-sm-ring-dash { transform-origin: 12px 12px; animation: nav-sm-spin 6s linear infinite, nav-sm-breathe 2.4s ease-in-out infinite; }
.nav-sm-draw { stroke-dasharray: var(--len); animation: nav-sm-draw 360ms cubic-bezier(.77,0,.175,1) both; }
.nav-sm-halo { transform-origin: 12px 12px; animation: nav-sm-ping 2.8s cubic-bezier(.23,1,.32,1) infinite; }
@media (prefers-reduced-motion: reduce) { .nav-sm-ring-dash, .nav-sm-halo { animation: none; } .nav-sm-draw { animation: none; stroke-dasharray: none; } }
`;

let injected = false;
function ensureStyle() {
  if (injected || typeof document === "undefined") return;
  if (!document.getElementById("nav-sm-style")) {
    const el = document.createElement("style");
    el.id = "nav-sm-style";
    el.textContent = CSS;
    document.head.appendChild(el);
  }
  injected = true;
}

const LABEL: Record<LaterReason, string> = {
  revisit: "Come back to this",
  done: "Done, check it later",
  mistake: "Has a mistake, come back",
};

export const LATER_LABEL = LABEL;

export function StatusMark({ reason, size = 14 }: { reason: LaterReason; size?: number }) {
  ensureStyle();
  const C = 2 * Math.PI * 9; // ring circumference at r=9
  if (reason === "revisit") {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" role="img" aria-label={LABEL.revisit} className="shrink-0">
        <circle className="nav-sm-ring-dash" cx="12" cy="12" r="9" fill="none" stroke="var(--attention)" strokeWidth="2.4" strokeLinecap="round" strokeDasharray={`${C / 8 * 0.42} ${C / 8 * 0.58}`} />
        <circle cx="12" cy="12" r="2.2" fill="var(--attention)" />
      </svg>
    );
  }
  const color = reason === "done" ? "var(--success)" : "var(--destructive)";
  const glyph = reason === "done" ? "M7.5 12.25 10.5 15.25 16.75 8.75" : "M8.75 8.75 15.25 15.25M15.25 8.75 8.75 15.25";
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" role="img" aria-label={LABEL[reason]} className="shrink-0 overflow-visible">
      <circle className="nav-sm-halo" cx="12" cy="12" r="9" fill="none" stroke={color} strokeWidth="1.5" />
      <circle cx="12" cy="12" r="9" fill={color} fillOpacity=".1" stroke={color} strokeWidth="2.2" className="nav-sm-draw" style={{ ["--len" as string]: `${C}` }} />
      <path d={glyph} fill="none" stroke={color} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" className="nav-sm-draw" style={{ ["--len" as string]: "16", animationDelay: "240ms" }} />
    </svg>
  );
}

/** Row highlights: a chat whose agent has finished since you last opened it.
 *  The green tick ring with its soft ping, until you open the chat. */
export function FinishedMark({ size = 14 }: { size?: number }) {
  ensureStyle();
  const C = 2 * Math.PI * 9;
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" role="img" aria-label="Finished, not opened yet" className="shrink-0 overflow-visible">
      <circle className="nav-sm-halo" cx="12" cy="12" r="9" fill="none" stroke="var(--success)" strokeWidth="1.5" />
      <circle cx="12" cy="12" r="9" fill="var(--success)" fillOpacity=".16" stroke="var(--success)" strokeWidth="2.4" className="nav-sm-draw" style={{ ["--len" as string]: `${C}` }} />
      <path d="M7.5 12.25 10.5 15.25 16.75 8.75" fill="none" stroke="var(--success)" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" className="nav-sm-draw" style={{ ["--len" as string]: "16", animationDelay: "240ms" }} />
    </svg>
  );
}

/** Blue for "waiting on your answer". The NavAIgate theme has no blue on
 *  purpose, so this one is set here; a theme can override --nav-ask. It holds
 *  3:1 against both the light paper and the dark ground. */
export const ASK = "var(--nav-ask, #3b82f6)";

/** Row highlights: a chat whose agent has asked you a question (or wants an
 *  approval) and is waiting. A blue ring with a question mark and the same ping. */
export function AskMark({ size = 14 }: { size?: number }) {
  ensureStyle();
  const C = 2 * Math.PI * 9;
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" role="img" aria-label="Waiting for your answer" className="shrink-0 overflow-visible">
      <circle className="nav-sm-halo" cx="12" cy="12" r="9" fill="none" stroke={ASK} strokeWidth="1.5" />
      <circle cx="12" cy="12" r="9" fill={ASK} fillOpacity=".16" stroke={ASK} strokeWidth="2.4" className="nav-sm-draw" style={{ ["--len" as string]: `${C}` }} />
      <path d="M9.6 9.7a2.5 2.5 0 1 1 3.4 2.3c-.6.3-1 .8-1 1.5v.4" fill="none" stroke={ASK} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="12" cy="16.9" r="1.25" fill={ASK} />
    </svg>
  );
}

/* ---- Task glyphs: the same family of marks for to-do items ----
 *  todo     dashed ring (waiting)          doing  lattice (handled by caller)
 *  check    gold ring with a soft ping     done   green tick, drawn once
 *  dropped  muted cross                                                     */
export type TaskGlyphKind = "todo" | "check" | "done" | "dropped";

export function TaskGlyph({ kind, size = 14 }: { kind: TaskGlyphKind; size?: number }) {
  ensureStyle();
  const C = 2 * Math.PI * 9;
  if (kind === "todo") {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" aria-label="To do" role="img" className="shrink-0">
        <circle cx="12" cy="12" r="9" fill="none" stroke="var(--muted-foreground)" strokeOpacity=".7" strokeWidth="2" strokeLinecap="round" strokeDasharray={`${(C / 8) * 0.42} ${(C / 8) * 0.58}`} />
      </svg>
    );
  }
  if (kind === "check") {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" aria-label="Ready to check" role="img" className="shrink-0 overflow-visible">
        <circle className="nav-sm-halo" cx="12" cy="12" r="9" fill="none" stroke="var(--attention)" strokeWidth="1.5" />
        <circle cx="12" cy="12" r="9" fill="var(--attention)" fillOpacity=".15" stroke="var(--attention)" strokeWidth="2.2" />
        <circle cx="12" cy="12" r="3" fill="var(--attention)" />
      </svg>
    );
  }
  if (kind === "done") {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" aria-label="Done" role="img" className="shrink-0">
        <circle cx="12" cy="12" r="9" fill="var(--success)" fillOpacity=".12" stroke="var(--success)" strokeWidth="2.2" />
        <path d="M7.5 12.25 10.5 15.25 16.75 8.75" fill="none" stroke="var(--success)" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" className="nav-sm-draw" style={{ ["--len" as string]: "16" }} />
      </svg>
    );
  }
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-label="Dropped" role="img" className="shrink-0">
      <circle cx="12" cy="12" r="9" fill="none" stroke="var(--muted-foreground)" strokeOpacity=".5" strokeWidth="2" />
      <path d="M8.75 8.75 15.25 15.25M15.25 8.75 8.75 15.25" fill="none" stroke="var(--muted-foreground)" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}
