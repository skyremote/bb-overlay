// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, waitFor } from "@testing-library/react";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import type { PluginBrowserBbSdk, PluginThreadListProps } from "@get-bb/plugin-sdk/app";
import { displayThreads, statusLabel, threadTarget, windowRange } from "../model";
import { openGuide } from "../app";
import { project, thread } from "./fixtures";

const props: PluginThreadListProps = { activeThreadId: "thread-one", activeProjectId: project.id, isCompactViewport: false, onNavigate: vi.fn(), searchQuery: "" };
beforeEach(() => {
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", { configurable: true, value() { this.open = true; } });
  Object.defineProperty(HTMLDialogElement.prototype, "close", { configurable: true, value() { this.open = false; } });
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });

async function rail(options: Parameters<typeof renderSlot<PluginThreadListProps>>[2] = {}) {
  const app = await loadPluginApp(() => import("../app"));
  return renderSlot(app.threadLists[0]!, props, { pluginId: "navaigate-simple", sidebarThreads: { status: "ready", projects: [project], threads: [thread()] }, ...options });
}

describe("lean registration contract", () => {
  it("only replaces the chat list and adds settings; leaves native conversation and navigation alone", async () => {
    const app = await loadPluginApp(() => import("../app"));
    expect(app.threadLists.map(slot => slot.id)).toEqual(["rail"]);
    expect(app.settingsSections.map(slot => slot.id)).toEqual(["workspace"]);
    expect(app.navPanels).toHaveLength(0);
    expect(app.experimentalSidebarNavigations).toHaveLength(0);
    expect(app.appOverlays).toHaveLength(0);
    expect(app.contentScripts).toHaveLength(0);
  });
});

describe("real host interactions", () => {
  it("opens the existing thread and closes the host's compact drawer", async () => {
    const slot = await rail();
    fireEvent.click(slot.getByRole("link", { name: "Review the interface, claude, Ready" }));
    expect(slot.inspection.navigateCalls).toContainEqual({ method: "toThread", threadId: "thread-one" });
    expect(props.onNavigate).toHaveBeenCalledOnce();
  });
  it("uses the native composer with the selected project, never spawns a fake chat", async () => {
    const slot = await rail();
    fireEvent.click(slot.getByRole("button", { name: "New chat" }));
    expect(slot.inspection.navigateCalls).toContainEqual({ method: "toCompose", options: { projectId: project.id, focusPrompt: true } });
    expect(props.onNavigate).toHaveBeenCalledOnce();
    expect(slot.inspection.sdkCalls).toHaveLength(0);
  });
  it("changes project through native navigation", async () => {
    const second = { ...project, id: "project-two", name: "Second project" };
    const slot = await rail({ sidebarThreads: { projects: [project, second], threads: [thread()] } });
    fireEvent.change(slot.getByLabelText("Project"), { target: { value: second.id } });
    expect(slot.inspection.navigateCalls).toContainEqual({ method: "toProject", projectId: second.id });
    expect(props.onNavigate).toHaveBeenCalledOnce();
  });
  it("filters live data and offers an empty-state recovery", async () => {
    const slot = await rail();
    fireEvent.change(slot.getByRole("searchbox", { name: "Filter chats" }), { target: { value: "missing words" } });
    expect(slot.getByText("No chats match.")).toBeTruthy();
    fireEvent.click(slot.getByRole("button", { name: "Clear filter" }));
    expect(slot.getByText("Review the interface")).toBeTruthy();
  });
  it("renders loading, connection failure and first-use states honestly", async () => {
    const loading = await rail({ sidebarThreads: { status: "loading" } });
    expect(loading.getByText("Loading chats…")).toBeTruthy(); loading.lifecycle.unmount();
    const failed = await rail({ sidebarThreads: { status: "error" } });
    expect(failed.getByRole("alert").textContent).toContain("Chats could not load."); failed.lifecycle.unmount();
    const empty = await rail({ sidebarThreads: { threads: [] } });
    expect(empty.getByText("A clear place to start.")).toBeTruthy();
  });
  it("windows a large real list and supports keyboard movement to its end", async () => {
    const threads = Array.from({ length: 1200 }, (_, i) => thread({ id: `t-${i}`, displayTitle: `Chat ${i}`, updatedAt: 1200 - i }));
    const slot = await rail({ sidebarThreads: { projects: [project], threads } });
    expect(slot.getAllByRole("listitem").length).toBeLessThan(30);
    fireEvent.keyDown(slot.getByRole("list"), { key: "End" });
    await waitFor(() => expect(document.activeElement?.getAttribute("data-simple-thread")).toBe("t-1199"));
    expect(slot.getAllByRole("listitem").length).toBeLessThan(30);
  });
  it("keeps only inert guide events and native Appearance links in owned help controls", async () => {
    const resume = vi.fn(), replay = vi.fn(); window.addEventListener("bb-overlay-guide:open", resume); window.addEventListener("bb-overlay-guide:replay", replay);
    openGuide(); openGuide(true); expect(resume).toHaveBeenCalledOnce(); expect(replay).toHaveBeenCalledOnce();
    window.removeEventListener("bb-overlay-guide:open", resume); window.removeEventListener("bb-overlay-guide:replay", replay);
    const slot = await rail(); expect(slot.getByRole("link", { name: "Appearance" }).getAttribute("href")).toBe("/settings/appearance");
  });
});

