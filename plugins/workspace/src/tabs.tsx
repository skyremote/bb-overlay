// Chrome-style tab strip across the top of bb's content area.
//
// bb has no open-tab list: the sidebar is the list. So this plugin keeps its
// own: every chat you visit becomes a tab (Chrome behaviour), capped at MAX,
// persisted in localStorage. Click switches, middle-click or x closes, drag a
// tab sideways to reorder, Cmd/Ctrl-click opens it in bb's split, and the grip
// on the left is bb's own drag-to-split handle, so dropping it on the edge of
// the content docks the chat beside the one you have open.
//
// Docking is bb's: panes, resize and drop zones belong to the host and are not
// reachable from a plugin. This strip only mirrors them (a tab shows which
// panes are open and which one has focus).
//
// Placement follows the usage dock: an app overlay writes a slot element into
// the host DOM, as the first child of [data-app-content-shell], and renders
// into it with a portal. bb has no slot there.
import type React from "react";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import {
  experimental_useSidebarThreadActions as useThreadActions,
  experimental_useSidebarThreadSplit as useThreadSplit,
  experimental_useSidebarThreads as useSidebarThreads,
  experimental_usePluginId as usePluginId,
  useBbContext,
  useSidebarSplitLayout,
} from "@get-bb/plugin-sdk/app";
import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import { cn } from "@/lib/utils";
import { harnessOf, stateOf } from "./shared";

const MAX = 12;
const SHELL = "[data-app-content-shell]";

// ---- the open set: one small store, shared by every render ------------------

let ids: string[] = [];
let storageKey = "";
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

function load(key: string) {
  if (storageKey === key) return;
  storageKey = key;
  try {
    const raw = JSON.parse(window.localStorage.getItem(key) ?? "[]");
    ids = Array.isArray(raw) ? raw.filter((x): x is string => typeof x === "string").slice(0, MAX) : [];
  } catch {
    ids = [];
  }
  emit();
}

function commit(next: string[]) {
  ids = next;
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(next));
  } catch {
    /* private mode or full: the strip still works for this session */
  }
  emit();
}

const store = {
  subscribe(l: () => void) {
    listeners.add(l);
    return () => listeners.delete(l);
  },
  get: () => ids,
  add(id: string) {
    if (ids.includes(id)) return;
    const next = [...ids, id];
    // Over the cap: drop the oldest tab that is not the one being opened.
    while (next.length > MAX) {
      const drop = next.findIndex((x) => x !== id);
      next.splice(drop, 1);
    }
    commit(next);
  },
  remove(id: string) {
    if (ids.includes(id)) commit(ids.filter((x) => x !== id));
  },
  /** Move a tab next to another: before it, or after it when `after` is set; null target = the end. */
  move(id: string, target: string | null, after = false) {
    if (id === target || !ids.includes(id)) return;
    const rest = ids.filter((x) => x !== id);
    let at = target === null ? rest.length : rest.indexOf(target);
    if (at < 0) at = rest.length;
    else if (after && target !== null) at += 1;
    rest.splice(at, 0, id);
    if (rest.join("|") !== ids.join("|")) commit(rest);
  },
  keepOnly(keep: string[]) {
    const next = ids.filter((x) => keep.includes(x));
    if (next.length !== ids.length) commit(next);
  },
};

/**
 * Close a chat the way the strip's x does, for the rail's close button: drop
 * its tab and, when it is the chat on screen, open the neighbouring tab (or a
 * new chat in the project when no tab is left).
 */
export function closeChatTab(
  id: string,
  current: { threadId: string | null; projectId: string | null },
  actions: { open: (id: string) => void; openNewThread: (o: { projectId?: string; focusPrompt?: boolean }) => void },
) {
  const at = ids.indexOf(id);
  store.remove(id);
  if (id !== current.threadId) return;
  const next = ids[at] ?? ids[at - 1];
  if (next) actions.open(next);
  else actions.openNewThread({ projectId: current.projectId ?? undefined, focusPrompt: true });
}

// ---- the slot element -------------------------------------------------------

function useStripSlot(): HTMLElement | null {
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  useEffect(() => {
    let current: HTMLElement | null = null;
    let scheduled = false;
    const sync = () => {
      scheduled = false;
      const shell = document.querySelector<HTMLElement>(SHELL);
      if (!shell) {
        if (current) {
          current.remove();
          current = null;
          setSlot(null);
        }
        return;
      }
      if (current && current.isConnected && shell.firstElementChild === current) return;
      current?.remove();
      current = document.createElement("div");
      current.setAttribute("data-bb-plugin-root", "");
      current.setAttribute("data-bb-plugin", "navaigate-workspace");
      current.setAttribute("data-nav-tabs", "");
      current.style.flex = "none";
      shell.insertBefore(current, shell.firstChild);
      setSlot(current);
    };
    const schedule = () => {
      if (scheduled) return;
      scheduled = true;
      requestAnimationFrame(sync);
    };
    sync();
    const mo = new MutationObserver(schedule);
    mo.observe(document.body, { childList: true, subtree: true });
    return () => {
      mo.disconnect();
      current?.remove();
    };
  }, []);
  return slot;
}

