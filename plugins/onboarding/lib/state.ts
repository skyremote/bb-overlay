import { z } from "zod";
import { stepIds, type Edition } from "./steps";
export const editionSchema = z.enum(["simple", "pro"]);
export const versionSchema = z.string().min(1).max(32).regex(/^[a-zA-Z0-9._-]+$/);
export const reviewSchema = z.object({ at: z.number().int().nonnegative(), availability: z.enum(["visible", "unavailable"]) });
export const progressSchema = z.object({
  edition: editionSchema, guideVersion: versionSchema,
  status: z.enum(["new", "offered", "active", "paused", "completed"]),
  runId: z.string().max(80), index: z.number().int().nonnegative(),
  reviewed: z.record(z.string(), reviewSchema),
  offeredAt: z.number().nullable(), startedAt: z.number().nullable(), closedAt: z.number().nullable(),
  history: z.object({ firstCompletedAt: z.number().nullable(), lastCompletedAt: z.number().nullable(), completedRuns: z.number().int().nonnegative(), lastUnavailableSteps: z.array(z.string()).max(30) }),
});
export type GuideProgress = z.infer<typeof progressSchema>;
export type Availability = "visible" | "unavailable";
export const actionSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("offer") }), z.object({ kind: z.literal("start") }), z.object({ kind: z.literal("replay") }),
  z.object({ kind: z.literal("close"), runId: z.string().max(80) }),
  z.object({ kind: z.literal("review"), runId: z.string().max(80), stepId: z.string().max(48), checked: z.boolean(), availability: z.enum(["visible", "unavailable"]) }),
  z.object({ kind: z.literal("move"), runId: z.string().max(80), direction: z.enum(["next", "back"]) }),
]);
export type GuideAction = z.infer<typeof actionSchema>;
export function freshProgress(edition: Edition, guideVersion: string): GuideProgress {
  return { edition, guideVersion, status: "new", runId: "", index: 0, reviewed: {}, offeredAt: null, startedAt: null, closedAt: null, history: { firstCompletedAt: null, lastCompletedAt: null, completedRuns: 0, lastUnavailableSteps: [] } };
}
export function parseProgress(raw: unknown, edition: Edition, version: string): GuideProgress {
  const result = progressSchema.safeParse(raw);
  if (!result.success || result.data.edition !== edition || result.data.guideVersion !== version) return freshProgress(edition, version);
  const ids = stepIds(edition), value = result.data;
  return { ...value, index: Math.min(value.index, ids.length - 1), reviewed: Object.fromEntries(Object.entries(value.reviewed).filter(([id]) => ids.includes(id))) };
}
/** Pure policy, shared by the backend and isolated host fixture. No timer can acknowledge a step. */
export function transition(progress: GuideProgress, action: GuideAction, now: number, makeId: () => string): { progress: GuideProgress; offered: boolean } {
  const p = structuredClone(progress), ids = stepIds(p.edition);
  if (action.kind === "offer") {
    if (p.offeredAt !== null || p.status !== "new" || p.history.completedRuns > 0) return { progress: p, offered: false };
    p.offeredAt = now; p.status = "offered";
    return { progress: p, offered: true };
  }
  if (action.kind === "replay") {
    p.runId = makeId(); p.index = 0; p.reviewed = {}; p.startedAt = now; p.closedAt = null; p.offeredAt ??= now; p.status = "active";
    return { progress: p, offered: false };
  }
  if (action.kind === "start") {
    if (p.status !== "completed") { p.runId ||= makeId(); p.startedAt ??= now; p.offeredAt ??= now; p.closedAt = null; p.status = "active"; }
    return { progress: p, offered: false };
  }
  if (action.runId !== p.runId) throw new Error("This guide run changed in another window. Open it again to use the saved progress.");
  if (action.kind === "close") { if (p.status !== "completed") p.status = "paused"; p.closedAt = now; p.offeredAt ??= now; return { progress: p, offered: false }; }
  if (p.status !== "active") throw new Error("Open the guide before reviewing a step.");
  if (action.kind === "review") {
    if (ids[p.index] !== action.stepId) throw new Error("This is not the current guide step. Open the saved progress again.");
    if (action.checked) p.reviewed[action.stepId] = { at: now, availability: action.availability }; else delete p.reviewed[action.stepId];
  } else if (action.direction === "back") {
    p.index = Math.max(0, p.index - 1);
  } else {
    if (!p.reviewed[ids[p.index]!]) throw new Error("Read this step and explicitly tick ‘I’ve read this’ before continuing.");
    if (p.index < ids.length - 1) p.index += 1;
    else {
      if (!ids.every(id => p.reviewed[id])) throw new Error("Every step needs an explicit read check before the guide can finish.");
      p.status = "completed"; p.history.firstCompletedAt ??= now; p.history.lastCompletedAt = now; p.history.completedRuns += 1;
      p.history.lastUnavailableSteps = ids.filter(id => p.reviewed[id]?.availability === "unavailable");
    }
  }
  return { progress: p, offered: false };
}
export const storageKey = (edition: Edition, version: string) => `guide:${edition}:${version}`;
