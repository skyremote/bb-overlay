import type { GuideStep } from "./steps";
export interface Rect { left: number; top: number; width: number; height: number; }
export interface Viewport extends Rect {}
export type AnchorResult = { element: HTMLElement; rect: Rect } | null;
export function isDisplayed(element: HTMLElement): boolean {
  if (!element.isConnected || element.closest('[hidden], [inert], [aria-hidden="true"], [data-bb-overlay-guide-root]')) return false;
  // A child can retain positive geometry inside a CSS-hidden mobile sidebar.
  // Explicit [inert] marks closed native sidebar layers and is rejected above.
  // The guide dialog uses UA implicit modal inertness, which adds no attribute
  // and must not hide the visible host targets from this resolver.
  for (let node: HTMLElement | null = element; node; node = node.parentElement) {
    const style = getComputedStyle(node);
    if (style.display === "none" || style.visibility === "hidden" || style.visibility === "collapse" || Number(style.opacity || "1") <= 0 || style.contentVisibility === "hidden") return false;
    if (node instanceof HTMLDialogElement && !node.open) return false;
  }
  if (typeof element.checkVisibility === "function" && !element.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true, contentVisibilityAuto: true })) return false;
  const rect = element.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}
/** Use only positively identified real controls. Ambiguous selectors are refused. */
export function findTarget(step: GuideStep, root: ParentNode = document): AnchorResult {
  for (const selector of step.selectors) {
    const matches = [...root.querySelectorAll<HTMLElement>(selector)].filter(isDisplayed);
    if (matches.length === 1) { const element = matches[0]!; return { element, rect: element.getBoundingClientRect() }; }
  }
  return null;
}
export function viewport(): Viewport {
  const v = window.visualViewport;
  return { left: v?.offsetLeft ?? 0, top: v?.offsetTop ?? 0, width: v?.width ?? innerWidth, height: v?.height ?? innerHeight };
}
export function intersection(rect: Rect, box: Rect): Rect | null {
  const left = Math.max(rect.left, box.left), top = Math.max(rect.top, box.top);
  const right = Math.min(rect.left + rect.width, box.left + box.width), bottom = Math.min(rect.top + rect.height, box.top + box.height);
  return right > left && bottom > top ? { left, top, width: right - left, height: bottom - top } : null;
}
export function visibleRect(element: HTMLElement, frame: Viewport): Rect | null {
  let rect: Rect | null = intersection(element.getBoundingClientRect(), frame);
  for (let parent = element.parentElement; parent && rect; parent = parent.parentElement) {
    const style = getComputedStyle(parent);
    if (/(auto|scroll|hidden|clip)/.test(style.overflow + style.overflowX + style.overflowY)) rect = intersection(rect, parent.getBoundingClientRect());
  }
  return rect;
}
export interface Placement { left: number; top: number; side: GuideStep["side"] | "centre"; arrow: boolean; }
export function placeCard(target: Rect | null, card: { width: number; height: number }, frame: Viewport, preferred: GuideStep["side"]): Placement {
  const margin = 12, gap = 18, minX = frame.left + margin, minY = frame.top + margin;
  const maxX = Math.max(minX, frame.left + frame.width - card.width - margin), maxY = Math.max(minY, frame.top + frame.height - card.height - margin);
  const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(v, max));
  if (!target) return { left: clamp(frame.left + (frame.width - card.width) / 2, minX, maxX), top: clamp(frame.top + (frame.height - card.height) / 2, minY, maxY), side: "centre", arrow: false };
  const candidates: Record<GuideStep["side"], { left: number; top: number }> = {
    right: { left: target.left + target.width + gap, top: target.top + target.height / 2 - card.height / 2 },
    left: { left: target.left - card.width - gap, top: target.top + target.height / 2 - card.height / 2 },
    top: { left: target.left + target.width / 2 - card.width / 2, top: target.top - card.height - gap },
    bottom: { left: target.left + target.width / 2 - card.width / 2, top: target.top + target.height + gap },
  };
  const order: GuideStep["side"][] = [...new Set([preferred, ...(frame.width < 600 ? ["top", "bottom", "right", "left"] : ["right", "left", "top", "bottom"])])] as GuideStep["side"][];
  const chosen = order.find(side => { const p = candidates[side]; return p.left >= minX && p.left <= maxX && p.top >= minY && p.top <= maxY; }) ?? order.find(side => { const p = candidates[side]; return side === "top" || side === "bottom" ? p.top >= minY && p.top <= maxY : p.left >= minX && p.left <= maxX; }) ?? preferred;
  const p = candidates[chosen], left = clamp(p.left, minX, maxX), top = clamp(p.top, minY, maxY);
  const overlaps = intersection({ left, top, ...card }, target) !== null;
  return { left, top, side: chosen, arrow: !overlaps };
}
