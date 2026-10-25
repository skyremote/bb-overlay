// @vitest-environment jsdom
// The panel through the official frontend harness: registrations, the Projects
// grid, the covers section and the decision buttons' guard.
import { describe, expect, it } from "vitest";
import { fireEvent } from "@testing-library/react";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";

const summary = (slug: string, extra: Record<string, unknown> = {}) => ({
  slug,
  title: `Film ${slug}`,
  kind: "short",
  stage: "render",
  state: "running",
  awaiting: null,
  progress: null,
  updated: "2026-10-25T10:00:00+01:00",
  thumbUrl: null,
  threadId: null,
  error: null,
  ...extra,
});

const detail = (extra: Record<string, unknown> = {}) => ({
  ...summary("cov-proj", { awaiting: "covers", threadId: "thr_1" }),
  brief: "b",
  footage: null,
  duration: null,
  created: null,
  deliverTo: null,
  stages: [{ name: "covers", state: "waiting", started: null, finished: null, summary: null, log: null }],
  films: [],
  outputs: [],
  notes: [],
  feedback: [],
  decisionPending: false,
  coverSets: [
    { version: 2, items: ["9:16", "3:4", "4:5"].map((aspect) => ({ label: `Cover ${aspect}`, path: `covers/c_${aspect}_v2.png`, size: null, bytes: 10, aspect, url: `/u/${aspect}/v2` })) },
    { version: 1, items: [{ label: "Cover 9:16", path: "covers/c_9x16_v1.png", size: null, bytes: 10, aspect: "9:16", url: "/u/9:16/v1" }] },
  ],
  rejected: [],
  statusMissing: false,
  folder: "/tmp/cov-proj",
  ...extra,
});

describe("NavMotion Studio app", async () => {
  const app = await loadPluginApp(() => import("@/app"));

  it("registers one nav panel with fixed tabs and a thread panel action", () => {
    expect(app.navPanels.map((p) => p.path)).toEqual(["studio"]);
    expect(app.navPanels[0].fixedTabs?.map((t) => t.title)).toEqual(["Guide", "New"]);
    expect(app.threadPanelActions.map((a) => a.title)).toEqual(["NavMotion"]);
  });

  it("shows project cards, awaiting badge first, and opens a project", async () => {
    const slot = renderSlot(app.navPanels[0], { subPath: "" }, {
      rpc: {
        projects_list: () => ({ root: "/r", rootExists: true, projects: [summary("waiting-one", { awaiting: "storyboard" }), summary("other-one", { progress: { stage: "render", film: "main", frame: 50, of: 100, started: null, eta_s: 120 } })] }),
      },
    });
    expect(await slot.findByText("Film waiting-one")).toBeTruthy();
    expect(slot.getByText("Awaiting you: storyboard")).toBeTruthy();
    expect(slot.getByText("render 50%")).toBeTruthy();
    fireEvent.click(slot.getByText("Film other-one"));
    expect(slot.inspection.navigateCalls.at(-1)).toMatchObject({ method: "toPluginPanel", path: "studio", options: { subPath: "p/other-one" } });
    slot.lifecycle.unmount();
  });

  it("shows covers newest first with older versions collapsed", async () => {
    const slot = renderSlot(app.navPanels[0], { subPath: "p/cov-proj" }, { rpc: { project_get: () => ({ project: detail() }) } });
    expect(await slot.findByText("Version 2 (newest)")).toBeTruthy();
    expect(slot.container.querySelectorAll("figure[data-aspect]")).toHaveLength(3);
    expect(Array.from(slot.container.querySelectorAll("figure[data-aspect]")).map((f) => f.getAttribute("data-aspect"))).toEqual(["9:16", "3:4", "4:5"]);
    fireEvent.click(slot.getByText("Show 1 older version"));
    expect(slot.container.querySelectorAll("figure[data-aspect]")).toHaveLength(4);
    expect(slot.getByText("The covers are ready for your decision.")).toBeTruthy();
    slot.lifecycle.unmount();
  });

  it("locks Approve while a decision is pending", async () => {
    const slot = renderSlot(app.navPanels[0], { subPath: "p/cov-proj" }, {
      rpc: {
        project_get: () => ({
          project: detail({ decisionPending: true, feedback: [{ at: "2026-10-25T10:00:05+01:00", by: "daniel", via: "studio", about: "covers", decision: "approve", note: "go" }] }),
        }),
      },
    });
    const approve = (await slot.findByText("Approve")).closest("button") as HTMLButtonElement;
    expect(approve.disabled).toBe(true);
    expect(slot.getByText(/Waiting for the agent to pick it up/)).toBeTruthy();
    slot.lifecycle.unmount();
  });
});
