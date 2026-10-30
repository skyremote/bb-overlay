// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useEffect } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GuideSnapshot } from "../guide";
import { freshProgress, transition, type GuideAction } from "../lib/state";
const runtime = vi.hoisted(() => ({ call: vi.fn(), values: { edition: "pro", autoStart: false, guideVersion: "1" }, signals: new Map<string, () => void>() }));
vi.mock("@get-bb/plugin-sdk/app", () => ({
  definePluginApp: (setup: unknown) => setup,
  useRpc: () => ({ call: runtime.call }),
  useSettings: () => ({ values: runtime.values }),
  useRealtime: (channel: string, callback: () => void) => { useEffect(() => { runtime.signals.set(channel, callback); return () => { if (runtime.signals.get(channel) === callback) runtime.signals.delete(channel); }; }, [channel, callback]); },
}));
import { GuideController, OPEN_EVENT, REPLAY_EVENT } from "../app";
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
let current: GuideSnapshot, serial = 0, blockKind: string | null, gate: ReturnType<typeof deferred<void>> | null;
let snapshotRead: () => Promise<GuideSnapshot>;
const calls: { edition: string; action: GuideAction }[] = [];
const emit = (name: string) => act(() => { window.dispatchEvent(new CustomEvent(name)); });
async function startVisible() { emit(OPEN_EVENT); await screen.findByRole("heading", { name: "Find your way around" }); await waitFor(() => expect((screen.getByRole("checkbox") as HTMLInputElement).disabled).toBe(false)); }
beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function () { this.open = true; }; HTMLDialogElement.prototype.close = function () { this.open = false; };
  vi.stubGlobal("requestAnimationFrame", (fn: FrameRequestCallback) => setTimeout(() => fn(0), 1)); vi.stubGlobal("cancelAnimationFrame", clearTimeout);
  document.body.innerHTML = '<nav data-testid="app-nav-rail">Navigation</nav><button data-bb-overlay-tour="project">Simple project</button>';
  document.querySelectorAll<HTMLElement>('nav, button').forEach(element => { element.getBoundingClientRect = () => ({ left: 20, top: 60, width: 100, height: 100, right: 120, bottom: 160, x: 20, y: 60, toJSON: () => ({}) }); });
  current = { edition: "pro", guideVersion: "1", autoStart: false, progress: freshProgress("pro", "1") };
  runtime.values = { edition: "pro", autoStart: false, guideVersion: "1" }; runtime.signals.clear(); runtime.call.mockReset();
  serial = 0; blockKind = null; gate = null; calls.length = 0;
  snapshotRead = async () => structuredClone(current);
  runtime.call.mockImplementation(async (method: string, input?: { edition: "simple" | "pro"; guideVersion: string; action: GuideAction }) => {
    if (method === "snapshot") return snapshotRead();
    if (!input) throw Error("missing input");
    calls.push(structuredClone(input));
    if (blockKind === input.action.kind) { blockKind = null; gate = deferred<void>(); await gate.promise; }
    const result = transition(current.progress, input.action, Date.now(), () => `run-${++serial}`);
    current = { ...current, progress: result.progress };
    return { ...structuredClone(current), offered: result.offered };
  });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
