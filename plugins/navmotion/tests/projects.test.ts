// Pure contract logic: path containment, status parsing, the double-click guard,
// decision wording, slugs, covers and Range parsing.
import { mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  coverAspect,
  decisionMessage,
  decisionPending,
  groupCovers,
  parseRange,
  readProject,
  safeResolve,
  slugify,
  uniqueSlug,
} from "@/lib/projects";
import { makeProject, tmpRoot, writeFile } from "./helpers";

describe("safeResolve (untrusted status.json paths)", () => {
  const root = tmpRoot();
  const dir = makeProject(root, "proj-one", { files: { "films/main/out/a.png": "x" } });
  writeFile(path.join(root, "secret.txt"), "secret");
  mkdirSync(path.join(root, "outside-dir"), { recursive: true });
  writeFileSync(path.join(root, "outside-dir", "b.png"), "y");
  symlinkSync(path.join(root, "secret.txt"), path.join(dir, "escape-file.png"));
  symlinkSync(path.join(root, "outside-dir"), path.join(dir, "escape-dir"));
  symlinkSync(path.join(dir, "films"), path.join(dir, "inside-link"));

  it("accepts a file inside the project", () => {
    expect(safeResolve(dir, "films/main/out/a.png")).toMatch(/films\/main\/out\/a\.png$/);
  });
  it("rejects ../ escapes", () => {
    expect(safeResolve(dir, "../secret.txt")).toBeNull();
    expect(safeResolve(dir, "films/../../secret.txt")).toBeNull();
  });
  it("rejects absolute paths, empty strings, NUL bytes and non-strings", () => {
    expect(safeResolve(dir, path.join(dir, "films/main/out/a.png"))).toBeNull();
    expect(safeResolve(dir, "")).toBeNull();
    expect(safeResolve(dir, "a\0b")).toBeNull();
    expect(safeResolve(dir, 42)).toBeNull();
    expect(safeResolve(dir, null)).toBeNull();
  });
  it("rejects symlinks that point outside, file or directory", () => {
    expect(safeResolve(dir, "escape-file.png")).toBeNull();
    expect(safeResolve(dir, "escape-dir/b.png")).toBeNull();
  });
  it("allows paths that leave and come back in, and symlinks that stay inside", () => {
    expect(safeResolve(dir, "../proj-one/films/main/out/a.png")).not.toBeNull();
    expect(safeResolve(dir, "inside-link/main/out/a.png")).not.toBeNull();
  });
  it("returns null for a missing file", () => {
    expect(safeResolve(dir, "films/none.png")).toBeNull();
  });
});

describe("readProject (status.json parsing)", () => {
  it("ignores unknown extra fields and rejects escaping paths", async () => {
    const root = tmpRoot();
    makeProject(root, "extra-fields", {
      status: {
        future_field: { nested: true },
        awaiting: "storyboard",
        stages: [{ name: "brief", state: "done", weird: 1 }, { name: "render", state: "exploding" }, { nope: true }],
        films: [{ name: "main", stills: ["s/1.png", "../../etc/passwd"], stills_guides: [], gate: { pass: true, errors: 0, warnings: 1, extra: "x" }, metrics: { motion: 0.5, junk: [1] } }],
        outputs: [{ label: "Film", path: "deliver/f.mp4", kind: "video", bytes: 10, hash: "abc" }, { path: "/etc/hosts", kind: "image" }],
        progress: { stage: "render", frame: 5, of: 10, mystery: true },
      },
      files: { "s/1.png": "p", "deliver/f.mp4": "v" },
    });
    const p = await readProject(root, "extra-fields");
    expect(p).not.toBeNull();
    expect(p!.awaiting).toBe("storyboard");
    expect(p!.stages.map((s) => [s.name, s.state])).toEqual([["brief", "done"], ["render", "todo"]]);
    expect(p!.films[0].stills).toEqual(["s/1.png"]);
    expect(p!.films[0].metrics).toEqual({ motion: 0.5 });
    expect(p!.outputs.map((o) => o.path)).toEqual(["deliver/f.mp4"]);
    expect(p!.rejected.sort()).toEqual(["../../etc/passwd", "/etc/hosts"]);
    expect(p!.progress).toMatchObject({ frame: 5, of: 10, eta_s: null, film: null });
  });

  it("copes with missing optional fields", async () => {
    const root = tmpRoot();
    const dir = path.join(root, "bare-minimum");
    mkdirSync(dir);
    writeFileSync(path.join(dir, "status.json"), JSON.stringify({ stage: "brief", state: "running" }));
    const p = await readProject(root, "bare-minimum");
    expect(p).toMatchObject({ title: "bare-minimum", kind: "unknown", awaiting: null, progress: null, threadId: null, error: null, statusMissing: false });
    expect(p!.films).toEqual([]);
    expect(p!.outputs).toEqual([]);
    expect(p!.covers).toEqual([]);
    expect(p!.feedback).toEqual([]);
  });

  it("reads a project that has a manifest but no status yet", async () => {
    const root = tmpRoot();
    makeProject(root, "no-status-yet", { status: null, manifest: { thread_id: "thr_abc123" } });
    const p = await readProject(root, "no-status-yet");
    expect(p).toMatchObject({ statusMissing: true, threadId: "thr_abc123", title: "Title of no-status-yet" });
  });

  it("refuses bad slugs and unknown awaiting values", async () => {
    const root = tmpRoot();
    makeProject(root, "odd-awaiting", { status: { awaiting: "lunch", thread_id: "not a thread" } });
    expect(await readProject(root, "../odd-awaiting")).toBeNull();
    expect(await readProject(root, "UPPER")).toBeNull();
    const p = await readProject(root, "odd-awaiting");
    expect(p!.awaiting).toBeNull();
    expect(p!.threadId).toBeNull();
  });

  it("skips torn feedback lines", async () => {
    const root = tmpRoot();
    const dir = makeProject(root, "torn-feedback");
    writeFileSync(path.join(dir, "feedback.jsonl"), '{"at":"2026-10-25T10:00:00+01:00","decision":"approve"}\n{"at": "broken\n');
    const p = await readProject(root, "torn-feedback");
    expect(p!.feedback).toHaveLength(1);
  });
});

