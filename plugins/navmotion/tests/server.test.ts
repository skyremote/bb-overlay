// The backend through the official fake plugin host: RPCs, the decision flow
// (feedback.jsonl + threads.send + guard), the New flow against a stand-in
// nm.py, and the Range-capable media route.
import { chmodSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createFakePluginHost, type FakePluginHost } from "@get-bb/plugin-sdk/testing";
import plugin from "@/server";
import { makeProject, tmpRoot, writeFile } from "./helpers";

const hosts: FakePluginHost["harness"][] = [];
afterEach(async () => {
  while (hosts.length > 0) await hosts.pop()!.lifecycle.dispose();
});

async function boot(root: string, extra: { skillPath?: string; preview?: boolean } = {}) {
  const sent: unknown[] = [];
  const spawned: unknown[] = [];
  const host = createFakePluginHost({
    pluginId: "navmotion",
    settings: { projectsRoot: root, bbProjectId: "proj_test", reviewerName: "Daniel", ...(extra.skillPath ? { skillPath: extra.skillPath } : {}) },
    sdk: {
      files: {
        createPreview: async ({ rootPath }: { rootPath: string }) => {
          if (extra.preview === false) throw new Error("previews off");
          return { baseUrl: `/api/v1/file-previews/${path.basename(rootPath)}`, expiresAtMs: Date.now() + 3_600_000 };
        },
      },
      threads: {
        send: async (args: unknown) => {
          sent.push(args);
          return { ok: true, delivery: "sent" };
        },
        spawn: async (args: unknown) => {
          spawned.push(args);
          return { id: "thr_spawned1" };
        },
      },
    } as never,
  });
  await plugin(host.bb);
  hosts.push(host.harness);
  const rpc = (method: string, input?: unknown) => host.harness.behavior.callRpc(method, input) as Promise<any>;
  return { host, rpc, sent, spawned };
}

describe("projects_list and project_get", () => {
  it("lists projects, waiting ones first, with the newest 9:16 cover as thumbnail", async () => {
    const root = tmpRoot();
    makeProject(root, "plain-one", { status: { updated: "2026-10-25T12:00:00+01:00", films: [{ name: "main", stills: ["s/1.png", "s/2.png", "s/3.png"] }] }, files: { "s/1.png": "a", "s/2.png": "b", "s/3.png": "c" } });
    makeProject(root, "waiting-one", {
      status: {
        awaiting: "covers",
        covers: [
          { label: "Cover 9:16", path: "covers/w_cover_9x16_v1.png", size: "1080x1920", bytes: 1 },
          { label: "Cover 9:16", path: "covers/w_cover_9x16_v2.png", size: "1080x1920", bytes: 1 },
          { label: "Cover 3:4", path: "covers/w_cover_3x4_v2.png", size: "1080x1440", bytes: 1 },
        ],
      },
      files: { "covers/w_cover_9x16_v1.png": "1", "covers/w_cover_9x16_v2.png": "2", "covers/w_cover_3x4_v2.png": "3" },
    });
    const { rpc } = await boot(root);
    const list = await rpc("projects_list", null);
    expect(list.projects.map((p: any) => p.slug)).toEqual(["waiting-one", "plain-one"]);
    expect(list.projects[0].thumbUrl).toBe("/api/v1/file-previews/waiting-one/covers/w_cover_9x16_v2.png");
    expect(list.projects[1].thumbUrl).toBe("/api/v1/file-previews/plain-one/s/2.png");
    const { project } = await rpc("project_get", { slug: "waiting-one" });
    expect(project.coverSets.map((s: any) => s.version)).toEqual([2, 1]);
    expect(project.coverSets[0].items.map((i: any) => i.aspect)).toEqual(["9:16", "3:4"]);
  });

  it("serves video outputs from the stable media route, images from previews", async () => {
    const root = tmpRoot();
    makeProject(root, "with-video", {
      status: { outputs: [{ label: "Film", path: "deliver/f v1.mp4", kind: "video", bytes: 3 }, { label: "Sheet", path: "deliver/s.jpg", kind: "image", bytes: 1 }] },
      files: { "deliver/f v1.mp4": "abc", "deliver/s.jpg": "j" },
    });
    const { rpc } = await boot(root);
    const { project } = await rpc("project_get", { slug: "with-video" });
    expect(project.outputs[0].url).toBe("/api/v1/plugins/navmotion/http/media?slug=with-video&path=deliver%2Ff%20v1.mp4");
    expect(project.outputs[1].url).toBe("/api/v1/file-previews/with-video/deliver/s.jpg");
  });

  it("falls back to the media route when previews fail, and returns null for unknown slugs", async () => {
    const root = tmpRoot();
    makeProject(root, "no-preview", { status: { films: [{ name: "main", stills: ["s/1.png"] }] }, files: { "s/1.png": "a" } });
    const { rpc } = await boot(root, { preview: false });
    const { project } = await rpc("project_get", { slug: "no-preview" });
    expect(project.films[0].stills[0].url).toBe("/api/v1/plugins/navmotion/http/media?slug=no-preview&path=s%2F1.png");
    expect((await rpc("project_get", { slug: "nope-nope" })).project).toBeNull();
  });

  it("finds the project for a thread", async () => {
    const root = tmpRoot();
    makeProject(root, "threaded", { status: { thread_id: "thr_abc" } });
    const { rpc } = await boot(root);
    expect(await rpc("project_by_thread", { threadId: "thr_abc" })).toEqual({ slug: "threaded", title: "Title of threaded" });
    expect(await rpc("project_by_thread", { threadId: "thr_zzz" })).toEqual({ slug: null, title: null });
  });
});