describe("controller deferred-response races", () => {
  it.each(["start", "review", "move", "replay"] as const)("closing during delayed %s stays closed and pauses the returned run", async kind => {
    if (kind === "start") { current.autoStart = true; runtime.values.autoStart = true; }
    render(<GuideController />);
    if (kind === "start") { await screen.findByRole("button", { name: "Start guide" }); blockKind = "start"; fireEvent.click(screen.getByRole("button", { name: "Start guide" })); }
    else {
      await startVisible();
      if (kind === "move") { fireEvent.click(screen.getByRole("checkbox")); await waitFor(() => expect((screen.getByRole("button", { name: "Next" }) as HTMLButtonElement).disabled).toBe(false)); }
      blockKind = kind;
      if (kind === "review") fireEvent.click(screen.getByRole("checkbox"));
      else if (kind === "move") fireEvent.click(screen.getByRole("button", { name: "Next" }));
      else emit(REPLAY_EVENT);
    }
    await waitFor(() => expect(gate).not.toBeNull());
    fireEvent.click(screen.getByRole("button", { name: "Close guide and save progress" }));
    expect(document.querySelector("dialog[open]")).toBeNull();
    await act(async () => { gate!.resolve(); await gate!.promise; });
    await waitFor(() => expect(current.progress.status).toBe("paused"));
    expect(current.progress.runId).not.toBe("");
    expect(calls.at(-1)?.action).toEqual({ kind: "close", runId: current.progress.runId });
    expect(document.querySelector("dialog[open]")).toBeNull();
    if (kind === "review") expect(current.progress.reviewed.navigation).toBeTruthy();
    if (kind === "move") expect(current.progress.index).toBe(1);
    act(() => runtime.signals.get("guide-changed")?.());
    await act(async () => { await Promise.resolve(); });
    expect(document.querySelector("dialog[open]")).toBeNull();
  });
  it("a deliberate reopen waits for pause and is not hidden by a late close response", async () => {
    render(<GuideController />); await startVisible(); blockKind = "review"; fireEvent.click(screen.getByRole("checkbox")); await waitFor(() => expect(gate).not.toBeNull());
    fireEvent.click(screen.getByRole("button", { name: "Close guide and save progress" })); emit(OPEN_EVENT);
    await act(async () => { gate!.resolve(); await gate!.promise; });
    await screen.findByRole("heading", { name: "Find your way around" });
    await waitFor(() => expect(current.progress.status).toBe("active"));
    expect(calls.slice(-3).map(call => call.action.kind)).toEqual(["review", "close", "start"]);
    expect(document.querySelector("dialog[open]")).not.toBeNull();
  });
  it("an old Simple snapshot cannot overwrite a newer configured Pro snapshot", async () => {
    const old = deferred<GuideSnapshot>(); let reads = 0;
    const simple: GuideSnapshot = { edition: "simple", guideVersion: "1", autoStart: false, progress: freshProgress("simple", "1") };
    runtime.values = { edition: "simple", autoStart: false, guideVersion: "1" };
    snapshotRead = () => ++reads === 1 ? old.promise : Promise.resolve(structuredClone(current));
    const rendered = render(<GuideController />); await waitFor(() => expect(reads).toBe(1));
    runtime.values = { edition: "pro", autoStart: false, guideVersion: "1" }; rendered.rerender(<GuideController />);
    await waitFor(() => expect(reads).toBe(2));
    await act(async () => { old.resolve(simple); await old.promise; });
    await startVisible();
    expect(calls.at(-1)?.edition).toBe("pro"); expect(screen.queryByRole("heading", { name: "Keep work in the right project" })).toBeNull();
  });
  it("a delayed close response cannot invalidate a newer configured-edition read", async () => {
    render(<GuideController />); await startVisible();
    const original = runtime.call.getMockImplementation()!;
    const closeReply = deferred<void>(), configuredRead = deferred<GuideSnapshot>(); let closing = false, reading = false;
    runtime.call.mockImplementation(async (method: string, input?: { edition: "simple" | "pro"; guideVersion: string; action: GuideAction }) => {
      const response = await original(method, input);
      if (method === "update" && input?.action.kind === "close") { closing = true; await closeReply.promise; }
      return response;
    });
    fireEvent.click(screen.getByRole("button", { name: "Close guide and save progress" }));
    await waitFor(() => expect(closing).toBe(true));
    current = { edition: "simple", guideVersion: "1", autoStart: false, progress: freshProgress("simple", "1") };
    snapshotRead = () => { reading = true; return configuredRead.promise; };
    act(() => runtime.signals.get("guide-configured")?.()); await waitFor(() => expect(reading).toBe(true));
    await act(async () => { closeReply.resolve(); await closeReply.promise; });
    await act(async () => { configuredRead.resolve(structuredClone(current)); await configuredRead.promise; });
    emit(OPEN_EVENT); await screen.findByRole("heading", { name: "Keep work in the right project" });
    expect(calls.at(-1)?.edition).toBe("simple");
  });
  it("a stale same-edition load cannot overwrite a newer read acknowledgement", async () => {
    render(<GuideController />); await startVisible();
    const old = deferred<GuideSnapshot>(), saved = structuredClone(current);
    snapshotRead = () => old.promise;
    act(() => runtime.signals.get("guide-changed")?.());
    fireEvent.click(screen.getByRole("checkbox"));
    await waitFor(() => expect(current.progress.reviewed.navigation).toBeTruthy());
    await act(async () => { old.resolve(saved); await old.promise; });
    expect((screen.getByRole("checkbox") as HTMLInputElement).checked).toBe(true);
  });
  it("review response delayed before close cannot supersede a config read started during that wait", async () => {
    render(<GuideController />); await startVisible();
    const original = runtime.call.getMockImplementation()!;
    const reviewReply = deferred<void>(), configuredRead = deferred<GuideSnapshot>(); let reviewing = false, reading = false;
    runtime.call.mockImplementation(async (method: string, input?: { edition: "simple" | "pro"; guideVersion: string; action: GuideAction }) => {
      const response = await original(method, input);
      if (method === "update" && input?.action.kind === "review") { reviewing = true; await reviewReply.promise; }
      return response;
    });
    fireEvent.click(screen.getByRole("checkbox")); await waitFor(() => expect(reviewing).toBe(true));
    fireEvent.click(screen.getByRole("button", { name: "Close guide and save progress" }));
    current = { edition: "simple", guideVersion: "1", autoStart: false, progress: freshProgress("simple", "1") };
    snapshotRead = () => { reading = true; return configuredRead.promise; };
    act(() => runtime.signals.get("guide-configured")?.()); await waitFor(() => expect(reading).toBe(true));
    await act(async () => { reviewReply.resolve(); await reviewReply.promise; });
    await act(async () => { configuredRead.resolve(structuredClone(current)); await configuredRead.promise; });
    emit(OPEN_EVENT); await waitFor(() => expect(calls.at(-1)?.action.kind).toBe("start"));
    expect(calls.at(-1)?.edition).toBe("simple");
  });

});
