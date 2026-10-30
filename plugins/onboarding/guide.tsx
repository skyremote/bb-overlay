import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { STEPS, type Edition } from "./lib/steps";
import { placeCard } from "./lib/anchors";
import { useAnchor } from "./lib/use-anchor";
import type { GuideAction, GuideProgress } from "./lib/state";
import "./styles.css";
export type GuidePhase = "offer" | "tour" | "completed";
export interface GuideSnapshot { edition: Edition; guideVersion: string; autoStart: boolean; progress: GuideProgress; }
export interface GuideProps { snapshot: GuideSnapshot; phase: GuidePhase; busy: boolean; error: string | null; onAction: (action: GuideAction) => void; onClose: () => void; }
function Arrow({ back = false }: { back?: boolean }) { return <svg viewBox="0 0 24 24" aria-hidden="true"><path d={back ? "M19 12H5m6 6-6-6 6-6" : "M5 12h14m-6-6 6 6-6 6"} /></svg>; }
function Book() { return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5c-3-2-6-2-9-1v15c3-1 6-1 9 1m0-15c3-2 6-2 9-1v15c-3-1-6-1-9 1V5Z" /></svg>; }
export function GuideView({ snapshot, phase, busy, error, onAction, onClose }: GuideProps) {
  const steps = STEPS[snapshot.edition], step = steps[snapshot.progress.index]!, isTour = phase === "tour";
  const [retry, setRetry] = useState(0), [size, setSize] = useState({ width: 376, height: 384 });
  const anchor = useAnchor(isTour ? step : null, retry), dialog = useRef<HTMLDialogElement>(null), card = useRef<HTMLDivElement>(null), heading = useRef<HTMLHeadingElement>(null);
  const previousFocus = useRef<Element | null>(null), key = isTour ? step.id : phase;
  const placement = placeCard(isTour && anchor.status === "visible" ? anchor.rect : null, size, anchor.frame, step.side);
  const pointer = anchor.rect && placement.arrow ? (() => {
    const r = anchor.rect, centreX = Math.max(20, Math.min(size.width - 20, r.left + r.width / 2 - placement.left)), centreY = Math.max(20, Math.min(size.height - 20, r.top + r.height / 2 - placement.top));
    if (placement.side === "right") return { left: placement.left - 6, top: placement.top + centreY - 6 };
    if (placement.side === "left") return { left: placement.left + size.width - 6, top: placement.top + centreY - 6 };
    if (placement.side === "top") return { left: placement.left + centreX - 6, top: placement.top + size.height - 6 };
    return { left: placement.left + centreX - 6, top: placement.top - 6 };
  })() : null;
  const reviewed = snapshot.progress.reviewed[step.id] !== undefined;
  const targetRect = isTour && anchor.status === "visible" ? anchor.rect : null;
  useLayoutEffect(() => {
    const d = dialog.current; if (!d) return;
    previousFocus.current = document.activeElement;
    if (!d.open) d.showModal();
    return () => { d.close(); if (previousFocus.current instanceof HTMLElement && previousFocus.current.isConnected) previousFocus.current.focus({ preventScroll: true }); };
  }, []);
  useLayoutEffect(() => {
    const c = card.current; if (!c) return;
    const measure = () => { const r = c.getBoundingClientRect(); if (r.width && r.height) setSize({ width: r.width, height: r.height }); };
    measure(); const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure); ro?.observe(c); return () => ro?.disconnect();
  }, [key, anchor.status, error]);
  useEffect(() => { heading.current?.focus({ preventScroll: true }); }, [key]);
  useEffect(() => {
    // Block host shortcuts and explicitly cycle focus; do not rely on browser chrome tab cycling.
    const capture = (event: KeyboardEvent) => {
      if (!dialog.current?.open) return;
      if (event.key === "Escape") { event.preventDefault(); event.stopImmediatePropagation(); onClose(); return; }
      if (event.key === "Tab") {
        event.preventDefault(); event.stopImmediatePropagation();
        const items = Array.from(dialog.current.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), a[href], select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])')).filter(item => item.getClientRects().length > 0);
        if (!items.length) { heading.current?.focus({ preventScroll: true }); return; }
        const at = items.indexOf(document.activeElement as HTMLElement);
        const next = event.shiftKey ? at <= 0 ? items.length - 1 : at - 1 : at < 0 || at === items.length - 1 ? 0 : at + 1;
        items[next]?.focus({ preventScroll: true }); return;
      }
      event.stopPropagation();
    };
    window.addEventListener("keydown", capture, true); return () => window.removeEventListener("keydown", capture, true);
  }, [onClose]);
  const runId = snapshot.progress.runId;
  return createPortal(<dialog ref={dialog} className="bbog-layer" data-bb-overlay-guide-root="" data-screen-share-skip="" aria-labelledby="bbog-title" aria-describedby="bbog-description" onCancel={event => { event.preventDefault(); onClose(); }}>
    <svg className="bbog-shade" aria-hidden="true" width="100%" height="100%"><defs><mask id="bbog-hole"><rect width="100%" height="100%" fill="white" />{targetRect && <rect className="bbog-hole" x={Math.max(0, targetRect.left - 6)} y={Math.max(0, targetRect.top - 6)} width={targetRect.width + 12} height={targetRect.height + 12} rx="8" fill="black" />}</mask></defs><rect width="100%" height="100%" fill="rgba(18,18,20,.56)" mask="url(#bbog-hole)" /></svg>
    {targetRect && <div className="bbog-spotlight" data-testid="guide-spotlight" style={{ left: targetRect.left - 6, top: targetRect.top - 6, width: targetRect.width + 12, height: targetRect.height + 12 }} />}
    {pointer && targetRect && <span className="bbog-pointer" aria-hidden="true" style={pointer} />}
    <div ref={card} className="bbog-card" data-side={placement.side} data-direction={placement.side} style={{ left: placement.left, top: placement.top, maxHeight: Math.max(160, anchor.frame.height - 24), width: Math.min(376, anchor.frame.width - 24) }}>
      <div className="bbog-card-head"><span className="bbog-identity"><Book /> BB Overlay guide</span><button type="button" className="bbog-close" aria-label="Close guide and save progress" onClick={onClose}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M6 18 18 6" /></svg></button></div>
      <div className="bbog-content" key={key}>
      {phase === "offer" ? <>
        <span className="bbog-step-meta">{snapshot.edition === "simple" ? "Simple" : "Your existing Pro workspace"} · {steps.length} short steps</span>
        <h2 id="bbog-title" ref={heading} tabIndex={-1}>A short guide, right where you work.</h2>
        <p id="bbog-description">We’ll point to the real controls in your workspace. Read each explanation and tick its read check before moving on.</p>
        <p className="bbog-tip">You can close this at any point and resume later. The guide leaves your chats, modules, appearance and accounts unchanged.</p>
        <div className="bbog-actions"><button className="bbog-secondary" onClick={onClose}>Later</button><button className="bbog-primary" disabled={busy} onClick={() => onAction({ kind: "start" })}>Start guide <Arrow /></button></div>
      </> : phase === "completed" ? <>
        <span className="bbog-step-meta">{snapshot.edition === "simple" ? "Simple" : "Pro"} guide · complete</span>
        <h2 id="bbog-title" ref={heading} tabIndex={-1}>You’ve read every step.</h2>
        <p id="bbog-description">Your progress is saved. Resume or replay from the BB Overlay guide section in Settings, or find its command in the command palette.</p>
        {snapshot.progress.history.lastUnavailableSteps.length > 0 && <p className="bbog-target-note">{snapshot.progress.history.lastUnavailableSteps.length} controls were unavailable in this layout. You acknowledged their explanations; the guide has not enabled or verified those features.</p>}
        <p className="bbog-tip">Replay clears this run’s read checks and preserves your previous completion history.</p>
        <div className="bbog-actions"><button className="bbog-secondary" disabled={busy} onClick={() => onAction({ kind: "replay" })}>Replay guide</button><button className="bbog-primary" onClick={onClose}>Back to work <Arrow /></button></div>
      </> : <>
        <div className="bbog-step-meta"><span>{snapshot.edition === "simple" ? "Simple" : "Pro"} · Step {snapshot.progress.index + 1} of {steps.length}</span><span>{Object.keys(snapshot.progress.reviewed).length} read</span></div>
        <div className="bbog-progress" aria-hidden="true">{steps.map((item, index) => <span key={item.id} data-current={index === snapshot.progress.index} data-reviewed={snapshot.progress.reviewed[item.id] !== undefined} />)}</div>
        <h2 id="bbog-title" ref={heading} tabIndex={-1}>{step.title}</h2>
        <p id="bbog-description">{step.body}</p>
        {anchor.status !== "visible" && <div className="bbog-target-note" role="status"><strong>{anchor.status === "waiting" ? "Looking for this control…" : "This control isn’t visible here."}</strong><p>{anchor.status === "waiting" ? "Waiting for the workspace to finish laying out. Nothing is clicked or enabled." : step.unavailable}</p>{anchor.status === "unavailable" && <button className="bbog-text-button" disabled={busy} onClick={() => setRetry(value => value + 1)}>Try again</button>}</div>}
        <p className="bbog-tip">{step.tip}</p>
        <label className="bbog-read"><input type="checkbox" checked={reviewed} disabled={busy || anchor.status === "waiting"} onChange={event => onAction({ kind: "review", runId, stepId: step.id, checked: event.target.checked, availability: anchor.status === "visible" ? "visible" : "unavailable" })} /><span>I’ve read this {anchor.status === "unavailable" ? "explanation" : "step"}</span></label>
        <span className="bbog-read-help">{reviewed ? "Read check saved. You can continue." : anchor.status === "waiting" ? "The read check becomes available once this target is resolved." : "Tick the read check to continue. It is never checked automatically."}</span>
        <div className="bbog-actions"><button className="bbog-secondary" disabled={busy || snapshot.progress.index === 0} onClick={() => onAction({ kind: "move", runId, direction: "back" })}><Arrow back /> Back</button><button className="bbog-primary" disabled={busy || !reviewed || anchor.status === "waiting"} onClick={() => onAction({ kind: "move", runId, direction: "next" })}>{snapshot.progress.index === steps.length - 1 ? "Finish guide" : "Next"}<Arrow /></button></div>
      </>}
      {busy && <p className="bbog-saving" role="status">Saving progress…</p>}
      {error && <p className="bbog-error" role="alert">{error}</p>}
      </div>
    </div>
  </dialog>, document.body);
}
