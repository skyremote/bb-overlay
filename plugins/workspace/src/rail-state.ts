// Synced rail state (tags, "come back later" marks, section order, collapsed
// sections) lives on the plugin server in bb storage, so it follows the member
// across windows and machines. Every change is broadcast on "rail-state".
import { useCallback, useEffect, useState } from "react";
import { useRealtime, useRpc } from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import type { RailState, rpcContract } from "../server";

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

const EMPTY: RailState = { tags: [], assign: {}, later: {}, order: [], collapsed: [], groups: [], within: {}, threadOrder: [] };

const fail = (verb: string) => (e: unknown) => {
  toast.error(`${verb} failed`, { description: e instanceof Error ? e.message : String(e) });
};

export function useRailState() {
  const rpc = useRpc<typeof rpcContract>();
  const [state, setState] = useState<RailState>(EMPTY);
  // False until the saved state has arrived, so nothing writes over it with the empty default.
  const [loaded, setLoaded] = useState(false);

  const refetch = useCallback(() => {
    rpc.call("state_get").then((s) => {
      setState(s);
      setLoaded(true);
    }, () => undefined);
  }, [rpc]);
  useEffect(refetch, [refetch]);
  useRealtime("rail-state", refetch);

  const apply = (p: Promise<RailState>, verb: string) => p.then(setState, fail(verb));

  return {
    state,
    loaded,
    /** Save the member's own order of chats (ids, first to last), for Keep my order. */
    setThreadOrder: (order: string[]) => {
      const next = [...new Set(order)].slice(0, 2000);
      setState((s) => ({ ...s, threadOrder: next }));
      return rpc.call("thread_order_set", { order: next }).then(setState, (e) => {
        fail("Reorder")(e);
        refetch();
      });
    },
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
    forget: (threadIds: string[]) => apply(rpc.call("forget_threads", { threadIds }), "Tidy up"),
  };
}

export type RailOps = ReturnType<typeof useRailState>;
