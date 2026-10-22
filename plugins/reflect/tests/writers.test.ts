import { mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { appendToProfileSection, appendToRulesSection, expandHome, splitCommand, Writers, type Runner } from "../writers";

const PROFILE = `# Voice

## Rhythm
Short sentences.

## Rules from corrections

- Plain words over clever ones (added 2026-01-02 via Reflect)
`;

const PROFILE_WITH_NEXT = PROFILE + `\n## Appendix\nLast bit.\n`;

describe("appendToProfileSection", () => {
  it("appends at the end of the section", () => {
    const out = appendToProfileSection(PROFILE, "Rules from corrections", "Never use the word synergy.", "2026-10-22")!;
    expect(out.trimEnd().endsWith("- Never use the word synergy. (added 2026-10-22 via Reflect)")).toBe(true);
    expect(out.startsWith("# Voice")).toBe(true);
  });
  it("inserts before the next heading when one follows", () => {
    const out = appendToProfileSection(PROFILE_WITH_NEXT, "Rules from corrections", "Never use the word synergy.", "2026-10-22")!;
    const ruleAt = out.indexOf("- Never use the word synergy.");
    expect(ruleAt).toBeGreaterThan(out.indexOf("## Rules from corrections"));
    expect(ruleAt).toBeLessThan(out.indexOf("## Appendix"));
    expect(out).toContain("Last bit.");
  });
  it("is idempotent", () => {
    const once = appendToProfileSection(PROFILE, "Rules from corrections", "Never use the word synergy.", "2026-10-22")!;
    expect(appendToProfileSection(once, "Rules from corrections", "never use the word Synergy", "2026-10-23")).toBeNull();
  });
  it("creates the section if missing", () => {
    const out = appendToProfileSection("# Voice\n", "House rules", "No emojis.", "2026-10-22")!;
    expect(out).toContain("## House rules");
    expect(out).toContain("- No emojis. (added 2026-10-22 via Reflect)");
  });
});

describe("appendToRulesSection", () => {
  it("creates the heading at the end and appends", () => {
    const out = appendToRulesSection("# Global\n\nStuff.\n", "Never use hashtags.", "2026-10-22")!;
    expect(out).toContain("## Rules from corrections\n- Never use hashtags. (added 2026-10-22 via Reflect)");
    expect(out.startsWith("# Global\n\nStuff.")).toBe(true);
  });
  it("is idempotent and keeps other content", () => {
    const once = appendToRulesSection("# Global\n", "Never use hashtags.", "2026-10-22")!;
    expect(appendToRulesSection(once, "Never use hashtags.", "2026-10-23")).toBeNull();
    const twice = appendToRulesSection(once, "Always reply in plain English.", "2026-10-23")!;
    expect(twice).toContain("- Never use hashtags.");
    expect(twice).toContain("- Always reply in plain English.");
  });
});

describe("splitCommand and expandHome", () => {
  it("splits on spaces and honours quotes", () => {
    expect(splitCommand('notes add "Rule: {rule}" --tag rule')).toEqual(["notes", "add", "Rule: {rule}", "--tag", "rule"]);
    expect(splitCommand("  ")).toEqual([]);
    expect(splitCommand("a '' b")).toEqual(["a", "", "b"]);
  });
  it("expands a leading tilde only", () => {
    expect(expandHome("~/bin/notes", "/home/me")).toBe("/home/me/bin/notes");
    expect(expandHome("/usr/bin/notes", "/home/me")).toBe("/usr/bin/notes");
  });
});

describe("Writers", () => {
  it("backs up once, writes, and commits only the profile", async () => {
    const dir = await mkdtemp(join(tmpdir(), "reflect-test-"));
    const profile = join(dir, "PROFILE.md");
    await writeFile(profile, PROFILE);
    const calls: string[][] = [];
    const run: Runner = async (file, args) => {
      calls.push([file, ...args]);
      if (args.includes("rev-parse")) return { code: 0, stdout: dir + "\n", stderr: "" };
      if (args.includes("push")) return { code: 1, stdout: "", stderr: "fatal: no remote\n" };
      return { code: 0, stdout: "", stderr: "" };
    };
    const writers = new Writers(join(dir, "backups"), run);
    const first = await writers.saveVoice(profile, "Rules from corrections", "Never use the word synergy.", true, true);
    expect(first.status).toBe("saved");
    expect(first.note).toContain("push failed");
    const second = await writers.saveVoice(profile, "Rules from corrections", "Never use the word synergy.", true, true);
    expect(second.status).toBe("exists");
    await writers.saveVoice(profile, "Rules from corrections", "No emojis.", true, false);
    expect((await readdir(join(dir, "backups"))).length).toBe(1);
    const commit = calls.find((c) => c.includes("commit"))!;
    expect(commit.slice(-2)).toEqual(["--", "PROFILE.md"]);
    const text = await readFile(profile, "utf8");
    expect(text.match(/Never use the word synergy/g)!.length).toBe(1);
  });

  it("skips git when commit is off", async () => {
    const dir = await mkdtemp(join(tmpdir(), "reflect-test-"));
    const profile = join(dir, "PROFILE.md");
    await writeFile(profile, PROFILE);
    const calls: string[][] = [];
    const run: Runner = async (file, args) => {
      calls.push([file, ...args]);
      return { code: 0, stdout: "", stderr: "" };
    };
    const res = await new Writers(join(dir, "backups"), run).saveVoice(profile, "", "No emojis.", false, false);
    expect(res.status).toBe("saved");
    expect(calls).toEqual([]);
  });

  it("writes CLAUDE.md idempotently", async () => {
    const dir = await mkdtemp(join(tmpdir(), "reflect-test-"));
    const claude = join(dir, "CLAUDE.md");
    await writeFile(claude, "# Mine\n");
    const writers = new Writers(join(dir, "backups"));
    expect((await writers.saveClaude(claude, "Never use hashtags.")).status).toBe("saved");
    expect((await writers.saveClaude(claude, "Never use hashtags.")).status).toBe("exists");
    expect((await readFile(claude, "utf8")).match(/Never use hashtags/g)!.length).toBe(1);
  });

  it("runs the second-brain command with the rule filled in, without a shell", async () => {
    const calls: string[][] = [];
    const run: Runner = async (file, args) => {
      calls.push([file, ...args]);
      return { code: 0, stdout: "", stderr: "" };
    };
    const writers = new Writers("/tmp/unused", run);
    const rule = 'No emojis; rm -rf "$HOME"';
    const res = await writers.saveBrain('/usr/local/bin/notes add "Rule: {rule}" --source bb:{thread}', rule, "thr_demo", false);
    expect(res.status).toBe("saved");
    expect(calls[0]).toEqual(["/usr/local/bin/notes", "add", `Rule: ${rule}`, "--source", "bb:thr_demo"]);
    expect((await writers.saveBrain("/usr/local/bin/notes add {rule}", "No emojis.", "thr_demo", true)).status).toBe("exists");
    await expect(writers.saveBrain("  ", "No emojis.", "thr_demo", false)).rejects.toThrow(/No second-brain command/);
  });
});
