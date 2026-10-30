// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { findTarget, intersection, placeCard } from "../lib/anchors";
import { STEPS } from "../lib/steps";
const rect = (left: number, top: number, width: number, height: number) => ({ left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON: () => ({}) });
afterEach(() => { document.body.innerHTML = ""; });
describe("real-target resolution and bounded placement", () => {
  it("accepts Simple’s explicit marker and refuses two matching visible controls", () => {
    document.body.innerHTML = '<button data-bb-overlay-tour="project">Project</button>';
    const first = document.querySelector('button')!; first.getBoundingClientRect = () => rect(20, 80, 200, 40);
    expect(findTarget(STEPS.simple[0]!)?.element).toBe(first);
    const other = first.cloneNode(true) as HTMLElement; other.getBoundingClientRect = first.getBoundingClientRect; document.body.append(other);
    expect(findTarget(STEPS.simple[0]!)).toBeNull();
  });
  it("ignores hidden controls and anything inside the guide itself", () => {
    document.body.innerHTML = '<div data-bb-overlay-guide-root><button data-bb-overlay-tour="project">Wrong</button></div><button hidden data-bb-overlay-tour="project">Hidden</button>';
    document.querySelectorAll('button').forEach(b => { b.getBoundingClientRect = () => rect(20, 80, 200, 40); });
    expect(findTarget(STEPS.simple[0]!)).toBeNull();
  });
  it.each(["display:none", "visibility:hidden", "opacity:0", "content-visibility:hidden"])("rejects a control with positive geometry inside a hidden ancestor: %s", style => {
    document.body.innerHTML = `<aside style="${style}"><button data-bb-overlay-tour="project">Hidden project</button></aside>`;
    document.querySelector('button')!.getBoundingClientRect = () => rect(20, 80, 200, 40);
    expect(findTarget(STEPS.simple[0]!)).toBeNull();
  });
  it("rejects the exact native closed mobile sidebar's explicit inert ancestor", () => {
    document.body.innerHTML = '<div class="group fixed z-0" data-state="closed" inert><button data-bb-overlay-tour="project">Project</button></div>';
    const button = document.querySelector('button')!;
    button.getBoundingClientRect = () => rect(64, 134, 200, 40);
    expect(findTarget(STEPS.simple[0]!)).toBeNull();
    document.querySelector('div')!.removeAttribute('inert');
    expect(findTarget(STEPS.simple[0]!)).not.toBeNull(); // data-state alone is not treated as hidden.
  });
  it("honours the native visibility check for skipped rendering", () => {
    document.body.innerHTML = '<button data-bb-overlay-tour="project">Project</button>';
    const button = document.querySelector('button')!;
    button.getBoundingClientRect = () => rect(20, 80, 200, 40);
    button.checkVisibility = () => false;
    expect(findTarget(STEPS.simple[0]!)).toBeNull();
  });
  it("uses the actual native BB rail attribute as a Pro fallback", () => {
    document.body.innerHTML = '<div data-testid="app-nav-rail"></div>';
    const target = document.querySelector('div')!; target.getBoundingClientRect = () => rect(0, 70, 48, 600);
    expect(findTarget(STEPS.pro[0]!)?.element).toBe(target);
  });
  it.each([
    ["helper-desk", '<button class="hd-header-button" aria-label="Open Helper Desk history">Desk</button>'],
    ["helper-desk", '<span data-nav-rail-item="helper-desk/agents">Agents</span>'],
    ["cache-clock", '<span data-nav-rail-item="cache-clock/cache">Cache</span>'],
    ["screen-share", '<span data-nav-rail-item="screen-share/screen-share">Share</span>'],
    ["reflect", '<div class="rf-card" aria-label="Reflect: save a lasting rule">Rule</div>'],
    ["side-chat", '<button title="Start side chat">Side chat</button>'],
    ["tabs", '<div data-nav-tabs><div aria-label="Open chats">Existing tabs</div></div>'],
    ["settings", '<div data-testid="sidebar-footer-body"><button aria-label="Settings (Cmd+,)">Settings</button></div>'],
  ])("resolves current public/private control %s without a generic fallback", (id, html) => {
    document.body.innerHTML = html;
    document.querySelectorAll<HTMLElement>('button, span, div').forEach(element => { element.getBoundingClientRect = () => rect(20, 80, 200, 40); });
    const step = STEPS.pro.find(candidate => candidate.id === id)!;
    expect(findTarget(step)).not.toBeNull();
  });
  it("clamps a mobile card and removes arrows when a target is unavailable", () => {
    const p = placeCard({ left: 12, top: 740, width: 360, height: 80 }, { width: 366, height: 430 }, { left: 0, top: 0, width: 390, height: 844 }, "right");
    expect(p.left).toBeGreaterThanOrEqual(12); expect(p.left + 366).toBeLessThanOrEqual(378); expect(p.top + 430).toBeLessThanOrEqual(832);
    expect(placeCard(null, { width: 366, height: 430 }, { left: 0, top: 0, width: 390, height: 844 }, "right").arrow).toBe(false);
    expect(intersection({ left: 0, top: 0, width: 50, height: 50 }, { left: 60, top: 60, width: 10, height: 10 })).toBeNull();
  });
});
