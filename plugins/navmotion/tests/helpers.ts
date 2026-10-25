// Build throwaway NavMotion project folders for tests (CONTRACT.md layout).
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

export function tmpRoot(prefix = "navmotion-test-"): string {
  return mkdtempSync(path.join(os.tmpdir(), prefix));
}

export function writeFile(file: string, content: string | Uint8Array): void {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, content);
}

export interface FixtureOptions {
  status?: Record<string, unknown> | null;
  manifest?: Record<string, unknown>;
  feedback?: Record<string, unknown>[];
  files?: Record<string, string | Uint8Array>;
}

export function makeProject(root: string, slug: string, opts: FixtureOptions = {}): string {
  const dir = path.join(root, slug);
  mkdirSync(dir, { recursive: true });
  writeFile(
    path.join(dir, "navmotion.json"),
    JSON.stringify({ schema: 1, slug, title: `Title of ${slug}`, kind: "short", brief: "brief", footage: null, duration: 30, thread_id: null, ...opts.manifest }),
  );
  if (opts.status !== null) {
    writeFile(
      path.join(dir, "status.json"),
      JSON.stringify({
        schema: 1,
        slug,
        title: `Title of ${slug}`,
        kind: "short",
        updated: "2026-10-25T10:00:00+01:00",
        stage: "approval",
        state: "waiting",
        awaiting: null,
        stages: [],
        progress: null,
        films: [],
        outputs: [],
        notes: [],
        error: null,
        ...opts.status,
      }),
    );
  }
  writeFile(path.join(dir, "feedback.jsonl"), (opts.feedback ?? []).map((l) => `${JSON.stringify(l)}\n`).join(""));
  for (const [rel, content] of Object.entries(opts.files ?? {})) writeFile(path.join(dir, rel), content);
  return dir;
}
