// Pure path helpers shared by the frontend (what looks like a path) and the
// server (how a relative name is resolved). No Node or DOM imports here.

export type PathKind = "absolute" | "home" | "relative";

export interface Classified {
  kind: PathKind;
  value: string;
}

const MAX_LEN = 600;
// Characters that mean "this is a command, glob or snippet", not a path.
const NOT_A_PATH = /[\n\r\t*$`|<>"{}]|:\/\/|^-|\s--?\w/;
const BARE_EXTENSION = /^\.[A-Za-z0-9]{1,8}$/;
const HAS_EXTENSION = /[^./\s]\.[A-Za-z0-9]{1,8}\/?$/;

/** Decide whether an inline-code text could be a file or folder path. */
export function classify(raw: string): Classified | null {
  const value = raw.trim();
  if (value.length < 2 || value.length > MAX_LEN) return null;
  if (NOT_A_PATH.test(value)) return null;
  if (value.startsWith("~/")) return { kind: "home", value };
  if (value.startsWith("/")) {
    if (value.startsWith("//")) return null;
    return { kind: "absolute", value };
  }
  if (BARE_EXTENSION.test(value)) return null;
  // Relative: must contain a folder separator or end in a file extension.
  // The server only marks it clickable if the file really exists.
  if (value.includes("/") || HAS_EXTENSION.test(value)) return { kind: "relative", value };
  return null;
}

/** Bundles that `open` would launch rather than show: always reveal these instead. */
export function isBundle(path: string): boolean {
  return /\.(app|bundle|framework|pkg|mpkg|plugin|kext|prefPane|appex|xpc)\/?$/i.test(path);
}

export interface MirrorPair {
  a: string;
  b: string;
}

/** Parse "A = B" lines (either direction is tried). Blank and # lines are skipped. */
export function parseMirrors(text: string, home: string): MirrorPair[] {
  const out: MirrorPair[] = [];
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const m = /^(.+?)\s*(?:=|=>|<=>|<->)\s*(.+)$/.exec(t);
    if (!m) continue;
    const a = expandHome(stripSlash(m[1]!.trim()), home);
    const b = expandHome(stripSlash(m[2]!.trim()), home);
    if (a.startsWith("/") && b.startsWith("/") && a !== b) out.push({ a, b });
  }
  return out;
}

export function stripSlash(p: string): string {
  return p.length > 1 ? p.replace(/\/+$/, "") : p;
}

export function expandHome(p: string, home: string): string {
  if (p === "~") return home;
  return p.startsWith("~/") ? home + p.slice(1) : p;
}

/** Join without Node's path module; collapses "./" and refuses to climb above root. */
export function joinPath(base: string, rel: string): string {
  const parts = (stripSlash(base) + "/" + rel).split("/");
  const out: string[] = [];
  for (const part of parts) {
    if (part === "" || part === ".") continue;
    if (part === "..") {
      out.pop();
      continue;
    }
    out.push(part);
  }
  return "/" + out.join("/");
}

/** The same path under each mirror root it sits beneath (e.g. a local copy <-> a network share). */
export function mirrorsOf(path: string, mirrors: MirrorPair[]): string[] {
  const out: string[] = [];
  for (const { a, b } of mirrors) {
    for (const [from, to] of [
      [a, b],
      [b, a],
    ] as const) {
      if (path === from || path.startsWith(from + "/")) out.push(to + path.slice(from.length));
    }
  }
  return out;
}

/**
 * Every absolute path to try, in order, for one candidate text.
 * Relative names are tried against the folders mentioned earlier in the same
 * message (most recent first), then the thread's working folder; each of those
 * is also tried under its mirror root.
 */
export function candidatePaths(
  text: string,
  bases: string[],
  workspace: string | null,
  mirrors: MirrorPair[],
  home: string,
): string[] {
  const c = classify(text);
  if (!c) return [];
  const direct: string[] = [];
  if (c.kind === "absolute") direct.push(stripSlash(c.value));
  else if (c.kind === "home") direct.push(stripSlash(expandHome(c.value, home)));
  else {
    const roots = [...bases.slice().reverse(), ...(workspace ? [workspace] : [])];
    for (const root of roots) direct.push(joinPath(expandHome(root, home), c.value));
  }
  const all: string[] = [];
  for (const p of direct) {
    all.push(p);
    all.push(...mirrorsOf(p, mirrors));
  }
  return [...new Set(all)];
}
