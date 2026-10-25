// Reading NavMotion project folders (CONTRACT.md). Server-only: node:fs.
//
// Every path that comes out of status.json is untrusted. `safeResolve` is the
// one gate: it resolves symlinks and refuses anything outside the project folder.
import { promises as fs, realpathSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";

export const SLUG_RE = /^[a-z0-9-]{3,60}$/;
export const KINDS = ["deck", "short", "short-dan", "longform", "film"] as const;
export type Kind = (typeof KINDS)[number];
export const STATES = ["todo", "running", "waiting", "done", "failed"] as const;
export const AWAITING = ["storyboard", "covers", "final"] as const;
export type Awaiting = (typeof AWAITING)[number];

export function expandHome(p: string): string {
  if (p === "~") return os.homedir();
  if (p.startsWith("~/")) return path.join(os.homedir(), p.slice(2));
  return p;
}

/** Resolve `rel` inside `projectDir`, following symlinks. Null when it escapes or is missing. */
export function safeResolve(projectDir: string, rel: unknown): string | null {
  if (typeof rel !== "string" || rel === "" || rel.includes("\0")) return null;
  if (path.isAbsolute(rel)) return null;
  let base: string;
  try {
    base = realpathSync(projectDir);
  } catch {
    return null;
  }
  const joined = path.resolve(base, rel);
  if (joined !== base && !joined.startsWith(base + path.sep)) return null;
  let real: string;
  try {
    real = realpathSync(joined);
  } catch {
    return null; // missing file: nothing to serve
  }
  if (real !== base && !real.startsWith(base + path.sep)) return null;
  return real;
}

export function isFile(p: string): boolean {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
}

async function readJson(p: string): Promise<unknown> {
  try {
    return JSON.parse(await fs.readFile(p, "utf8"));
  } catch {
    return null;
  }
}

const obj = (v: unknown): Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
const str = (v: unknown): string | null => (typeof v === "string" ? v : null);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const state = (v: unknown): string => (typeof v === "string" && (STATES as readonly string[]).includes(v) ? v : "todo");

export interface Stage {
  name: string;
  state: string;
  started: string | null;
  finished: string | null;
  summary: string | null;
  log: string | null;
}
export interface Progress {
  stage: string | null;
  film: string | null;
  frame: number;
  of: number;
  started: string | null;
  eta_s: number | null;
}
export interface Gate {
  pass: boolean | null;
  errors: number | null;
  warnings: number | null;
  report: string | null;
}
export interface Film {
  name: string;
  size: string | null;
  duration: number | null;
  storyboard: string | null;
  stills: string[];
  stills_guides: string[];
  gate: Gate | null;
  metrics: Record<string, number | string> | null;
}
export interface Output {
  label: string;
  path: string;
  kind: string;
  bytes: number | null;
}
export interface Cover {
  label: string;
  path: string;
  size: string | null;
  bytes: number | null;
}
export interface Feedback {
  at: string;
  by: string | null;
  via: string | null;
  about: string | null;
  decision: string;
  note: string | null;
}
export interface Project {
  slug: string;
  dir: string;
  title: string;
  kind: string;
  brief: string | null;
  footage: string | null;
  duration: number | null;
  created: string | null;
  deliverTo: string | null;
  updated: string | null;
  stage: string | null;
  state: string;
  awaiting: Awaiting | null;
  stages: Stage[];
  progress: Progress | null;
  films: Film[];
  outputs: Output[];
  covers: Cover[];
  threadId: string | null;
  notes: string[];
  error: string | null;
  feedback: Feedback[];
  /** Paths from status.json that were refused (outside the folder or missing). */
  rejected: string[];
  statusMissing: boolean;
}

function parseStage(v: unknown): Stage | null {
  const o = obj(v);
  const name = str(o.name);
  if (name === null) return null;
  return { name, state: state(o.state), started: str(o.started), finished: str(o.finished), summary: str(o.summary), log: str(o.log) };
}

export async function readFeedback(dir: string): Promise<Feedback[]> {
  let text = "";
  try {
    text = await fs.readFile(path.join(dir, "feedback.jsonl"), "utf8");
  } catch {
    return [];
  }
  const out: Feedback[] = [];
  for (const line of text.split("\n")) {
    if (line.trim() === "") continue;
    try {
      const o = obj(JSON.parse(line));
      const at = str(o.at);
      const decision = str(o.decision);
      if (at === null || decision === null) continue;
      out.push({ at, by: str(o.by), via: str(o.via), about: str(o.about), decision, note: str(o.note) });
    } catch {
      /* skip a torn line */
    }
  }
  return out;
}

export async function readProject(root: string, slug: string): Promise<Project | null> {
  if (!SLUG_RE.test(slug)) return null;
  const dir = path.join(root, slug);
  // The slug folder itself must be a real directory directly under root.
  try {
    const real = realpathSync(dir);
    const realRoot = realpathSync(root);
    if (path.dirname(real) !== realRoot || !statSync(real).isDirectory()) return null;
  } catch {
    return null;
  }
  const manifest = obj(await readJson(path.join(dir, "navmotion.json")));
  const rawStatus = await readJson(path.join(dir, "status.json"));
  const status = obj(rawStatus);
  if (Object.keys(manifest).length === 0 && Object.keys(status).length === 0) return null;
  const rejected: string[] = [];
  const keep = (rel: unknown): string | null => {
    if (rel === null || rel === undefined) return null;
    if (safeResolve(dir, rel) === null) {
      rejected.push(String(rel));
      return null;
    }
    return rel as string;
  };

  const films: Film[] = [];
  for (const f of Array.isArray(status.films) ? status.films : []) {
    const o = obj(f);
    const g = o.gate === null || o.gate === undefined ? null : obj(o.gate);
    const metrics: Record<string, number | string> = {};
    for (const [k, v] of Object.entries(obj(o.metrics))) {
      if (typeof v === "number" || typeof v === "string") metrics[k] = v;
    }
    films.push({
      name: str(o.name) ?? "main",
      size: str(o.size),
      duration: num(o.duration),
      storyboard: keep(o.storyboard),
      stills: (Array.isArray(o.stills) ? o.stills : []).map(keep).filter((x): x is string => x !== null),
      stills_guides: (Array.isArray(o.stills_guides) ? o.stills_guides : []).map(keep).filter((x): x is string => x !== null),
      gate: g === null ? null : { pass: typeof g.pass === "boolean" ? g.pass : null, errors: num(g.errors), warnings: num(g.warnings), report: keep(g.report) },
      metrics: Object.keys(metrics).length > 0 ? metrics : null,
    });
  }
  const outputs: Output[] = [];
  for (const out of Array.isArray(status.outputs) ? status.outputs : []) {
    const o = obj(out);
    const p = keep(o.path);
    if (p === null) continue;
    outputs.push({ label: str(o.label) ?? path.basename(p), path: p, kind: str(o.kind) ?? "file", bytes: num(o.bytes) });
  }
  const pr = status.progress === null || status.progress === undefined ? null : obj(status.progress);
  const progress: Progress | null =
    pr !== null && num(pr.frame) !== null && num(pr.of) !== null && (num(pr.of) ?? 0) > 0
      ? { stage: str(pr.stage), film: str(pr.film), frame: num(pr.frame) ?? 0, of: num(pr.of) ?? 1, started: str(pr.started), eta_s: num(pr.eta_s) }
      : null;
  const awaitingRaw = status.awaiting;
  const awaiting = typeof awaitingRaw === "string" && (AWAITING as readonly string[]).includes(awaitingRaw) ? (awaitingRaw as Awaiting) : null;
  const covers: Cover[] = [];
  for (const c of Array.isArray(status.covers) ? status.covers : []) {
    const o = obj(c);
    const p = keep(o.path);
    if (p === null) continue;
    covers.push({ label: str(o.label) ?? path.basename(p), path: p, size: str(o.size), bytes: num(o.bytes) });
  }
  const threadId = str(status.thread_id) ?? str(manifest.thread_id);
  return {
    slug,
    dir,
    title: str(status.title) ?? str(manifest.title) ?? slug,
    kind: str(status.kind) ?? str(manifest.kind) ?? "unknown",
    brief: str(manifest.brief),
    footage: str(manifest.footage),
    duration: num(manifest.duration),
    created: str(manifest.created),
    deliverTo: str(manifest.deliverTo),
    updated: str(status.updated),
    stage: str(status.stage),
    state: state(status.state),
    awaiting,
    stages: (Array.isArray(status.stages) ? status.stages : []).map(parseStage).filter((s): s is Stage => s !== null),
    progress,
    films,
    outputs,
    covers,
    threadId: threadId !== null && /^thr_[A-Za-z0-9_-]+$/.test(threadId) ? threadId : null,
    notes: (Array.isArray(status.notes) ? status.notes : []).filter((n): n is string => typeof n === "string"),
    error: str(status.error),
    feedback: await readFeedback(dir),
    rejected,
    statusMissing: rawStatus === null,
  };
}

export async function listSlugs(root: string): Promise<string[]> {
  let entries: import("node:fs").Dirent[];
  try {
    entries = await fs.readdir(root, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries.filter((e) => e.isDirectory() && SLUG_RE.test(e.name)).map((e) => e.name).sort();
}

/**
 * The double-click guard (CONTRACT.md): a decision is pending while the newest
 * feedback line is later than status.updated.
 */
export function decisionPending(p: Pick<Project, "feedback" | "updated">): boolean {
  const last = p.feedback[p.feedback.length - 1];
  if (last === undefined) return false;
  const at = Date.parse(last.at);
  const updated = p.updated === null ? Number.NEGATIVE_INFINITY : Date.parse(p.updated);
  if (Number.isNaN(at)) return false;
  return Number.isNaN(updated) || at > updated;
}

/** ISO 8601 with the local UTC offset, seconds precision, like nm.py writes. */
export function localIso(d = new Date()): string {
  const pad = (n: number) => String(Math.trunc(Math.abs(n))).padStart(2, "0");
  const off = -d.getTimezoneOffset();
  const sign = off >= 0 ? "+" : "-";
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}${sign}${pad(off / 60)}:${pad(off % 60)}`;
}

export function slugify(title: string): string {
  const base = title
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "") // drop accents: "déjà" -> "deja"
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48)
    .replace(/-+$/g, "");
  return base.length >= 3 ? base : `project-${base || "new"}`.slice(0, 48);
}

/** `foo-bar`, then `foo-bar-2`, `foo-bar-3` ... until it is free (CONTRACT.md, New flow). */
export function uniqueSlug(title: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  const base = slugify(title);
  if (!used.has(base)) return base;
  for (let i = 2; ; i += 1) {
    const candidate = `${base.slice(0, 60 - String(i).length - 1).replace(/-+$/g, "")}-${i}`;
    if (!used.has(candidate)) return candidate;
  }
}

/** The message sent to the project's thread after a decision (CONTRACT.md, feedback.jsonl). */
export function decisionMessage(slug: string, about: string, decision: "approve" | "changes", note: string, who = "The user"): string {
  if (decision === "approve") {
    const n = note === "" ? "" : ` Note: ${JSON.stringify(note)}.`;
    return `NavMotion Studio: ${who} approved the ${about} for \`${slug}\`.${n} Carry on from where you stopped.`;
  }
  const redo =
    about === "final"
      ? "Make them, render again, and wait again."
      : about === "covers"
        ? "Make them, render the covers again, and wait again."
        : "Make them, rebuild the board, and wait again.";
  return `NavMotion Studio: ${who} asked for changes to the ${about} for \`${slug}\`: ${JSON.stringify(note)}. ${redo}`;
}

export const COVER_ASPECTS = ["9:16", "3:4", "4:5"] as const;
export type CoverAspect = (typeof COVER_ASPECTS)[number];

/** Which of the three cover sizes a WxH string is (nearest ratio), or null. */
export function coverAspect(size: string | null, label = ""): CoverAspect | null {
  const m = size ? /^(\d+)\s*x\s*(\d+)$/.exec(size.trim()) : null;
  if (m) {
    const r = Number(m[1]) / Number(m[2]);
    const targets: [CoverAspect, number][] = [["9:16", 9 / 16], ["3:4", 3 / 4], ["4:5", 4 / 5]];
    const best = targets.reduce((a, b) => (Math.abs(b[1] - r) < Math.abs(a[1] - r) ? b : a));
    return Math.abs(best[1] - r) < 0.03 ? best[0] : null;
  }
  for (const a of COVER_ASPECTS) if (label.includes(a) || label.includes(a.replace(":", "x"))) return a;
  return null;
}

export function coverVersion(p: string): number {
  const m = /_v(\d+)(?:\.[a-z0-9]+)?$/i.exec(p);
  return m ? Number(m[1]) : 0;
}

export interface CoverSet<C> {
  version: number;
  items: (C & { aspect: CoverAspect | null })[];
}

/** Covers grouped by `_vN`, newest version first, each set ordered 9:16, 3:4, 4:5, then anything else. */
export function groupCovers<C extends { path: string; size: string | null; label: string }>(covers: C[]): CoverSet<C>[] {
  const sets = new Map<number, (C & { aspect: CoverAspect | null })[]>();
  for (const c of covers) {
    const v = coverVersion(c.path);
    const list = sets.get(v) ?? [];
    list.push({ ...c, aspect: coverAspect(c.size, c.label) });
    sets.set(v, list);
  }
  const rank = (a: CoverAspect | null) => (a === null ? 99 : COVER_ASPECTS.indexOf(a));
  return [...sets.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([version, items]) => ({ version, items: items.sort((x, y) => rank(x.aspect) - rank(y.aspect)) }));
}

/**
 * Parse an HTTP Range header against a file size.
 * null: no header (serve 200). "invalid": 416. Otherwise inclusive start/end.
 */
export function parseRange(header: string | undefined | null, size: number): null | "invalid" | { start: number; end: number } {
  if (header === undefined || header === null || header.trim() === "") return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (m === null || (m[1] === "" && m[2] === "")) return "invalid";
  let start: number;
  let end: number;
  if (m[1] === "") {
    const n = Number(m[2]);
    if (n === 0) return "invalid";
    start = Math.max(0, size - n);
    end = size - 1;
  } else {
    start = Number(m[1]);
    end = m[2] === "" ? size - 1 : Math.min(Number(m[2]), size - 1);
  }
  if (size === 0 || start > end || start >= size) return "invalid";
  return { start, end };
}
