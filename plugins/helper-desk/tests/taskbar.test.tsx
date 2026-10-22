// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "@testing-library/react";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import type { DeskSnapshot } from "../model";

const T0 = new Date(2026, 9, 22, 15, 0, 0).getTime();
function snap(endedAgo: number): DeskSnapshot {
  const ended = T0 - endedAgo;
  const agent = (id: string, colour: number) => ({ id, name: id, agentType: "general-purpose", model: "Sonnet 5.5", state: "finished" as const, background: true, startedAt: ended - 30_000, finishedAt: ended, tokens: 50_000, steps: 3, stepLabel: "Done · 3 steps", details: [], progress: 1, colour, summary: "", parentId: null });
  return { threadId: "thr_test", title: "Second batch", turnKey: "thr_test:5", agents: [agent("Clock checker", 0), agent("Folder lister", 1)], todos: [], cost: null, subagentTokens: 100_000, startedAt: ended - 30_000, endedAt: ended, running: false, todosUpdatedAt: null, lead: { label: "Lead", model: "Opus 5.5", state: "waiting" as const, activity: "Waiting for you", contextUsed: 88000, contextPct: 9, costUsd: 1.2, costEstimated: true }, updatedAt: T0 };
}

afterEach(() => vi.useRealTimers());

describe("taskbar auto-hide in the real component", () => {
  it("shows the finished batch, fades at the delay, then disappears", async () => {
    vi.useFakeTimers({ now: T0, toFake: ["Date", "setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
    const app = await loadPluginApp(() => import("../app"));
    const banner = app.composerCustomizations[0]!.banners![0]!;
    const slot = renderSlot(banner, {}, { rpc: { snapshot: () => snap(2000) }, composer: { scope: { kind: "thread", threadId: "thr_test" } }, settings: { autoHide: true, hideDelaySeconds: 8 } });
    await act(async () => { await vi.advanceTimersByTimeAsync(50); });
    expect(slot.container.querySelector(".hd-taskbar")).toBeTruthy();
    expect(slot.container.querySelector(".hd-tb-leaving")).toBeNull();
    await act(async () => { await vi.advanceTimersByTimeAsync(6100); }); // 8.15 s after the batch ended
    expect(slot.container.querySelector(".hd-tb-leaving")).toBeTruthy();
    await act(async () => { await vi.advanceTimersByTimeAsync(700); });
    expect(slot.container.querySelector(".hd-taskbar")).toBeNull();
    slot.lifecycle.unmount();
  });
  it("stays when auto-hide is switched off", async () => {
    vi.useFakeTimers({ now: T0, toFake: ["Date", "setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
    const app = await loadPluginApp(() => import("../app"));
    const banner = app.composerCustomizations[0]!.banners![0]!;
    const slot = renderSlot(banner, {}, { rpc: { snapshot: () => ({ ...snap(2000), threadId: "thr_off" }) }, composer: { scope: { kind: "thread", threadId: "thr_off" } }, settings: { autoHide: false, hideDelaySeconds: 8 } });
    await act(async () => { await vi.advanceTimersByTimeAsync(20_000); });
    expect(slot.container.querySelector(".hd-taskbar")).toBeTruthy();
    slot.lifecycle.unmount();
  });
});
