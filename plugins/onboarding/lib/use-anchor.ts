import { useEffect, useState } from "react";
import { findTarget, viewport, visibleRect, type Rect, type Viewport } from "./anchors";
import type { GuideStep } from "./steps";
export interface AnchorState { status: "waiting" | "visible" | "unavailable"; rect: Rect | null; frame: Viewport; }
const initialFrame = (): Viewport => typeof window === "undefined" ? { left: 0, top: 0, width: 1280, height: 800 } : viewport();
export function useAnchor(step: GuideStep | null, retry: number): AnchorState {
  const [state, setState] = useState<AnchorState & { stepId: string | null }>(() => ({ stepId: null, status: "waiting", rect: null, frame: initialFrame() }));
  useEffect(() => {
    if (!step) { setState({ stepId: null, status: "unavailable", rect: null, frame: viewport() }); return; }
    let disposed = false, frameId = 0, waited = false, scrolled: HTMLElement | null = null, observed: HTMLElement | null = null;
    const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(schedule);
    const timer = setTimeout(() => { waited = true; schedule(); }, 1600);
    function scan() {
      frameId = 0; if (disposed) return;
      const frame = viewport(), match = findTarget(step!);
      if (observed !== match?.element) { ro?.disconnect(); observed = match?.element ?? null; if (observed) ro?.observe(observed); }
      if (!match) { setState({ stepId: step?.id ?? null, status: waited ? "unavailable" : "waiting", rect: null, frame }); return; }
      let visible = visibleRect(match.element, frame);
      if ((!visible || visible.width < Math.min(20, match.rect.width) || visible.height < Math.min(20, match.rect.height)) && scrolled !== match.element) {
        scrolled = match.element; match.element.scrollIntoView?.({ block: "nearest", inline: "nearest", behavior: "instant" });
        visible = visibleRect(match.element, frame);
      }
      setState({ stepId: step?.id ?? null, status: visible ? "visible" : waited ? "unavailable" : "waiting", rect: visible, frame });
    }
    function schedule() { if (!frameId && !disposed) frameId = requestAnimationFrame(scan); }
    setState({ stepId: step?.id ?? null, status: "waiting", rect: null, frame: viewport() });
    const mo = new MutationObserver(records => { if (records.some(r => !(r.target instanceof Element && r.target.closest('[data-bb-overlay-guide-root]')))) schedule(); });
    mo.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["class", "style", "hidden", "inert", "data-state", "aria-hidden", "aria-expanded"] });
    window.addEventListener("resize", schedule); window.addEventListener("scroll", schedule, true);
    window.visualViewport?.addEventListener("resize", schedule); window.visualViewport?.addEventListener("scroll", schedule);
    schedule();
    return () => { disposed = true; clearTimeout(timer); cancelAnimationFrame(frameId); mo.disconnect(); ro?.disconnect(); window.removeEventListener("resize", schedule); window.removeEventListener("scroll", schedule, true); window.visualViewport?.removeEventListener("resize", schedule); window.visualViewport?.removeEventListener("scroll", schedule); };
  }, [step, retry]);
  return state.stepId === (step?.id ?? null) ? state : { status: "waiting", rect: null, frame: state.frame };
}
