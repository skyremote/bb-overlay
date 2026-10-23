// bb-plugin-finder-links backend. Resolves the paths the frontend found in chat
// replies (only paths that really exist become clickable) and shows them in
// Finder on this Mac.
import { execFile } from "node:child_process";
import { stat } from "node:fs/promises";
import { homedir } from "node:os";
import { defineRpcContract, type BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { candidatePaths, isBundle, parseMirrors, type MirrorPair } from "./lib/paths";

const text = z.string().min(1).max(600);

export const itemSchema = z.object({
  key: z.string().min(1).max(64),
  /** Texts to try in order (an inline-code span, or a broken link's path then its label). */
  candidates: z.array(text).min(1).max(3),
  /** Folders mentioned earlier in the same message, in document order. */
  bases: z.array(text).max(12),
});

export const resolvedSchema = z.object({
  key: z.string(),
  path: z.string().nullable(),
  isDir: z.boolean(),
  hostId: z.string().nullable(),
});
export type Resolved = z.infer<typeof resolvedSchema>;

export const rpcContract = defineRpcContract({
  resolve: {
    input: z.object({
      threadId: z.string().regex(/^thr_[a-zA-Z0-9_-]+$/).nullable(),
      items: z.array(itemSchema).max(80),
    }),
    output: z.object({ results: z.array(resolvedSchema) }),
  },
  reveal: {
    input: z.object({ path: z.string().startsWith("/").max(1200) }),
    output: z.object({ ok: z.boolean(), error: z.string().optional() }),
  },
});

const STAT_TIMEOUT_MS = 1500; // an unreachable network share must not freeze the batch
const HIT_TTL_MS = 5 * 60_000;
const MISS_TTL_MS = 20_000;

type StatHit = { isDir: boolean } | null;

export default async function plugin(bb: BbPluginApi) {
  const home = homedir();
  const settings = bb.settings.define({
    mirrors: {
      type: "string",
      label: "Mirror folders",
      description:
        "Optional. One pair per line, 'folder = other folder', e.g. '~/Local copy = /Volumes/Share'. A path that is missing under one side is tried under the other, handy when you keep a local copy of a network share.",
      experimental_multiline: true,
      default: "",
    },
  });

  const statCache = new Map<string, { at: number; hit: StatHit }>();
  async function statQuick(p: string): Promise<StatHit> {
    const cached = statCache.get(p);
    if (cached && Date.now() - cached.at < (cached.hit ? HIT_TTL_MS : MISS_TTL_MS)) return cached.hit;
    const hit = await Promise.race<StatHit>([
      stat(p).then(
        (s) => ({ isDir: s.isDirectory() }),
        () => null,
      ),
      new Promise<StatHit>((r) => setTimeout(() => r(null), STAT_TIMEOUT_MS)),
    ]);
    statCache.set(p, { at: Date.now(), hit });
    if (statCache.size > 4000) statCache.delete(statCache.keys().next().value!);
    return hit;
  }

  let primaryHostId: string | null | undefined;
  async function primaryHost(): Promise<string | null> {
    if (primaryHostId === undefined) {
      try {
        primaryHostId = (await bb.sdk.system.config()).primaryHostId ?? null;
      } catch {
        return null;
      }
    }
    return primaryHostId;
  }

  /** The thread's working folder, only when it lives on this Mac. */
  const workspaceCache = new Map<string, { at: number; path: string | null }>();
  async function workspaceOf(threadId: string | null): Promise<string | null> {
    if (!threadId) return null;
    const cached = workspaceCache.get(threadId);
    if (cached && Date.now() - cached.at < HIT_TTL_MS) return cached.path;
    let path: string | null = null;
    try {
      const thread = await bb.sdk.threads.get({ threadId });
      const envId = (thread as { environmentId?: string | null }).environmentId;
      if (envId) {
        const env = await bb.sdk.environments.get({ environmentId: envId });
        const local = await primaryHost();
        if (env.path && (!local || env.hostId === local)) path = env.path;
      }
    } catch (err) {
      bb.log.warn(`finder-links: no workspace for ${threadId}: ${String(err)}`);
    }
    workspaceCache.set(threadId, { at: Date.now(), path });
    return path;
  }

  async function mirrors(): Promise<MirrorPair[]> {
    const { mirrors: text } = await settings.get();
    return parseMirrors(typeof text === "string" ? text : "", home);
  }

  bb.rpc.register(rpcContract, {
    resolve: async ({ threadId, items }) => {
      const [workspace, pairs, hostId] = await Promise.all([workspaceOf(threadId), mirrors(), primaryHost()]);
      const results = await Promise.all(
        items.map(async (item): Promise<Resolved> => {
          for (const candidate of item.candidates) {
            const paths = candidatePaths(candidate, item.bases, workspace, pairs, home).slice(0, 24);
            const hits = await Promise.all(paths.map(statQuick));
            const i = hits.findIndex((h) => h !== null);
            if (i >= 0) return { key: item.key, path: paths[i]!, isDir: hits[i]!.isDir, hostId };
          }
          return { key: item.key, path: null, isDir: false, hostId };
        }),
      );
      return { results };
    },

    reveal: async ({ path }) => {
      statCache.delete(path);
      const hit = await statQuick(path);
      if (!hit) return { ok: false, error: "That file is no longer there." };
      // Folders open as a Finder window; files (and app bundles, which `open` would launch) are selected in theirs.
      const args = hit.isDir && !isBundle(path) ? ["-a", "Finder", path] : ["-R", path];
      return new Promise((resolve) => {
        execFile("/usr/bin/open", args, { timeout: 10_000 }, (err) => {
          if (err) {
            bb.log.warn(`finder-links: open ${args.join(" ")} failed: ${err.message}`);
            resolve({ ok: false, error: "Finder could not open it." });
          } else resolve({ ok: true });
        });
      });
    },
  });
}
