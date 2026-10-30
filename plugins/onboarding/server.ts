import { randomUUID } from "node:crypto";
import { defineRpcContract, type BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { actionSchema, editionSchema, parseProgress, progressSchema, storageKey, transition, versionSchema } from "./lib/state";
import type { Edition } from "./lib/steps";
const snapshotSchema = z.object({ edition: editionSchema, guideVersion: versionSchema, autoStart: z.boolean(), progress: progressSchema });
export const rpcContract = defineRpcContract({
  snapshot: { input: z.null(), output: snapshotSchema },
  update: { input: z.object({ edition: editionSchema, guideVersion: versionSchema, action: actionSchema }), output: snapshotSchema.extend({ offered: z.boolean() }) },
});
export default function plugin(bb: BbPluginApi) {
  const settings = bb.settings.define({
    edition: { type: "select", label: "Edition", options: ["simple", "pro"], default: "pro", description: "Choose the guide for your existing workspace. This changes only the guide." },
    autoStart: { type: "boolean", label: "Offer the guide once", default: false, description: "Offer this edition and guide version once. Dismissed, paused and completed guides do not reopen on updates." },
    guideVersion: { type: "string", label: "Guide version", default: "1", experimental_schema: versionSchema, description: "Progress is saved separately for each edition and guide version." },
  });
  let queue: Promise<unknown> = Promise.resolve();
  async function config() { const cfg = await settings.get(); return { edition: editionSchema.parse(cfg.edition) as Edition, guideVersion: versionSchema.parse(cfg.guideVersion), autoStart: cfg.autoStart }; }
  async function snapshot() { const cfg = await config(); return { ...cfg, progress: parseProgress(await bb.storage.kv.get(storageKey(cfg.edition, cfg.guideVersion)), cfg.edition, cfg.guideVersion) }; }
  bb.rpc.register(rpcContract, {
    snapshot: () => snapshot(),
    update: input => {
      // Serialise read-modify-write so two connected windows cannot lose an acknowledgement or offer twice.
      const job = queue.then(async () => {
        const cfg = await config();
        if (input.edition !== cfg.edition || input.guideVersion !== cfg.guideVersion) throw new Error("The configured guide changed. Open it again to load the correct edition.");
        const old = parseProgress(await bb.storage.kv.get(storageKey(cfg.edition, cfg.guideVersion)), cfg.edition, cfg.guideVersion);
        if (input.action.kind === "offer" && !cfg.autoStart) return { ...cfg, progress: old, offered: false };
        const result = transition(old, input.action, Date.now(), randomUUID);
        await bb.storage.kv.set(storageKey(cfg.edition, cfg.guideVersion), result.progress);
        bb.realtime.publish("guide-changed", { edition: cfg.edition, guideVersion: cfg.guideVersion });
        return { ...cfg, ...result };
      });
      queue = job.catch(() => undefined);
      return job;
    },
  });
  settings.onChange(() => bb.realtime.publish("guide-configured", {}));
}