describe("sidebar policy", () => {
  it("never exposes internal or archived chats, preserves pinned order and filters by project", () => {
    const list = [thread({ id: "internal", isHidden: true }), thread({ id: "archived", isArchived: true }), thread({ id: "other", projectId: "different" }), thread({ id: "recent", updatedAt: 100 }), thread({ id: "pinned", isPinned: true, updatedAt: 1 })];
    expect(displayThreads(list, [project], project.id, "").map(value => value.id)).toEqual(["pinned", "recent"]);
  });
  it("uses truthful state and does not guess a model or provider", () => {
    expect(statusLabel(thread({ hasPendingInteraction: true, status: "active" }))).toBe("Needs your input");
    expect(statusLabel(thread({ runtimeStatus: "waiting-for-host" }))).toBe("Waiting for machine");
    expect(threadTarget(thread({ environment: { id: null, name: null, branchName: null, path: null, isWorktree: null, providerId: null, workspaceDisplayKind: null } })).environment).toBeNull();
  });
  it("bounds virtual rows at either end", () => {
    expect(windowRange(1200, 0, 480)).toEqual({ start: 0, end: 14 });
    expect(windowRange(5, 100000, 480).end).toBe(5);
  });
});


type PluginEntry = Awaited<ReturnType<PluginBrowserBbSdk["plugins"]["list"]>>["plugins"][number];
type PluginMutation = Awaited<ReturnType<PluginBrowserBbSdk["plugins"]["disable"]>>;
// Deliberately narrow view fixtures. Native-host acceptance verifies the complete
// wire catalogue; this component only consumes the public id and status fields.
const installed = (id: string, status: PluginEntry["status"]) => ({ id, status }) as PluginEntry;

describe("real helper settings", () => {
  async function settings(sdk: NonNullable<Parameters<typeof renderSlot>[2]>["sdk"]) {
    const app = await loadPluginApp(() => import("../app"));
    return renderSlot(app.settingsSections[0]!, {}, { sdk });
  }
  it("does not invent enabled tools or switches for missing plugins", async () => {
    const slot = await settings({ plugins: { list: async () => ({ plugins: [] }) } });
    await slot.findAllByText("Not installed");
    expect(slot.queryAllByRole("switch")).toHaveLength(0);
    expect(slot.queryByRole("button", { name: "Open BB Overlay guide" })).toBeNull();
    expect(slot.getByRole("link", { name: "Open guide settings" }).getAttribute("href")).toBe("/settings/plugins/bb-overlay-guide");
  });
  it("recovers an unavailable plugin catalogue without claiming the tools are off", async () => {
    let attempts = 0;
    const slot = await settings({ plugins: { list: async () => { if (!attempts++) throw new Error("offline"); return { plugins: [] }; } } });
    await slot.findByRole("alert"); expect(slot.queryAllByText("Not installed")).toHaveLength(0);
    fireEvent.click(slot.getByRole("button", { name: "Try again" }));
    await slot.findAllByText("Not installed"); expect(attempts).toBe(2);
  });
  it("disables the real selected plugin through the public SDK and reflects its returned state", async () => {
    const slot = await settings({ plugins: {
      list: async () => ({ plugins: [installed("helper-desk", "running")] }),
      disable: async () => ({ id: "helper-desk", status: "disabled" }) as PluginMutation,
    } });
    const toggle = await slot.findByRole("switch", { name: "Turn off Helper Desk" });
    fireEvent.click(toggle);
    await slot.findByText("Disabled");
    expect(slot.inspection.sdkCalls).toContainEqual({ method: "plugins.disable", args: [{ pluginId: "helper-desk" }] });
    expect(slot.getByRole("switch", { name: "Turn on Helper Desk" }).getAttribute("aria-checked")).toBe("false");
  });
  it("keeps the prior visible setting when a plugin mutation fails", async () => {
    const slot = await settings({ plugins: {
      list: async () => ({ plugins: [installed("screen-share", "running")] }),
      disable: async () => { throw new Error("failed"); },
    } });
    fireEvent.click(await slot.findByRole("switch", { name: "Turn off Screen Share" }));
    expect((await slot.findByRole("alert")).textContent).toContain("previous setting has been kept");
    expect(slot.getByRole("switch", { name: "Turn off Screen Share" }).getAttribute("aria-checked")).toBe("true");
  });
  it("offers separate guide resume and deliberate replay only when the guide is running", async () => {
    const resume = vi.fn(), replay = vi.fn();
    window.addEventListener("bb-overlay-guide:open", resume); window.addEventListener("bb-overlay-guide:replay", replay);
    const slot = await settings({ plugins: { list: async () => ({ plugins: [installed("bb-overlay-guide", "running")] }) } });
    fireEvent.click(await slot.findByRole("button", { name: "Open BB Overlay guide" }));
    await waitFor(() => expect(resume).toHaveBeenCalledOnce());
    fireEvent.click(slot.getByRole("button", { name: "Replay guide" })); expect(replay).toHaveBeenCalledOnce();
    window.removeEventListener("bb-overlay-guide:open", resume); window.removeEventListener("bb-overlay-guide:replay", replay);
  });
});