describe("decisionPending (double-click guard)", () => {
  const fb = (at: string) => ({ at, by: "daniel", via: "studio", about: "storyboard", decision: "approve", note: null });
  it("is false with no feedback", () => {
    expect(decisionPending({ feedback: [], updated: "2026-10-25T10:00:00+01:00" })).toBe(false);
  });
  it("is true while the newest line is later than status.updated", () => {
    expect(decisionPending({ feedback: [fb("2026-10-25T10:00:01+01:00")], updated: "2026-10-25T10:00:00+01:00" })).toBe(true);
  });
  it("is false once nm.py has rewritten status.json (same second counts as picked up)", () => {
    expect(decisionPending({ feedback: [fb("2026-10-25T10:00:00+01:00")], updated: "2026-10-25T10:00:00+01:00" })).toBe(false);
    expect(decisionPending({ feedback: [fb("2026-10-25T10:00:00+01:00")], updated: "2026-10-25T10:00:05+01:00" })).toBe(false);
  });
  it("compares instants across time zones", () => {
    expect(decisionPending({ feedback: [fb("2026-10-25T09:00:01Z")], updated: "2026-10-25T10:00:00+01:00" })).toBe(true);
  });
  it("only looks at the newest line", () => {
    expect(decisionPending({ feedback: [fb("2026-10-25T11:00:00+01:00"), fb("2026-10-25T09:00:00+01:00")], updated: "2026-10-25T10:00:00+01:00" })).toBe(false);
  });
  it("treats a missing status.updated as pending", () => {
    expect(decisionPending({ feedback: [fb("2026-10-25T10:00:00+01:00")], updated: null })).toBe(true);
  });
});

describe("decisionMessage (CONTRACT.md wording)", () => {
  it("approve with a note", () => {
    expect(decisionMessage("sow-short", "storyboard", "approve", "go", "Daniel")).toBe(
      'NavMotion Studio: Daniel approved the storyboard for `sow-short`. Note: "go". Carry on from where you stopped.',
    );
  });
  it("approve without a note leaves out the Note sentence", () => {
    expect(decisionMessage("sow-short", "storyboard", "approve", "", "Daniel")).toBe(
      "NavMotion Studio: Daniel approved the storyboard for `sow-short`. Carry on from where you stopped.",
    );
  });
  it("changes to the storyboard", () => {
    expect(decisionMessage("sow-short", "storyboard", "changes", "logo too small at 4s", "Daniel")).toBe(
      'NavMotion Studio: Daniel asked for changes to the storyboard for `sow-short`: "logo too small at 4s". Make them, rebuild the board, and wait again.',
    );
  });
  it("changes to the final", () => {
    expect(decisionMessage("sow-short", "final", "changes", "music too loud", "Daniel")).toBe(
      'NavMotion Studio: Daniel asked for changes to the final for `sow-short`: "music too loud". Make them, render again, and wait again.',
    );
  });
  it("changes to the covers", () => {
    expect(decisionMessage("sow-short", "covers", "changes", "bigger number", "Daniel")).toBe(
      'NavMotion Studio: Daniel asked for changes to the covers for `sow-short`: "bigger number". Make them, render the covers again, and wait again.',
    );
  });
  it("quotes notes safely", () => {
    expect(decisionMessage("s-1", "storyboard", "approve", 'say "hi"', "Daniel")).toContain('Note: "say \\"hi\\"".');
    expect(decisionMessage("s-1", "storyboard", "approve", "")).toBe(
      "NavMotion Studio: The user approved the storyboard for `s-1`. Carry on from where you stopped.",
    );
  });
});

