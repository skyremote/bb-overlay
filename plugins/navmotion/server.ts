// NavMotion Studio — backend.
//
// Reads NavMotion project folders (see ../CONTRACT.md), serves their stills and
// videos to the panel, appends the user's decisions to feedback.jsonl and relays
// them to the project's BB thread, and starts new projects through nm.py.
import { execFile } from "node:child_process";
import { createReadStream, promises as fs, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { randomUUID } from "node:crypto";
import { defineRpcContract, type BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import {
  KINDS,
  SLUG_RE,
  decisionPending,
  expandHome,
  isFile,
  listSlugs,
  localIso,
  readProject,
  AWAITING,
  decisionMessage,
  groupCovers,
  parseRange,
  safeResolve,
  uniqueSlug,
  type Project,
} from "./lib/projects";

export const PROJECTS_CHANGED = "projects-changed";
const DEFAULT_ROOT = "~/NavMotion/projects";
const DEFAULT_SKILL = "~/Documents/GitHub/navmotion/skills/navmotion";
const DEFAULT_BB_PROJECT = "";   // set it in the plugin settings; every machine has its own project id
const DEFAULT_REVIEWER = "The user";

const stageSchema = z.object({
  name: z.string(),
  state: z.string(),
  started: z.string().nullable(),
  finished: z.string().nullable(),
  summary: z.string().nullable(),
  log: z.string().nullable(),
});
const mediaSchema = z.object({ path: z.string(), url: z.string() });
const filmSchema = z.object({
  name: z.string(),
  size: z.string().nullable(),
  duration: z.number().nullable(),
  storyboardUrl: z.string().nullable(),
  stills: z.array(mediaSchema),
  stillsGuides: z.array(mediaSchema),
  gate: z
    .object({ pass: z.boolean().nullable(), errors: z.number().nullable(), warnings: z.number().nullable(), reportUrl: z.string().nullable() })
    .nullable(),
  metrics: z.record(z.string(), z.union([z.number(), z.string()])).nullable(),
});
const feedbackSchema = z.object({
  at: z.string(),
  by: z.string().nullable(),
  via: z.string().nullable(),
  about: z.string().nullable(),
  decision: z.string(),
  note: z.string().nullable(),
});
const progressSchema = z
  .object({ stage: z.string().nullable(), film: z.string().nullable(), frame: z.number(), of: z.number(), started: z.string().nullable(), eta_s: z.number().nullable() })
  .nullable();
const summarySchema = z.object({
  slug: z.string(),
  title: z.string(),
  kind: z.string(),
  stage: z.string().nullable(),
  state: z.string(),
  awaiting: z.enum(AWAITING).nullable(),
  progress: progressSchema,
  updated: z.string().nullable(),
  thumbUrl: z.string().nullable(),
  threadId: z.string().nullable(),
  error: z.string().nullable(),
});
export type ProjectSummary = z.infer<typeof summarySchema>;
const detailSchema = summarySchema.extend({
  brief: z.string().nullable(),
  footage: z.string().nullable(),
  duration: z.number().nullable(),
  created: z.string().nullable(),
  deliverTo: z.string().nullable(),
  stages: z.array(stageSchema),
  films: z.array(filmSchema),
  outputs: z.array(z.object({ label: z.string(), path: z.string(), kind: z.string(), bytes: z.number().nullable(), url: z.string() })),
  notes: z.array(z.string()),
  feedback: z.array(feedbackSchema),
  decisionPending: z.boolean(),
  coverSets: z.array(
    z.object({
      version: z.number(),
      items: z.array(
        z.object({ label: z.string(), path: z.string(), size: z.string().nullable(), bytes: z.number().nullable(), aspect: z.enum(["9:16", "3:4", "4:5"]).nullable(), url: z.string() }),
      ),
    }),
  ),
  rejected: z.array(z.string()),
  statusMissing: z.boolean(),
  folder: z.string(),
});
export type ProjectDetail = z.infer<typeof detailSchema>;

export const rpcContract = defineRpcContract({
  projects_list: {
    input: z.null(),
    output: z.object({ root: z.string(), rootExists: z.boolean(), projects: z.array(summarySchema) }),
  },
  project_get: {
    input: z.object({ slug: z.string() }).strict(),
    output: z.object({ project: detailSchema.nullable() }),
  },
  project_by_thread: {
    input: z.object({ threadId: z.string() }).strict(),
    output: z.object({ slug: z.string().nullable(), title: z.string().nullable() }),
  },
  decide: {
    input: z
      .object({ slug: z.string(), decision: z.enum(["approve", "changes"]), note: z.string().max(4000) })
      .strict(),
    output: z.object({ recorded: z.boolean(), sent: z.boolean(), message: z.string(), warning: z.string().nullable() }),
  },
  create_project: {
    input: z
      .object({
        kind: z.enum(KINDS),
        title: z.string().trim().min(1).max(160),
        brief: z.string().trim().min(1).max(20000),
        footage: z.string().trim().max(1000).optional(),
        duration: z.number().positive().max(7200).optional(),
      })
      .strict(),
    output: z.object({ slug: z.string(), folder: z.string(), threadId: z.string().nullable(), warning: z.string().nullable() }),
  },
  guide_get: {
    input: z.null(),
    output: z.object({ exists: z.boolean(), path: z.string(), content: z.string() }),
  },
});

function run(cmd: string, args: string[], env: NodeJS.ProcessEnv, timeoutMs: number): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    execFile(cmd, args, { env, timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024 }, (err, stdout, stderr) => {
      const code = err === null ? 0 : typeof (err as { code?: unknown }).code === "number" ? ((err as { code: number }).code) : 1;
      resolve({ code, stdout: String(stdout), stderr: String(stderr) || (err?.message ?? "") });
    });
  });
}

