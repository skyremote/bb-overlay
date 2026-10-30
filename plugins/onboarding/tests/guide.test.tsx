// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GuideView, type GuideSnapshot } from "../guide";
import { freshProgress, transition } from "../lib/state";
const props = () => ({ snapshot: { edition: "simple" as const, guideVersion: "1", autoStart: false, progress: transition(freshProgress("simple", "1"), { kind: "start" }, 1, () => "run").progress }, phase: "tour" as const, busy: false, error: null, onAction: vi.fn(), onClose: vi.fn() });
beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function () { this.open = true; }; HTMLDialogElement.prototype.close = function () { this.open = false; };
  vi.stubGlobal("requestAnimationFrame", (fn: FrameRequestCallback) => setTimeout(() => fn(0), 1)); vi.stubGlobal("cancelAnimationFrame", clearTimeout);
  document.body.innerHTML = '<button id="trigger">Open guide</button><button data-bb-overlay-tour="project">Project</button>';
  document.querySelector('[data-bb-overlay-tour]')!.getBoundingClientRect = () => ({ x: 20, y: 80, left: 20, top: 80, right: 220, bottom: 120, width: 200, height: 40, toJSON: () => ({}) });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.useRealTimers(); });
describe("coach-mark UI", () => {
  it("focuses the heading, blocks Next, and sends an explicit checked acknowledgement", async () => {
    const p = props(); render(<GuideView {...p} />);
    await waitFor(() => expect(screen.getByRole('checkbox').hasAttribute('disabled')).toBe(false));
    expect(document.activeElement?.id).toBe('bbog-title'); expect((screen.getByRole('button', { name: 'Next' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('checkbox'));
    expect(p.onAction).toHaveBeenCalledWith({ kind: 'review', runId: 'run', stepId: 'project', checked: true, availability: 'visible' });
    expect(p.onAction).toHaveBeenCalledTimes(1);
  });
  it("Back revisits a saved read check and Replay never acknowledges a step", async () => {
    const p = props(); p.snapshot.progress.reviewed.project = { at: 2, availability: 'visible' }; render(<GuideView {...p} />);
    await waitFor(() => expect((screen.getByRole('button', { name: 'Next' }) as HTMLButtonElement).disabled).toBe(false));
    expect((screen.getByRole('checkbox') as HTMLInputElement).checked).toBe(true); expect(p.onAction).not.toHaveBeenCalled();
  });
  it("offers an unavailable explanation without a spotlight and never checks itself", async () => {
    document.querySelector('[data-bb-overlay-tour]')!.remove();
    const p = props(); render(<GuideView {...p} />);
    await screen.findByText('This control isn’t visible here.', {}, { timeout: 2500 });
    expect(document.querySelector('[data-testid="guide-spotlight"]')).toBeNull();
    expect((screen.getByRole('checkbox') as HTMLInputElement).checked).toBe(false); expect(p.onAction).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('checkbox')); expect(p.onAction).toHaveBeenCalledWith(expect.objectContaining({ availability: 'unavailable', checked: true }));
  });
  it("removes a spotlight when a mobile ancestor becomes hidden, then recovers the real target", async () => {
    const target = document.querySelector('[data-bb-overlay-tour]')!;
    const sidebar = document.createElement('aside'); target.before(sidebar); sidebar.append(target);
    const p = props(); render(<GuideView {...p} />);
    await waitFor(() => expect(document.querySelector('[data-testid="guide-spotlight"]')).not.toBeNull());
    sidebar.style.opacity = '0'; window.dispatchEvent(new Event('resize'));
    await waitFor(() => expect(document.querySelector('[data-testid="guide-spotlight"]')).toBeNull());
    expect(p.onAction).not.toHaveBeenCalled();
    sidebar.style.opacity = '1'; window.dispatchEvent(new Event('resize'));
    await waitFor(() => expect(document.querySelector('[data-testid="guide-spotlight"]')).not.toBeNull());
  });
  it("reacts to native mobile sidebar inert/data-state changes even when geometry stays positive", async () => {
    const target = document.querySelector('[data-bb-overlay-tour]')!;
    const sidebar = document.createElement('div'); target.before(sidebar); sidebar.append(target); sidebar.dataset.state = 'open';
    const p = props(); render(<GuideView {...p} />);
    await waitFor(() => expect(document.querySelector('[data-testid="guide-spotlight"]')).not.toBeNull());
    sidebar.dataset.state = 'closed'; sidebar.setAttribute('inert', '');
    await waitFor(() => expect(document.querySelector('[data-testid="guide-spotlight"]')).toBeNull());
    expect(p.onAction).not.toHaveBeenCalled();
    sidebar.removeAttribute('inert'); sidebar.dataset.state = 'open';
    await waitFor(() => expect(document.querySelector('[data-testid="guide-spotlight"]')).not.toBeNull());
  });
  it("Escape closes, unmount restores previous focus and removes its overlay", () => {
    const trigger = document.getElementById('trigger')!; trigger.focus(); const p = props(); const r = render(<GuideView {...p} />);
    fireEvent.keyDown(window, { key: 'Escape' }); expect(p.onClose).toHaveBeenCalledTimes(1); r.unmount(); expect(document.activeElement).toBe(trigger); expect(document.querySelector('[data-bb-overlay-guide-root]')).toBeNull();
  });
  it("completion communicates unavailable controls and preserves an explicit replay action", () => {
    const p = props(); p.snapshot.progress.history.lastUnavailableSteps = ['cache-clock']; render(<GuideView {...p} phase="completed" />);
    expect(screen.getByText(/1 controls were unavailable/)).toBeTruthy(); fireEvent.click(screen.getByRole('button', { name: 'Replay guide' })); expect(p.onAction).toHaveBeenCalledWith({ kind: 'replay' });
  });
});
