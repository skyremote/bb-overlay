// Synced rail state (tags, "come back later" marks, section order, collapsed
// sections) lives on the plugin server in bb storage, so it follows the member
// across windows and machines. Every change is broadcast on "rail-state".
import { useCallback, useEffect, useState } from "react";
import { useRealtime, useRpc } from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import type { RailState, rpcContract } from "../server";
import type { ProjectColor } from "./rail-look";

export type { RailState };
export type Tag = RailState["tags"][number];
export type TagColor = Tag["color"];
export type RailGroup = RailState["groups"][number];
export type LaterReason = "revisit" | "done" | "mistake";

export const TAG_COLORS: TagColor[] = ["gold", "ink", "green", "red", "plum", "teal", "sand"];

/** Theme-token colours only, so tags follow the palette in light and dark. */
export const TAG_CSS: Record<TagColor, string> = {
  gold: "var(--attention)",
  ink: "var(--foreground)",
  green: "var(--success)",
  red: "var(--destructive)",
  plum: "var(--pr-merged)",
  teal: "var(--ansi-6)",
  sand: "var(--input)",
};

const EMPTY: RailState = { tags: [], assign: {}, later: {}, order: [], collapsed: [], groups: [], within: {}, colors: {}, subOpen: [] };

const fail = (verb: string) => (e: unknown) => {
  toast.error(`${verb} failed`, { description: e instanceof Error ? e.message : String(e) });
};

export function useRailState() {
  const rpc = useRpc<typeof rpcContract>();
  const [state, setState] = useState<RailState>(EMPTY);

  const refetch = useCallback(() => {
    rpc.call("state_get").then(setState, () => undefined);
  }, [rpc]);
  useEffect(refetch, [refetch]);
  useRealtime("rail-state", refetch);

  const apply = (p: Promise<RailState>, verb: string) => p.then(setState, fail(verb));

  return {
    state,
    createTag: (name: string, color: TagColor) =>
      rpc.call("tag_create", { name, color }).then((tag) => {
        refetch();
        return tag;
      }),
    updateTag: (id: string, patch: { name?: string; color?: TagColor }) => apply(rpc.call("tag_update", { id, ...patch }), "Update tag"),
    deleteTag: (id: string) => apply(rpc.call("tag_delete", { id }), "Delete tag"),
    applyTag: (threadIds: string[], tagId: string, on: boolean) => apply(rpc.call("tag_apply", { threadIds, tagId, on }), "Tag"),
    setLater: (threadIds: string[], reason: LaterReason | null) => apply(rpc.call("later_set", { threadIds, reason }), "Come back later"),
    setOrder: (order: string[]) => apply(rpc.call("order_set", { order }), "Reorder"),
    setCollapsed: (id: string, collapsed: boolean) => {
      setState((s) => ({ ...s, collapsed: collapsed ? [...new Set([...s.collapsed, id])] : s.collapsed.filter((x) => x !== id) }));
      void apply(rpc.call("collapsed_set", { id, collapsed }), "Collapse");
    },
    /** Open or fold the sub-agents under these chats (one write, synced to every window). */
    setSubOpen: (threadIds: string[], open: boolean) => {
      if (threadIds.length === 0) return;
      const ids = threadIds.slice(0, 400);
      setState((s) => {
        const rest = s.subOpen.filter((x) => !ids.includes(x));
        return { ...s, subOpen: open ? [...rest, ...ids] : rest };
      });
      void apply(rpc.call("sub_open_set", { threadIds: ids, open }), "Sub-agents");
    },
    createGroup: (name: string, parentId: string | null, members?: string[]) =>
      rpc.call("group_create", { name, parentId, members }).then(
        (g) => {
          refetch();
          return g;
        },
        (e) => {
          fail("New group")(e);
          return null;
        },
      ),
    renameGroup: (id: string, name: string) => apply(rpc.call("group_update", { id, name }), "Rename group"),
    deleteGroup: (id: string) => apply(rpc.call("group_delete", { id }), "Delete group"),
    /** Move sections into a group (null = top level), optionally saving a new order in the same write. */
    placeInGroup: (ids: string[], groupId: string | null, order?: string[]) => {
      setState((s) => {
        const within = { ...s.within };
        for (const id of ids) {
          if (groupId) within[id] = groupId;
          else delete within[id];
        }
        return { ...s, within, order: order ?? s.order };
      });
      return rpc.call("group_place", { ids, groupId, order }).then(setState, (e) => {
        fail("Move to group")(e);
        refetch();
      });
    },
    /** Pick a project's colour in the rail; null goes back to the automatic one. */
    setProjectColor: (projectId: string, color: ProjectColor | null) => {
      setState((s) => {
        const colors = { ...s.colors };
        if (color) colors[projectId] = color;
        else delete colors[projectId];
        return { ...s, colors };
      });
      void apply(rpc.call("project_color_set", { projectId, color }), "Project colour");
    },
    forget: (threadIds: string[]) => apply(rpc.call("forget_threads", { threadIds }), "Tidy up"),
  };
}

export type RailOps = ReturnType<typeof useRailState>;