const MIME: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".mp4": "video/mp4",
  ".mov": "video/quicktime",
  ".webm": "video/webm",
  ".m4a": "audio/mp4",
  ".wav": "audio/wav",
  ".mp3": "audio/mpeg",
  ".json": "application/json; charset=utf-8",
  ".log": "text/plain; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".html": "text/html; charset=utf-8",
};

export default async function plugin(bb: BbPluginApi) {
  const settings = bb.settings.define({
    projectsRoot: {
      type: "string",
      label: "Projects folder",
      description: "Where NavMotion project folders live (local disk, not the NAS).",
      default: DEFAULT_ROOT,
    },
    skillPath: {
      type: "string",
      label: "Skill folder",
      description: "The navmotion skill. The Studio runs scripts/nm.py from here and shows references/GUIDE.md.",
      default: DEFAULT_SKILL,
    },
    bbProjectId: {
      type: "project",
      label: "BB project for new threads",
      description: "New projects started from the Studio get their agent thread here.",
      default: DEFAULT_BB_PROJECT,
    },
    reviewerName: {
      type: "string",
      label: "Your name",
      description: "How the Studio names you in the messages it sends to the agent (\"Alex approved the storyboard\").",
      default: DEFAULT_REVIEWER,
    },
  });

  const paths = async () => {
    const s = await settings.get();
    return {
      root: path.resolve(expandHome(String(s.projectsRoot || DEFAULT_ROOT))),
      skill: path.resolve(expandHome(String(s.skillPath || DEFAULT_SKILL))),
      bbProjectId: String(s.bbProjectId || DEFAULT_BB_PROJECT),
      reviewer: String(s.reviewerName || DEFAULT_REVIEWER).trim() || DEFAULT_REVIEWER,
    };
  };

  // ---- media URLs ---------------------------------------------------------
  // `<img>` and `<video>` cannot send a bearer token, so media goes through
  // bb.sdk.files.createPreview: a short-lived, path-shaped capability URL
  // confined to the project folder, served by BB itself (works in the desktop
  // app and through sky.getbb.app). One preview per project, renewed early.
  const previews = new Map<string, { baseUrl: string; expiresAtMs: number; root: string }>();
  const PREVIEW_TTL = 60 * 60 * 1000; // BB caps preview TTL at one hour
  async function previewBase(dir: string): Promise<string | null> {
    const hit = previews.get(dir);
    if (hit && hit.expiresAtMs - Date.now() > 20 * 60 * 1000) return hit.baseUrl;
    try {
      const res = await bb.sdk.files.createPreview({ rootPath: dir, ttlMs: PREVIEW_TTL });
      const baseUrl = res.baseUrl.endsWith("/") ? res.baseUrl : `${res.baseUrl}/`;
      previews.set(dir, { baseUrl, expiresAtMs: res.expiresAtMs, root: dir });
      return baseUrl;
    } catch (err) {
      bb.log.warn(`createPreview failed for ${dir}: ${err instanceof Error ? err.message : String(err)}`);
      return null;
    }
  }
  /** The plugin's own Range-capable route, used when previews are unavailable. */
  const routeUrl = (slug: string, rel: string) =>
    `/api/v1/plugins/${bb.pluginId}/http/media?slug=${encodeURIComponent(slug)}&path=${encodeURIComponent(rel)}`;
  async function urlFor(p: Project, rel: string): Promise<string> {
    const base = await previewBase(p.dir);
    if (base === null) return routeUrl(p.slug, rel);
    return base + rel.split("/").map(encodeURIComponent).join("/");
  }

  async function summary(p: Project): Promise<ProjectSummary> {
    // the newest 9:16 cover when there is one; otherwise the middle still (the first is usually the
    // opening frame, a point or a logo; the middle one is the film at rest)
    const cover = groupCovers(p.covers)[0]?.items.find((c) => c.aspect === "9:16")?.path;
    const withStills = p.films.find((f) => f.stills.length > 0);
    const first = cover ?? (withStills ? withStills.stills[Math.floor(withStills.stills.length / 2)] : undefined) ?? p.outputs.find((o) => o.kind === "image")?.path ?? null;
    return {
      slug: p.slug,
      title: p.title,
      kind: p.kind,
      stage: p.stage,
      state: p.state,
      awaiting: p.awaiting,
      progress: p.progress,
      updated: p.updated,
      thumbUrl: first === null ? null : await urlFor(p, first),
      threadId: p.threadId,
      error: p.error,
    };
  }

  async function detail(p: Project): Promise<ProjectDetail> {
    const media = async (rels: string[]) => Promise.all(rels.map(async (r) => ({ path: r, url: await urlFor(p, r) })));
    return {
      ...(await summary(p)),
      brief: p.brief,
      footage: p.footage,
      duration: p.duration,
      created: p.created,
      deliverTo: p.deliverTo,
      stages: p.stages,
      films: await Promise.all(
        p.films.map(async (f) => ({
          name: f.name,
          size: f.size,
          duration: f.duration,
          storyboardUrl: f.storyboard === null ? null : await urlFor(p, f.storyboard),
          stills: await media(f.stills),
          stillsGuides: await media(f.stills_guides),
          gate:
            f.gate === null
              ? null
              : { pass: f.gate.pass, errors: f.gate.errors, warnings: f.gate.warnings, reportUrl: f.gate.report === null ? null : await urlFor(p, f.gate.report) },
          metrics: f.metrics,
        })),
      ),
      // Videos use the plugin's own route: its URL never changes, so renewing a preview link
      // never swaps <video src> under a playing film. Range works there too.
      outputs: await Promise.all(p.outputs.map(async (o) => ({ ...o, url: o.kind === "video" ? routeUrl(p.slug, o.path) : await urlFor(p, o.path) }))),
      coverSets: await Promise.all(
        groupCovers(p.covers).map(async (set) => ({
          version: set.version,
          items: await Promise.all(set.items.map(async (c) => ({ label: c.label, path: c.path, size: c.size, bytes: c.bytes, aspect: c.aspect, url: await urlFor(p, c.path) }))),
        })),
      ),
      notes: p.notes,
      feedback: p.feedback.slice(-20),
      decisionPending: decisionPending(p),
      rejected: p.rejected,
      statusMissing: p.statusMissing,
      folder: p.dir,
    };
  }

  // ---- decisions ----------------------------------------------------------
  const inFlight = new Set<string>();

  bb.rpc.register(rpcContract, {
    async projects_list() {
      const { root } = await paths();
      let rootExists = false;
      try {
        rootExists = statSync(root).isDirectory();
      } catch {
        /* missing */
      }
      const projects: ProjectSummary[] = [];
      for (const slug of await listSlugs(root)) {
        const p = await readProject(root, slug);
        if (p !== null) projects.push(await summary(p));
      }
      projects.sort((a, b) => Number(b.awaiting !== null) - Number(a.awaiting !== null) || (Date.parse(b.updated ?? "") || 0) - (Date.parse(a.updated ?? "") || 0));
      return { root, rootExists, projects };
    },

    async project_get({ slug }) {
      const { root } = await paths();
      const p = await readProject(root, slug);
      return { project: p === null ? null : await detail(p) };
    },

    async project_by_thread({ threadId }) {
      const { root } = await paths();
      for (const slug of await listSlugs(root)) {
        const p = await readProject(root, slug);
        if (p !== null && p.threadId === threadId) return { slug: p.slug, title: p.title };
      }
      return { slug: null, title: null };
    },

    async decide({ slug, decision, note }) {
      const { root } = await paths();
      const trimmed = note.trim();
      if (decision === "changes" && trimmed === "") throw new Error("Say what to change before sending.");
      if (inFlight.has(slug)) throw new Error("A decision for this project is already being sent.");
      inFlight.add(slug);
      try {
        const p = await readProject(root, slug);
        if (p === null) throw new Error(`No project ${slug}.`);
        if (p.awaiting === null) throw new Error("This project is not waiting for a decision.");
        if (decisionPending(p)) throw new Error("Your last decision has not been picked up by the agent yet.");
        const { reviewer } = await paths();
        const line = { at: localIso(), by: reviewer.toLowerCase(), via: "studio", about: p.awaiting, decision, note: trimmed };
        await fs.appendFile(path.join(p.dir, "feedback.jsonl"), `${JSON.stringify(line)}\n`, "utf8");
        bb.realtime.publish(PROJECTS_CHANGED, { slugs: [slug] });
        const message = decisionMessage(slug, p.awaiting, decision, trimmed, reviewer);
        if (p.threadId === null) {
          return { recorded: true, sent: false, message, warning: "Recorded, but this project has no thread linked, so no agent was told." };
        }
        try {
          await bb.sdk.threads.send({ threadId: p.threadId, mode: "auto", input: [{ type: "text", text: message, mentions: [] }] });
          return { recorded: true, sent: true, message, warning: null };
        } catch (err) {
          const why = err instanceof Error ? err.message : String(err);
          bb.log.warn(`threads.send to ${p.threadId} failed: ${why}`);
          return { recorded: true, sent: false, message, warning: `Recorded, but the message to the thread failed: ${why}` };
        }
      } finally {
        inFlight.delete(slug);
      }
    },

    async create_project({ kind, title, brief, footage, duration }) {
      const { root, skill, bbProjectId } = await paths();
      const nm = path.join(skill, "scripts", "nm.py");
      if (!isFile(nm)) throw new Error(`The navmotion skill was not found at ${skill}. Install it and set the Skill folder in NavMotion Studio's settings.`);
      if (bbProjectId === "") throw new Error("Pick the BB project for new threads in NavMotion Studio's settings first.");
      await fs.mkdir(root, { recursive: true });
      let slug = uniqueSlug(title, await listSlugs(root));
      if (!SLUG_RE.test(slug)) throw new Error(`Could not make a valid folder name from "${title}".`);
      const footagePath = footage && footage !== "" ? path.resolve(expandHome(footage)) : null;
      if (footagePath !== null && (kind === "short-dan" || kind === "longform") && !isFile(footagePath)) {
        throw new Error(`Footage not found: ${footagePath}`);
      }
      const briefFile = path.join(os.tmpdir(), `navmotion-brief-${randomUUID()}.txt`);
      await fs.writeFile(briefFile, brief, { encoding: "utf8", mode: 0o600 });
      const env = { ...process.env, NAVMOTION_PROJECTS: root };
      let folder: string;
      try {
        const args = [nm, "new", slug, "--kind", kind, "--title", title, "--brief-file", briefFile];
        if (footagePath !== null && (kind === "short-dan" || kind === "longform")) args.push("--footage", footagePath);
        if (duration !== undefined) args.push("--duration", String(duration));
        const res = await run("python3", args, env, 60_000);
        if (res.code !== 0) throw new Error(`nm.py new failed (${res.code}): ${(res.stderr || res.stdout).trim().slice(-800)}`);
        const last = res.stdout.trim().split("\n").pop()?.trim() ?? "";
        const realRoot = await fs.realpath(root);
        const realFolder = await fs.realpath(last).catch(() => "");
        if (realFolder === "" || path.dirname(realFolder) !== realRoot) throw new Error(`nm.py printed an unexpected folder: ${last}`);
        folder = realFolder;
        slug = path.basename(realFolder);
      } finally {
        await fs.rm(briefFile, { force: true });
      }
      bb.realtime.publish(PROJECTS_CHANGED, { slugs: [slug] });

      // CONTRACT.md wording. Spawn verification decides whether the slash prefix loads the skill.
      const prompt = `/navmotion Work on the NavMotion project at ${folder}. Read navmotion.json for the brief. Use nm.py for every stage so the Studio stays current, and stop at each approval.`;
      let threadId: string | null = null;
      try {
        const thread = await bb.sdk.threads.spawn({
          projectId: bbProjectId,
          environment: { type: "project-default" },
          prompt,
          title: title.startsWith("NavMotion") ? title : `NavMotion: ${title}`,
          pluginMetadata: { slug },
        });
        threadId = thread.id;
      } catch (err) {
        const why = err instanceof Error ? err.message : String(err);
        bb.log.warn(`threads.spawn failed: ${why}`);
        return { slug, folder, threadId: null, warning: `The project folder was made, but the agent thread could not start: ${why}` };
      }
      const link = await run("python3", [nm, "link", slug, "--thread", threadId], env, 30_000);
      bb.realtime.publish(PROJECTS_CHANGED, { slugs: [slug] });
      return {
        slug,
        folder,
        threadId,
        warning: link.code === 0 ? null : `Thread started, but nm.py link failed: ${(link.stderr || link.stdout).trim().slice(-400)}`,
      };
    },

    async guide_get() {
      const { skill } = await paths();
      const guide = path.join(skill, "references", "GUIDE.md");
      try {
        const st = await fs.stat(guide);
        if (!st.isFile() || st.size > 1024 * 1024) throw new Error("not a readable file");
        return { exists: true, path: guide, content: await fs.readFile(guide, "utf8") };
      } catch {
        return { exists: false, path: guide, content: "" };
      }
    },
  });

  // ---- media route (fallback transport, Range-capable) ------------------
  // auth "local": BB's own frontend, same origin. Browser-native <img>/<video>
  // GETs send no Origin header, which "local" accepts.
  bb.http.route("GET", "/media", async (c) => {
    const slug = c.req.query("slug") ?? "";
    const rel = c.req.query("path") ?? "";
    const { root } = await paths();
    if (!SLUG_RE.test(slug)) return c.text("bad slug", 400);
    const dir = path.join(root, slug);
    const file = safeResolve(dir, rel);
    if (file === null || !isFile(file)) return c.text("not found", 404);
    const size = statSync(file).size;
    const type = MIME[path.extname(file).toLowerCase()] ?? "application/octet-stream";
    const headers: Record<string, string> = {
      "content-type": type,
      "accept-ranges": "bytes",
      "cache-control": "private, max-age=60",
      "x-content-type-options": "nosniff",
    };
    if (type.startsWith("text/html")) headers["content-security-policy"] = "sandbox; default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'";
    const range = parseRange(c.req.header("range"), size);
    if (range === "invalid") return new Response(null, { status: 416, headers: { ...headers, "content-range": `bytes */${size}` } });
    if (range !== null) {
      const { start, end } = range;
      const body = Readable.toWeb(createReadStream(file, { start, end })) as unknown as ReadableStream;
      return new Response(body, {
        status: 206,
        headers: { ...headers, "content-range": `bytes ${start}-${end}/${size}`, "content-length": String(end - start + 1) },
      });
    }
    const body = Readable.toWeb(createReadStream(file)) as unknown as ReadableStream;
    return new Response(body, { status: 200, headers: { ...headers, "content-length": String(size) } });
  });

  // ---- live updates -------------------------------------------------------
  // Poll the three contract files' mtimes once a second (a few stat calls per
  // project) and publish a signal when anything changes. Renders write
  // thousands of frames, so a recursive watcher would be far noisier.
  const signatures = new Map<string, string>();
  async function scan(initial = false): Promise<string[]> {
    const { root } = await paths();
    const slugs = await listSlugs(root);
    const changed: string[] = [];
    const seen = new Set<string>();
    for (const slug of slugs) {
      seen.add(slug);
      let sig = "";
      for (const f of ["status.json", "feedback.jsonl", "navmotion.json"]) {
        try {
          const st = await fs.stat(path.join(root, slug, f));
          sig += `${st.mtimeMs}:${st.size};`;
        } catch {
          sig += "-;";
        }
      }
      if (signatures.get(slug) !== sig) {
        if (!initial) changed.push(slug);
        signatures.set(slug, sig);
      }
    }
    for (const slug of [...signatures.keys()]) {
      if (!seen.has(slug)) {
        signatures.delete(slug);
        changed.push(slug);
      }
    }
    return changed;
  }
  bb.background.service("watch-projects", {
    async start(signal) {
      await scan(true).catch(() => []);
      while (!signal.aborted) {
        await new Promise<void>((resolve) => {
          const t = setTimeout(resolve, 1000);
          signal.addEventListener("abort", () => {
            clearTimeout(t);
            resolve();
          }, { once: true });
        });
        if (signal.aborted) break;
        try {
          const changed = await scan();
          if (changed.length > 0) bb.realtime.publish(PROJECTS_CHANGED, { slugs: changed });
        } catch (err) {
          bb.log.warn(`scan failed: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    },
  });

  settings.onChange(() => {
    signatures.clear();
    previews.clear();
    bb.realtime.publish(PROJECTS_CHANGED, { slugs: [] });
  });

  bb.onDispose(() => {
    previews.clear();
    signatures.clear();
  });
}
