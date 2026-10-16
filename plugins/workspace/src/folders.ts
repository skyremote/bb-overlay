// Folders come from the project-folders plugin, which owns the real folders on
// disk (create, rename, move, AGENTS.md rules). This module reads its tree over
// bb's cross-plugin RPC and exposes the handful of mutations the rail uses.
// If project-folders is missing or fails, `available` is false and the rail
// falls back to plain project groups — the skin never breaks the sidebar.
import { useCallback, useEffect, useRef, useState } from "react";
import { useSdk } from "@get-bb/plugin-sdk/app";
import { z } from "zod";

const PF = "project-folders";

/**
 * The one line that installs project-folders (VKirill, MIT) from its own repository.
 * Pinned to 0.6.19: from 0.6.20 on it needs functions only VKirill's own bb build has.
 */
export const PROJECT_FOLDERS_INSTALL = "bb plugin install git:https://github.com/VKirill/bb-plugin-project-folders.git@v0.6.19";

const folderSchema = z
  .object({
    id: z.string(),
    projectId: z.string(),
    hostId: z.string(),
    parentId: z.string().nullable(),
    name: z.string(),
    path: z.string(),
    sort: z.number().optional(),
    kind: z.enum(["folder", "group"]).optional(),
  })
  .passthrough();

const listSchema = z
  .object({
    folders: z.array(folderSchema),
    roots: z.array(folderSchema),
    bindings: z.record(z.string(), z.string()),
    places: z.record(z.string(), z.string()),
  })
  .passthrough();

const okSchema = z.unknown();
const browseSchema = z
  .object({
    relative: z.string(),
    directories: z.array(z.object({ name: z.string(), relative: z.string() }).passthrough()),
  })
  .passthrough();

export type Folder = z.infer<typeof folderSchema>;
export type FolderData = z.infer<typeof listSchema>;
export type Directory = { name: string; relative: string };

export function useFolders(refreshKey: unknown) {
  const sdk = useSdk();
  const [data, setData] = useState<FolderData | null>(null);
  const [available, setAvailable] = useState(true);
  const inFlight = useRef(false);

  const refetch = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      const result = await sdk.plugins.callRpc({ pluginId: PF, method: "list", input: null, outputSchema: listSchema });
      setData(result);
      setAvailable(true);
    } catch {
      setAvailable(false);
    } finally {
      inFlight.current = false;
    }
  }, [sdk]);

  useEffect(() => {
    void refetch();
  }, [refetch, refreshKey]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void refetch();
    }, 20_000);
    return () => window.clearInterval(timer);
  }, [refetch]);

  const call = useCallback(
    async (method: string, input: Record<string, unknown>) => {
      await sdk.plugins.callRpc({ pluginId: PF, method, input: input as never, outputSchema: okSchema });
      await refetch();
    },
    [sdk, refetch],
  );

  const browse = useCallback(
    async (projectId: string, folderId: string | null): Promise<Directory[]> => {
      const r = await sdk.plugins.callRpc({
        pluginId: PF,
        method: "browse",
        input: { projectId, folderId, relative: "" },
        outputSchema: browseSchema,
      });
      return r.directories.map((d) => ({ name: d.name, relative: d.relative }));
    },
    [sdk],
  );

  return {
    data,
    available: available && data !== null,
    refetch,
    browse,
    createFolder: (projectId: string, parentId: string | null, name: string, relativePath?: string) =>
      call("create", { projectId, folderId: parentId, name, relativePath: relativePath ?? slug(name) }),
    renameFolder: (projectId: string, folderId: string, name: string) => call("rename", { projectId, folderId, name }),
    reparentFolder: (folderId: string, parentId: string | null) => call("section_reparent", { folderId, parentId }),
    /** Save the order of one set of sibling folders (every sibling, first to last). Only the sort changes; nothing moves on disk. */
    reorderFolders: (projectId: string, parentId: string | null, ids: string[]) => call("reorder", { kind: "sections", projectId, parentId, ids }),
    forgetFolder: (projectId: string, folderId: string) => call("forget", { projectId, folderId }),
    placeThread: (threadId: string, projectId: string, folderId: string | null) =>
      call("thread_place", { threadId, projectId, folderId }),
  };
}

/** A folder-safe name: keeps case and digits, turns runs of anything else into "_". */
export function slug(name: string): string {
  const s = name
    .trim()
    .replace(/[/\\:*?"<>|]+/g, " ")
    .replace(/\s+/g, "_")
    .replace(/^\.+/, "");
  return s.length > 0 ? s.slice(0, 120) : "New_folder";
}

/** Which folder (if any) a thread is listed under: hand placement wins, then its working folder. */
export function folderOfThread(
  data: FolderData,
  folderIds: ReadonlySet<string>,
  threadId: string,
  environmentId: string | null,
): string | null {
  const placed = data.places[threadId];
  if (placed !== undefined) return placed && folderIds.has(placed) ? placed : null;
  const bound = environmentId ? data.bindings[environmentId] : undefined;
  return bound && folderIds.has(bound) ? bound : null;
}

/** Same-document navigation to another plugin's panel route without a full reload. */
export function goTo(url: string) {
  window.history.pushState({}, "", url);
  window.dispatchEvent(new PopStateEvent("popstate", { state: {} }));
}

/** project-folders' own "new chat in this section" route: its composer starts the chat in that folder. */
export function newChatInFolderUrl(projectId: string, folderId: string) {
  return `/plugins/${PF}/folders/chat/${encodeURIComponent(projectId)}/${encodeURIComponent(folderId)}`;
}
