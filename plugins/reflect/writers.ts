// Reflect save targets. Append-only, idempotent writes: a section of a voice
// or style profile (markdown), the global CLAUDE.md, and an optional
// "second brain" command. Every file is backed up once per plugin session
// before the first write.
import { execFile } from "node:child_process";
import { copyFile, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { basename, dirname } from "node:path";
import { normaliseRule } from "./detector";

export type SaveTarget = "voice" | "claude" | "brain";

export interface SaveResult {
  target: SaveTarget;
  /** "saved" when written, "exists" when the same rule was already there. */
  status: "saved" | "exists";
  /** Human-facing place, for the toast: "~/.claude/CLAUDE.md, under Rules from corrections". */
  where: string;
  /** Extra line for the toast (push failure, sync note). */
  note: string | null;
}

export const DEFAULT_VOICE_SECTION = "Rules from corrections";
export const RULES_HEADING_TEXT = "## Rules from corrections";

export function today(now = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function tildePath(path: string, home = process.env.HOME ?? ""): string {
  return home && path.startsWith(home) ? "~" + path.slice(home.length) : path;
}

/** Range [start, end) of a markdown section body: from after its heading to the next "## " heading or EOF. */
function sectionRange(lines: string[], headingIndex: number): [number, number] {
  let end = lines.length;
  for (let i = headingIndex + 1; i < lines.length; i++) {
    if (/^##\s/.test(lines[i])) {
      end = i;
      break;
    }
  }
  return [headingIndex + 1, end];
}

function sectionContainsRule(lines: string[], start: number, end: number, rule: string): boolean {
  const target = normaliseRule(rule);
  if (!target) return false;
  for (let i = start; i < end; i++) {
    if (normaliseRule(lines[i]).includes(target)) return true;
  }
  return false;
}

/** Insert `block` lines at the end of the section, keeping one blank line before the next heading. */
function insertAtSectionEnd(lines: string[], start: number, end: number, block: string[]): string[] {
  let insertAt = end;
  while (insertAt > start && lines[insertAt - 1].trim() === "") insertAt--;
  const before = lines.slice(0, insertAt);
  const after = lines.slice(insertAt, end).filter((l) => l.trim() !== "");
  const rest = lines.slice(end);
  const out = [...before, ...block, ...after];
  if (rest.length > 0) out.push("");
  return [...out, ...rest];
}

/** Pure: return the profile text with the rule appended to the "## <section>" section, or null if already present. */
export function appendToProfileSection(content: string, section: string, rule: string, date: string): string | null {
  const name = section.trim() || DEFAULT_VOICE_SECTION;
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  const wanted = name.toLowerCase();
  let headingIndex = lines.findIndex((l) => /^##\s/.test(l) && l.replace(/^##\s+/, "").trim().toLowerCase().startsWith(wanted));
  if (headingIndex === -1) {
    while (lines.length && lines[lines.length - 1].trim() === "") lines.pop();
    lines.push("", `## ${name}`, "");
    headingIndex = lines.length - 2;
  }
  const [start, end] = sectionRange(lines, headingIndex);
  if (sectionContainsRule(lines, start, end, rule)) return null;
  const next = insertAtSectionEnd(lines, start, end, [`- ${rule} (added ${date} via Reflect)`]);
  return next.join("\n").replace(/\n*$/, "\n");
}

/** Pure: return the new CLAUDE.md text with the rule under "## Rules from corrections", or null if already present. */
export function appendToRulesSection(content: string, rule: string, date: string): string | null {
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  let headingIndex = lines.findIndex((l) => l.trim().toLowerCase() === RULES_HEADING_TEXT.toLowerCase());
  if (headingIndex === -1) {
    while (lines.length && lines[lines.length - 1].trim() === "") lines.pop();
    lines.push("", RULES_HEADING_TEXT, "");
    headingIndex = lines.length - 2;
  }
  const [start, end] = sectionRange(lines, headingIndex);
  if (sectionContainsRule(lines, start, end, rule)) return null;
  const next = insertAtSectionEnd(lines, start, end, [`- ${rule} (added ${date} via Reflect)`]);
  return next.join("\n").replace(/\n*$/, "\n");
}

export interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

export type Runner = (file: string, args: string[], cwd?: string) => Promise<RunResult>;

export const runCommand: Runner = (file, args, cwd) =>
  new Promise((resolve) => {
    execFile(
      file,
      args,
      { cwd, timeout: 60_000, maxBuffer: 1024 * 1024, env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } },
      (error, stdout, stderr) => {
        const code = error ? (typeof (error as { code?: unknown }).code === "number" ? ((error as { code: number }).code) : 1) : 0;
        resolve({ code, stdout: String(stdout ?? ""), stderr: String(stderr ?? (error?.message ?? "")) });
      },
    );
  });

export class Writers {
  private backedUp = new Set<string>();

  constructor(
    private readonly backupDir: string,
    private readonly run: Runner = runCommand,
    private readonly now: () => Date = () => new Date(),
  ) {}

  private async backupOnce(path: string): Promise<void> {
    if (this.backedUp.has(path)) return;
    try {
      await stat(path);
    } catch {
      this.backedUp.add(path);
      return;
    }
    await mkdir(this.backupDir, { recursive: true });
    const stamp = this.now().toISOString().replace(/[:.]/g, "-");
    await copyFile(path, `${this.backupDir}/${basename(path)}.${stamp}`);
    this.backedUp.add(path);
  }

  private async readOrEmpty(path: string): Promise<string> {
    try {
      return await readFile(path, "utf8");
    } catch {
      return "";
    }
  }

  async saveVoice(path: string, section: string, rule: string, commitFile: boolean, push: boolean): Promise<SaveResult> {
    const name = section.trim() || DEFAULT_VOICE_SECTION;
    const where = `${tildePath(path)}, under ${name}`;
    const content = await this.readOrEmpty(path);
    if (!content) throw new Error(`Voice profile not found at ${tildePath(path)}`);
    const next = appendToProfileSection(content, name, rule, today(this.now()));
    if (next === null) return { target: "voice", status: "exists", where, note: "Already in your profile." };
    await this.backupOnce(path);
    await writeFile(path, next, "utf8");
    if (!commitFile) return { target: "voice", status: "saved", where, note: null };

    const repo = dirname(path);
    const inRepo = await this.run("git", ["-C", repo, "rev-parse", "--show-toplevel"]);
    if (inRepo.code !== 0) return { target: "voice", status: "saved", where, note: "Not a git repo, so nothing was committed." };
    const top = inRepo.stdout.trim();
    const rel = path.startsWith(top + "/") ? path.slice(top.length + 1) : basename(path);
    const subject = `Reflect: ${rule}`.slice(0, 120);
    // Commit only this file, so unrelated staged work is never swept in.
    const commit = await this.run("git", ["-C", top, "commit", "-m", subject, "--", rel]);
    if (commit.code !== 0) {
      return { target: "voice", status: "saved", where, note: `Saved, but the commit failed: ${firstLine(commit.stderr || commit.stdout)}` };
    }
    if (!push) return { target: "voice", status: "saved", where, note: "Committed (push is off)." };
    const pushed = await this.run("git", ["-C", top, "push"]);
    if (pushed.code !== 0) {
      return { target: "voice", status: "saved", where, note: `Committed, but the push failed: ${firstLine(pushed.stderr || pushed.stdout)}` };
    }
    return { target: "voice", status: "saved", where, note: "Committed and pushed." };
  }

  async saveClaude(path: string, rule: string): Promise<SaveResult> {
    const where = `${tildePath(path)}, under Rules from corrections`;
    const content = await this.readOrEmpty(path);
    const next = appendToRulesSection(content, rule, today(this.now()));
    if (next === null) return { target: "claude", status: "exists", where, note: "Already there." };
    await this.backupOnce(path);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, next, "utf8");
    return { target: "claude", status: "saved", where, note: "Every new chat follows it." };
  }

  /** Run the user's "second brain" command. `{rule}` and `{thread}` are replaced inside each argument; no shell is involved. */
  async saveBrain(template: string, rule: string, threadId: string, alreadySaved: boolean): Promise<SaveResult> {
    const argv = splitCommand(template);
    if (argv.length === 0) throw new Error("No second-brain command is set.");
    const where = `your second brain (${basename(argv[0])})`;
    if (alreadySaved) return { target: "brain", status: "exists", where, note: "Already saved." };
    const filled = argv.map((a) => a.replaceAll("{rule}", rule).replaceAll("{thread}", threadId));
    const result = await this.run(expandHome(filled[0]), filled.slice(1));
    if (result.code !== 0) throw new Error(`The second-brain command failed: ${firstLine(result.stderr || result.stdout)}`);
    return { target: "brain", status: "saved", where, note: null };
  }
}

/** Split a command template into arguments, honouring single and double quotes. Never passed to a shell. */
export function splitCommand(template: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quote: '"' | "'" | null = null;
  let has = false;
  for (const ch of template.trim()) {
    if (quote) {
      if (ch === quote) quote = null;
      else cur += ch;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
      has = true;
    } else if (/\s/.test(ch)) {
      if (has || cur) out.push(cur);
      cur = "";
      has = false;
    } else {
      cur += ch;
    }
  }
  if (has || cur) out.push(cur);
  return out;
}

export function expandHome(path: string, home = process.env.HOME ?? ""): string {
  return path === "~" ? home : path.startsWith("~/") && home ? home + path.slice(1) : path;
}

function firstLine(s: string): string {
  return (s.split("\n").find((l) => l.trim()) ?? "unknown error").trim().slice(0, 200);
}
