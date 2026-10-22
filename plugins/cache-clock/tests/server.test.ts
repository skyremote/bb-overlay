import { it, expect } from "vitest";
import { createFakePluginHost, makeThreadResponse, experimental_scanPublicSdkOnly } from "@get-bb/plugin-sdk/testing";
import plugin from "../server";

function host(status = "idle", providerId = "claude-code") {
  const sends: unknown[] = [];
  const { bb, harness } = createFakePluginHost({
    pluginId: "cache-clock",
    sdk: {
      threads: {
        get: async () => makeThreadResponse({ id: "thr_test", status, providerId } as never),
        context: async () => ({ usage: { estimated: true, modelContextWindow: 1_000_000, usedTokens: 214_000 } }),
        events: { list: async () => [{ createdAt: Date.now() - 1000, type: "turn/completed" }] },
        send: async (args: unknown) => { sends.push(args); return { ok: true, delivery: "sent" }; },
        output: async () => ({ output: "Here it is.\n<handoff>\n## Goal\nShip the clock\n</handoff>" }),
      },
    } as never,
  });
  return { bb, harness, sends };
}

it("reports warm status for a Claude Code thread", async () => {
  const { bb, harness } = host();
  await plugin(bb);
  const s = (await harness.behavior.callRpc("status", { threadId: "thr_test" })) as { supported: boolean; usedTokens: number; expiresAt: number; ttlMinutes: number };
  expect(s.supported).toBe(true);
  expect(s.usedTokens).toBe(214_000);
  expect(s.ttlMinutes).toBe(60);
  expect(s.expiresAt).toBeGreaterThan(Date.now());
  await expect(harness.behavior.callRpc("status", { threadId: "../bad" })).rejects.toThrow();
  await harness.lifecycle.dispose();
});

it("marks other providers unsupported", async () => {
  const { bb, harness } = host("idle", "codex");
  await plugin(bb);
  const s = (await harness.behavior.callRpc("status", { threadId: "thr_test" })) as { supported: boolean };
  expect(s.supported).toBe(false);
  await harness.lifecycle.dispose();
});

it("sends the handoff request as a plugin submission and does not spawn", async () => {
  const { bb, harness, sends } = host();
  await plugin(bb);
  const s = (await harness.behavior.callRpc("requestHandoff", { threadId: "thr_test" })) as { handoff: { status: string } };
  expect(s.handoff.status).toBe("requested");
  expect(sends).toHaveLength(1);
  expect(JSON.stringify(sends[0])).toContain("<handoff>");
  expect(JSON.stringify(sends[0])).toContain('"pluginId":"cache-clock"');
  expect(harness.inspection.sdk.callsTo("threads.spawn")).toEqual([]);
  await harness.lifecycle.dispose();
});

it("uses public plugin contracts only", async () => {
  const r = await experimental_scanPublicSdkOnly(process.cwd(), { allow: [/^react$/, /^@testing-library\/react$/] });
  expect(r.violations).toEqual([]);
  expect(r.privateDependencies).toEqual([]);
});

it("collects the brief from the latest output even when the turn never goes idle", async () => {
  const { bb, harness } = host("active");
  await plugin(bb);
  await harness.behavior.callRpc("requestHandoff", { threadId: "thr_test" });
  const realNow = Date.now;
  Date.now = () => realNow() + 5000;
  try {
    const s = (await harness.behavior.callRpc("status", { threadId: "thr_test" })) as { handoff: { status: string; brief: string } };
    expect(s.handoff.status).toBe("ready");
    expect(s.handoff.brief).toBe("## Goal\nShip the clock");
  } finally {
    Date.now = realNow;
  }
  await harness.lifecycle.dispose();
});