describe("slugs", () => {
  it("lowercases and hyphenates the title", () => {
    expect(slugify("SOW to Invoice: in 30 seconds!")).toBe("sow-to-invoice-in-30-seconds");
    expect(slugify("Café déjà vu")).toBe("cafe-deja-vu");
  });
  it("pads very short titles to a valid slug", () => {
    expect(slugify("A")).toMatch(/^[a-z0-9-]{3,60}$/);
    expect(slugify("!!")).toMatch(/^[a-z0-9-]{3,60}$/);
  });
  it("adds -2, -3 when taken", () => {
    expect(uniqueSlug("Launch film", [])).toBe("launch-film");
    expect(uniqueSlug("Launch film", ["launch-film"])).toBe("launch-film-2");
    expect(uniqueSlug("Launch film", ["launch-film", "launch-film-2"])).toBe("launch-film-3");
  });
  it("keeps long slugs within 60 characters", () => {
    const long = "x".repeat(200);
    const s = uniqueSlug(long, [slugify(long)]);
    expect(s.length).toBeLessThanOrEqual(60);
    expect(s.endsWith("-2")).toBe(true);
  });
});

describe("covers", () => {
  const c = (rel: string, size: string | null, label = "Cover") => ({ label, path: rel, size, bytes: 1 });
  it("classifies the three sizes", () => {
    expect(coverAspect("1080x1920")).toBe("9:16");
    expect(coverAspect("1080x1440")).toBe("3:4");
    expect(coverAspect("1080x1350")).toBe("4:5");
    expect(coverAspect("1920x1080")).toBeNull();
    expect(coverAspect(null, "Cover 4:5")).toBe("4:5");
  });
  it("groups by version, newest first, 9:16 then 3:4 then 4:5", () => {
    const sets = groupCovers([
      c("covers/x_cover_4x5_v1.png", "1080x1350"),
      c("covers/x_cover_9x16_v1.png", "1080x1920"),
      c("covers/x_cover_3x4_v3.png", "1080x1440"),
      c("covers/x_cover_9x16_v3.png", "1080x1920"),
      c("covers/x_cover_4x5_v3.png", "1080x1350"),
      c("covers/x_cover_9x16_v2.png", "1080x1920"),
    ]);
    expect(sets.map((s) => s.version)).toEqual([3, 2, 1]);
    expect(sets[0].items.map((i) => i.aspect)).toEqual(["9:16", "3:4", "4:5"]);
    expect(sets[2].items.map((i) => i.aspect)).toEqual(["9:16", "4:5"]);
  });
  it("puts unversioned covers last", () => {
    const sets = groupCovers([c("covers/plain.png", "1080x1920"), c("covers/x_v1.png", "1080x1920")]);
    expect(sets.map((s) => s.version)).toEqual([1, 0]);
  });
});

describe("parseRange", () => {
  it("no header means a full response", () => {
    expect(parseRange(undefined, 100)).toBeNull();
    expect(parseRange("", 100)).toBeNull();
  });
  it("parses closed, open-ended and suffix ranges", () => {
    expect(parseRange("bytes=0-9", 100)).toEqual({ start: 0, end: 9 });
    expect(parseRange("bytes=90-", 100)).toEqual({ start: 90, end: 99 });
    expect(parseRange("bytes=95-500", 100)).toEqual({ start: 95, end: 99 });
    expect(parseRange("bytes=-10", 100)).toEqual({ start: 90, end: 99 });
  });
  it("rejects unsatisfiable or malformed ranges", () => {
    expect(parseRange("bytes=100-", 100)).toBe("invalid");
    expect(parseRange("bytes=9-3", 100)).toBe("invalid");
    expect(parseRange("bytes=-", 100)).toBe("invalid");
    expect(parseRange("bytes=-0", 100)).toBe("invalid");
    expect(parseRange("items=0-1", 100)).toBe("invalid");
    expect(parseRange("bytes=0-1,5-6", 100)).toBe("invalid");
  });
});