describe("decide", () => {
  it("appends one feedback line, tells the thread, then refuses a second click", async () => {
    const root = tmpRoot();
    const dir = makeProject(root, "deck-wait", { status: { awaiting: "storyboard", thread_id: "thr_deck", updated: "2026-10-25T10:00:00+01:00" } });
    const { rpc, sent } = await boot(root);
    const r = await rpc("decide", { slug: "deck-wait", decision: "approve", note: "go" });
    expect(r).toMatchObject({ recorded: true, sent: true, warning: null });
    const lines = readFileSync(path.join(dir, "feedback.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ by: "daniel", via: "studio", about: "storyboard", decision: "approve", note: "go" });
    expect(lines[0].at).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d[+-]\d\d:\d\d$/);
    expect(sent).toEqual([
      { threadId: "thr_deck", mode: "auto", input: [{ type: "text", text: 'NavMotion Studio: Daniel approved the storyboard for `deck-wait`. Note: "go". Carry on from where you stopped.', mentions: [] }] },
    ]);
    await expect(rpc("decide", { slug: "deck-wait", decision: "approve", note: "" })).rejects.toThrow(/not been picked up/);
    expect(readFileSync(path.join(dir, "feedback.jsonl"), "utf8").trim().split("\n")).toHaveLength(1);
    const { project } = await rpc("project_get", { slug: "deck-wait" });
    expect(project.decisionPending).toBe(true);
  });

  it("refuses when nothing is awaited, and needs a note for changes", async () => {
    const root = tmpRoot();
    makeProject(root, "idle-proj", {});
    makeProject(root, "cov-wait", { status: { awaiting: "covers" } });
    const { rpc } = await boot(root);
    await expect(rpc("decide", { slug: "idle-proj", decision: "approve", note: "" })).rejects.toThrow(/not waiting/);
    await expect(rpc("decide", { slug: "cov-wait", decision: "changes", note: "  " })).rejects.toThrow(/what to change/);
  });

  it("records but warns when no thread is linked", async () => {
    const root = tmpRoot();
    makeProject(root, "cov-wait", { status: { awaiting: "covers" } });
    const { rpc, sent } = await boot(root);
    const r = await rpc("decide", { slug: "cov-wait", decision: "changes", note: "bigger" });
    expect(r.recorded).toBe(true);
    expect(r.sent).toBe(false);
    expect(r.message).toMatch(/render the covers again/);
    expect(sent).toEqual([]);
  });
});

describe("create_project (New flow)", () => {
  it("runs nm.py new with a unique slug, spawns the thread, links it", async () => {
    const root = tmpRoot();
    makeProject(root, "launch-film", {});
    const skill = tmpRoot("navmotion-skill-");
    const log = path.join(skill, "calls.log");
    const nm = path.join(skill, "scripts", "nm.py");
    writeFile(
      nm,
      [
        "import json, os, pathlib, sys",
        `open(${JSON.stringify(log)}, "a").write(json.dumps(sys.argv[1:]) + "\\n")`,
        "root = pathlib.Path(os.environ['NAVMOTION_PROJECTS'])",
        "if sys.argv[1] == 'new':",
        "    p = root / sys.argv[2]; p.mkdir()",
        "    (p / 'navmotion.json').write_text(json.dumps({'slug': sys.argv[2], 'title': 'x', 'kind': 'film'}))",
        "    print('note'); print(p)",
        "else:",
        "    print('linked', sys.argv[-1])",
      ].join("\n"),
    );
    chmodSync(nm, 0o755);
    const { rpc, spawned } = await boot(root, { skillPath: skill });
    const r = await rpc("create_project", { kind: "film", title: "Launch film", brief: "A brief", duration: 20 });
    expect(r).toMatchObject({ slug: "launch-film-2", threadId: "thr_spawned1", warning: null });
    const calls = readFileSync(log, "utf8").trim().split("\n").map((l) => JSON.parse(l));
    expect(calls[0].slice(0, 6)).toEqual(["new", "launch-film-2", "--kind", "film", "--title", "Launch film"]);
    expect(calls[0]).toContain("--duration");
    expect(calls[1]).toEqual(["link", "launch-film-2", "--thread", "thr_spawned1"]);
    expect(spawned).toHaveLength(1);
    expect(spawned[0]).toMatchObject({
      projectId: "proj_test",
      title: "NavMotion: Launch film",
      prompt: expect.stringMatching(/^\/navmotion Work on the NavMotion project at .*launch-film-2\. Read navmotion\.json/),
    });
  });
});

describe("media route", () => {
  async function setup() {
    const root = tmpRoot();
    const bytes = Uint8Array.from({ length: 1000 }, (_, i) => i % 256);
    makeProject(root, "media-proj", { files: { "deliver/f.mp4": bytes } });
    writeFileSync(path.join(root, "outside.txt"), "secret");
    const { host } = await boot(root);
    const get = (q: string, headers: Record<string, string> = {}) => host.harness.behavior.fetchHttp("GET", `/media?${q}`, { headers });
    return { get, bytes };
  }

  it("200 with the whole file and Accept-Ranges", async () => {
    const { get, bytes } = await setup();
    const res = await get("slug=media-proj&path=deliver%2Ff.mp4");
    expect(res.status).toBe(200);
    expect(res.headers.get("accept-ranges")).toBe("bytes");
    expect(res.headers.get("content-type")).toBe("video/mp4");
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(bytes);
  });

  it("206 for a byte range", async () => {
    const { get, bytes } = await setup();
    const res = await get("slug=media-proj&path=deliver%2Ff.mp4", { range: "bytes=100-199" });
    expect(res.status).toBe(206);
    expect(res.headers.get("content-range")).toBe("bytes 100-199/1000");
    expect(res.headers.get("content-length")).toBe("100");
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(bytes.slice(100, 200));
    const tail = await get("slug=media-proj&path=deliver%2Ff.mp4", { range: "bytes=-10" });
    expect(tail.status).toBe(206);
    expect(tail.headers.get("content-range")).toBe("bytes 990-999/1000");
  });

  it("416 for an unsatisfiable or malformed range", async () => {
    const { get } = await setup();
    for (const range of ["bytes=1000-", "bytes=500-100", "lines=1-2"]) {
      const res = await get("slug=media-proj&path=deliver%2Ff.mp4", { range });
      expect(res.status).toBe(416);
      expect(res.headers.get("content-range")).toBe("bytes */1000");
    }
  });

  it("404 for escapes and missing files, 400 for bad slugs", async () => {
    const { get } = await setup();
    expect((await get("slug=media-proj&path=..%2Foutside.txt")).status).toBe(404);
    expect((await get("slug=media-proj&path=nope.mp4")).status).toBe(404);
    expect((await get("slug=..&path=outside.txt")).status).toBe(400);
  });
});