// ---- tabs -------------------------------------------------------------------

const DOT: Record<string, string> = {
  running: "bg-[var(--attention)] animate-pulse",
  needs: "bg-destructive",
  unread: "bg-primary",
  parked: "bg-transparent",
};

type TabProps = {
  id: string;
  thread: PluginSidebarThread | undefined;
  active: boolean;
  paneOpen: boolean;
  dragging: boolean;
  dropSide: "before" | "after" | null;
  onOpen: (split: boolean) => void;
  onClose: () => void;
  onDragStart: () => void;
  onDragOver: (after: boolean) => void;
  onDrop: () => void;
  onDragEnd: () => void;
};

const STATE_WORD: Record<string, string> = { running: "Working", needs: "Needs you", unread: "Finished, not read", parked: "Idle" };

function ago(ms: number): string {
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} d ago`;
}

/** Hover preview: the full title and where the chat stands, shown under the tab. */
function TabPreview({ anchor, thread, title }: { anchor: DOMRect; thread: PluginSidebarThread | undefined; title: string }) {
  const state = thread ? stateOf(thread) : "parked";
  const harness = thread ? harnessOf(thread.providerId).label : "";
  const left = Math.min(Math.max(8, anchor.left), window.innerWidth - 328);
  return createPortal(
    <div
      role="tooltip"
      className="pointer-events-none fixed z-[1000] w-[320px] rounded-lg border border-border bg-popover px-3 py-2.5 text-popover-foreground shadow-lg"
      style={{ left, top: anchor.bottom + 6 }}
    >
      <div className="font-medium leading-snug text-foreground" style={{ fontSize: 13 }}>{title}</div>
      <div className="mt-1 flex items-center gap-1.5 text-muted-foreground" style={{ fontSize: 11.5 }}>
        <span className={cn("h-1.5 w-1.5 rounded-full", DOT[state] === "bg-transparent" ? "bg-muted-foreground/50" : DOT[state])} aria-hidden="true" />
        <span>{STATE_WORD[state]}</span>
        {harness ? <span>· {harness}</span> : null}
        {thread?.updatedAt ? <span>· {ago(thread.updatedAt)}</span> : null}
      </div>
      <div className="mt-1.5 text-muted-foreground/80" style={{ fontSize: 10.5 }}>Click to open · ⌘-click opens beside · drag to reorder</div>
    </div>,
    document.body,
  );
}

function Tab(p: TabProps) {
  const split = useThreadSplit(p.id);
  const title = p.thread?.displayTitle || "Chat";
  const state = p.thread ? stateOf(p.thread) : "parked";
  const [hover, setHover] = useState<DOMRect | null>(null);
  const timer = useRef<number | null>(null);
  const clearHover = () => {
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = null;
    setHover(null);
  };
  useEffect(() => () => {
    if (timer.current) window.clearTimeout(timer.current);
  }, []);
  return (
    <div
      role="tab"
      aria-selected={p.active}
      aria-label={title}
      onMouseEnter={(e) => {
        const el = e.currentTarget;
        if (timer.current) window.clearTimeout(timer.current);
        timer.current = window.setTimeout(() => setHover(el.getBoundingClientRect()), 280);
      }}
      onMouseLeave={clearHover}
      onMouseDown={clearHover}
      draggable
      onDragStart={(e) => {
        clearHover();
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", p.id);
        p.onDragStart();
      }}
      onDragOver={(e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        const r = e.currentTarget.getBoundingClientRect();
        p.onDragOver(e.clientX > r.left + r.width / 2);
      }}
      onDrop={(e) => {
        e.preventDefault();
        e.stopPropagation();
        p.onDrop();
      }}
      onDragEnd={p.onDragEnd}
      onClick={(e) => p.onOpen(e.metaKey || e.ctrlKey)}
      onAuxClick={(e) => {
        if (e.button === 1) {
          e.preventDefault();
          p.onClose();
        }
      }}
      className={cn(
        "group relative flex h-8 min-w-[96px] max-w-[220px] flex-1 basis-0 cursor-default select-none items-center gap-1.5 rounded-t-lg border border-b-0 px-2 text-[12.5px] transition-colors",
        p.active
          ? "border-border bg-background text-foreground"
          : "border-transparent text-muted-foreground hover:bg-accent/60 hover:text-foreground",
        p.dragging && "opacity-40",
      )}
      style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
    >
      {p.dropSide ? (
        <span
          aria-hidden="true"
          className={cn("pointer-events-none absolute bottom-1 top-1 w-[2px] rounded-full bg-[var(--attention)]", p.dropSide === "before" ? "-left-[2px]" : "-right-[2px]")}
        />
      ) : null}
      {hover && !p.dragging ? <TabPreview anchor={hover} thread={p.thread} title={title} /> : null}
      {split.isAvailable ? (
        <span
          {...split.splitProps}
          aria-label="Drag to dock beside the open chat"
          title="Drag to dock beside the open chat"
          className="-ml-1 flex h-5 w-3 shrink-0 cursor-grab touch-none items-center justify-center rounded text-muted-foreground/0 hover:bg-accent group-hover:text-muted-foreground"
          onClick={(e) => e.stopPropagation()}
        >
          <svg width="8" height="12" viewBox="0 0 8 12" fill="currentColor" aria-hidden="true">
            <circle cx="2" cy="2" r="1" />
            <circle cx="6" cy="2" r="1" />
            <circle cx="2" cy="6" r="1" />
            <circle cx="6" cy="6" r="1" />
            <circle cx="2" cy="10" r="1" />
            <circle cx="6" cy="10" r="1" />
          </svg>
        </span>
      ) : null}
      <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", DOT[state])} aria-hidden="true" />
      <span className="min-w-0 flex-1 truncate">{title}</span>
      {p.paneOpen && !p.active ? <span className="h-1 w-1 shrink-0 rounded-full bg-[var(--attention)]" title="Open in a pane" /> : null}
      <button
        type="button"
        aria-label={`Close ${title}`}
        onClick={(e) => {
          e.stopPropagation();
          p.onClose();
        }}
        className="flex h-4 w-4 shrink-0 items-center justify-center rounded text-muted-foreground/0 hover:bg-accent hover:text-foreground group-hover:text-muted-foreground"
      >
        <svg width="8" height="8" viewBox="0 0 8 8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" aria-hidden="true">
          <path d="M1 1l6 6M7 1L1 7" />
        </svg>
      </button>
    </div>
  );
}

function Strip() {
  const pluginId = usePluginId();
  const { threadId, projectId } = useBbContext();
  const { threads, status } = useSidebarThreads();
  const actions = useThreadActions();
  const layout = useSidebarSplitLayout();
  const open = useSyncExternalStore(store.subscribe, store.get);
  const [dragId, setDragId] = useState<string | null>(null);
  const [over, setOver] = useState<{ id: string; after: boolean } | null>(null);
  const overRef = useRef<{ id: string; after: boolean } | null>(null);
  const endDrag = () => {
    setDragId(null);
    setOver(null);
    overRef.current = null;
  };

  useEffect(() => load(`${pluginId}:tabs:v1`), [pluginId]);

  // Chrome behaviour: visiting a chat opens a tab for it.
  useEffect(() => {
    if (threadId && storageKey) store.add(threadId);
  }, [threadId, open.length]);

  // A chat that was archived or deleted leaves the strip. Only prune once the
  // list is ready, and never the chat on screen.
  useEffect(() => {
    if (status !== "ready" || threads.length === 0) return;
    const known = new Set(threads.map((t) => t.id));
    store.keepOnly(ids.filter((id) => known.has(id) || id === threadId));
  }, [status, threads, threadId]);

  const byId = new Map(threads.map((t) => [t.id, t]));
  const paneIds = new Set(layout?.panes.map((x) => x.threadId).filter((x): x is string => !!x));
  const focused = layout?.panes.find((x) => x.isFocused)?.threadId ?? threadId;

  const close = useCallback(
    (id: string) => {
      const at = ids.indexOf(id);
      store.remove(id);
      if (id === threadId) {
        const next = ids[at] ?? ids[at - 1];
        if (next) actions.open(next);
        else actions.openNewThread({ projectId: projectId ?? undefined, focusPrompt: true });
      }
    },
    [actions, threadId, projectId],
  );

  if (open.length === 0) return null;

  return (
    <div
      role="tablist"
      aria-label="Open chats"
      className="flex h-9 items-end gap-0.5 border-b border-border bg-muted/40 px-2 pt-1"
      style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
      onDragOver={(e) => {
        if (dragId) e.preventDefault();
      }}
      onDrop={(e) => {
        // Dropped on the empty part of the strip: the tab goes to the end.
        e.preventDefault();
        if (dragId) store.move(dragId, overRef.current?.id ?? null, overRef.current?.after ?? true);
        endDrag();
      }}
    >
      {open.map((id) => (
        <Tab
          key={id}
          id={id}
          thread={byId.get(id)}
          active={id === focused}
          paneOpen={paneIds.has(id)}
          dragging={dragId === id}
          dropSide={dragId && dragId !== id && over?.id === id ? (over.after ? "after" : "before") : null}
          onOpen={(split) => actions.open(id, split ? { split: true } : undefined)}
          onClose={() => close(id)}
          onDragStart={() => setDragId(id)}
          onDragOver={(after) => {
            if (overRef.current?.id === id && overRef.current.after === after) return;
            overRef.current = { id, after };
            setOver({ id, after });
          }}
          onDrop={() => {
            if (dragId) store.move(dragId, id, overRef.current?.id === id ? overRef.current.after : false);
            endDrag();
          }}
          onDragEnd={endDrag}
        />
      ))}
      <button
        type="button"
        aria-label="New chat"
        title="New chat"
        onClick={() => actions.openNewThread({ projectId: projectId ?? undefined, focusPrompt: true })}
        className="mb-1 ml-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
      >
        <svg width="11" height="11" viewBox="0 0 11 11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
          <path d="M5.5 1v9M1 5.5h9" />
        </svg>
      </button>
    </div>
  );
}

export function TabStrip() {
  const slot = useStripSlot();
  return slot ? createPortal(<Strip />, slot) : null;
}
