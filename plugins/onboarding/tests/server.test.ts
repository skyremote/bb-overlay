import { afterEach, describe, expect, it } from "vitest";
import { createFakePluginHost, experimental_scanPublicSdkOnly } from "@get-bb/plugin-sdk/testing";
import { fileURLToPath } from "node:url";
import plugin from "../server";
import type { GuideSnapshot } from "../guide";
const hosts: ReturnType<typeof createFakePluginHost>[] = [];
async function make(settings: Record<string, string | boolean> = {}) { const host = createFakePluginHost({ pluginId: "bb-overlay-guide", settings }); hosts.push(host); await plugin(host.bb); return host; }
afterEach(async () => { for (const h of hosts.splice(0)) await h.harness.lifecycle.dispose(); });
describe("guide backend contract", () => {
  it("defaults autoStart off and registers no background services, account calls or navigation", async () => {
    const h = await make(); const s = await h.harness.behavior.callRpc("snapshot") as GuideSnapshot;
    expect(s).toMatchObject({ edition: "pro", autoStart: false, guideVersion: "1", progress: { status: "new" } });
    expect(h.harness.registrations.services).toEqual([]); expect(h.harness.inspection.sdk.calls).toEqual([]);
    const result = await h.harness.behavior.callRpc("update", { edition: "pro", guideVersion: "1", action: { kind: "offer" } }) as { offered: boolean };
    expect(result.offered).toBe(false);
  });
  it("serialises concurrent offers so only one client receives an auto-offer", async () => {
    const h = await make({ autoStart: true }); const input = { edition: "pro", guideVersion: "1", action: { kind: "offer" } };
    const results = await Promise.all([h.harness.behavior.callRpc("update", input), h.harness.behavior.callRpc("update", input)]) as { offered: boolean }[];
    expect(results.map(r => r.offered).sort()).toEqual([false, true]);
  });
  it("re-read config keeps edition and guide-version progress independent", async () => {
    const h = await make();
    const p = await h.harness.behavior.callRpc("update", { edition: "pro", guideVersion: "1", action: { kind: "start" } }) as GuideSnapshot;
    await h.harness.behavior.callRpc("update", { edition: "pro", guideVersion: "1", action: { kind: "review", runId: p.progress.runId, stepId: "navigation", checked: true, availability: "visible" } });
    await h.harness.behavior.setSettings({ edition: "simple" });
    expect((await h.harness.behavior.callRpc("snapshot") as GuideSnapshot).progress.reviewed).toEqual({});
    await h.harness.behavior.setSettings({ edition: "pro" });
    expect((await h.harness.behavior.callRpc("snapshot") as GuideSnapshot).progress.reviewed.navigation).toBeTruthy();
    await h.harness.behavior.setSettings({ guideVersion: "2" });
    expect((await h.harness.behavior.callRpc("snapshot") as GuideSnapshot).progress.reviewed).toEqual({});
  });
  it("rejects stale config, invalid version and forged Next at the wire boundary", async () => {
    const h = await make();
    await expect(h.harness.behavior.callRpc("update", { edition: "simple", guideVersion: "1", action: { kind: "start" } })).rejects.toThrow(/configured guide changed/);
    await expect(h.harness.behavior.setSettings({ guideVersion: "../unsafe" })).rejects.toThrow();
    const s = await h.harness.behavior.callRpc("update", { edition: "pro", guideVersion: "1", action: { kind: "start" } }) as GuideSnapshot;
    await expect(h.harness.behavior.callRpc("update", { edition: "pro", guideVersion: "1", action: { kind: "move", runId: s.progress.runId, direction: "next" } })).rejects.toThrow(/explicitly tick/);
  });
  it("uses only public SDK surfaces", async () => {
    const scan = await experimental_scanPublicSdkOnly(fileURLToPath(new URL("../", import.meta.url)), { allow: [/^react(?:-dom)?(?:\/client)?$/, /^@testing-library\/react$/, /^vitest\/config$/, /^esbuild$/] });
    expect(scan.violations).toEqual([]); expect(scan.privateDependencies).toEqual([]);
  });
});
