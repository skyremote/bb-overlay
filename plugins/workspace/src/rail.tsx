// The rail: bb's sidebar thread list, run-sheet style.
//   NOW card -> harness filter -> Needs you -> Pinned -> one section per
//   project, each a tree of real folders (from project-folders) with chats
//   inside, every row marked with its harness.
// Every row has a right-click menu wired to bb's own thread actions; folders
// have their own. Chats drag onto folders; folders drag onto folders.
// With "Keep my order" on (plugin setting keepOrder), chats stay where the
// member put them: activity never re-sorts a row, a chat waiting on you stays
// in place instead of moving to Needs you, and a new chat joins the top of its
// list. Drag a chat onto another to put it above or below (onto a chat in
// another folder of the same project moves it there too); drop a folder on the
// top or bottom third of another to put it above or below, the middle to nest.
// Rail groups (kept only in rail state) hold whole projects and other groups;
// project headings drag onto them. Children of chats, folders and groups hang
// off explorer-style tree guides that turn gold while the branch is running.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DragEvent, KeyboardEvent, ReactNode } from "react";
import {
  experimental_Icon as Icon,
  experimental_useSidebarThreadActions as useThreadActions,
  experimental_useSidebarThreads as useSidebarThreads,
  type PluginSidebarProject,
  type PluginSidebarThread,
  type PluginThreadListProps,
} from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import { useBbNavigate, useSettings } from "@get-bb/plugin-sdk/app";
import { LogoOrb } from "./orb";
import { useVoiceState } from "./voice";
import { cn } from "@/lib/utils";
import { GOLD, GOLD_INK, Lattice, Node, ago, asksYou, byNewest, byPlace, byUrgencyThenRecent, caps, harnessOf, stateOf, tnum, type Harness } from "./shared";
import { PROJECT_FOLDERS_INSTALL, folderOfThread, goTo, newChatInFolderUrl, slug, useFolders, type Directory, type Folder, type FolderData } from "./folders";
import { Menu, MenuItem, MenuLabel, MenuSeparator, MenuSub } from "./menu";
import { TAG_CSS, useRailState, type LaterReason, type RailOps, type Tag } from "./rail-state";
import { ASK, AskMark, FinishedMark, LATER_LABEL, StatusMark } from "./status-mark";
import { TagChips, TagEditor, TagFilter, TagSwatches, type TagEdit } from "./tags";
import { NAV_SHORTCUT, setNavMode, useNavMode } from "./nav-fold";
import { BulkBar } from "./bulk-bar";
import { TodoBadge, useFolderTodoCounts } from "./todo";
import { CloudGlyph, MachineMark, useMachine, useMachineActions, type MachineItem } from "./machine";

/** Lowercase Roman numerals for the top-level sections: 1 -> "i", 14 -> "xiv". */
function roman(n: number): string {
  const table: Array<[number, string]> = [[1000, "m"], [900, "cm"], [500, "d"], [400, "cd"], [100, "c"], [90, "xc"], [50, "l"], [40, "xl"], [10, "x"], [9, "ix"], [5, "v"], [4, "iv"], [1, "i"]];
  let out = "";
  for (const [v, r] of table) while (n >= v) { out += r; n -= v; }
  return out;
}
const FOLD = 8;
const NEEDS_FOLD = 4;
const DRAG_THREAD = "application/x-nav-thread";
const DRAG_FOLDER = "application/x-nav-folder";

/** Keep my order: the chat being dragged, and the list it came from.
 *  dataTransfer cannot be read during dragover, so rows check this to show
 *  where a drop would land. Lists: "f:<folderId>", "p:<projectId>" (project
 *  root), "pinned", "later", "c:<parentId>" (sub-agent chats). */
type DragChat = { id: string; projectId: string; list: string };
let draggingChat: DragChat | null = null;
/** The folder being dragged, for the same reason. */
let draggingFolder: { id: string; projectId: string } | null = null;

/* ----------------------------- persistence ----------------------------- */

function usePersisted<T>(key: string, initial: T) {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = window.localStorage.getItem(key);
      return raw ? (JSON.parse(raw) as T) : initial;
    } catch {
      return initial;
    }
  });
  useEffect(() => {
    try {
      window.localStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* storage full or blocked: state stays in memory */
    }
  }, [key, value]);
  return [value, setValue] as const;
}

/** The single-tag filter from before 0.27 ("nav-skin:tag"), as the start of the multi-tag one. */
function readOldTagFilter(): string[] {
  try {
    const raw = window.localStorage.getItem("nav-skin:tag");
    const v = raw ? (JSON.parse(raw) as unknown) : null;
    return typeof v === "string" ? [v] : [];
  } catch {
    return [];
  }
}

const report = (verb: string) => (e: unknown) => toast.error(`${verb} failed`, { description: e instanceof Error ? e.message : String(e) });

/* ------------------------------ inline edit ---------------------------- */

function InlineInput({ initial, placeholder, depth, onSubmit, onCancel }: {
  initial: string;
  placeholder: string;
  depth: number;
  onSubmit: (value: string) => void;
  onCancel: () => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      const v = e.currentTarget.value.trim();
      if (v) onSubmit(v);
      else onCancel();
    } else if (e.key === "Escape") onCancel();
  };
  return (
    <div className="flex h-[34px] items-center pr-2" style={{ paddingLeft: 10 + depth * 16 }}>
      <input
        ref={ref}
        defaultValue={initial}
        placeholder={placeholder}
        onKeyDown={onKey}
        onBlur={onCancel}
        className="h-7 w-full rounded-md border border-[var(--attention)] bg-background px-2 text-[13px] text-foreground outline-none"
      />
    </div>
  );
}

/* ----------------------------- tree guides ----------------------------- */

const GUIDE = "color-mix(in srgb, var(--border) 60%, transparent)";

/**
 * One child in a tree, with the explorer-style guide drawn beside it: a
 * vertical line at `x` (under the parent's node) and a tick into this child's
 * row, or a rounded corner for the last child. Everything is absolutely
 * placed inside the existing left padding, so rows keep their height and
 * alignment. `mid` is the vertical centre of the child's own row; `lift`
 * pulls the first child's line up to meet the parent's node. The guide turns
 * gold while anything in the branch is running.
 */
function Twig({ x, tick, mid, first, last, lift, hot, children }: {
  x: number;
  tick: number;
  mid: number;
  first: boolean;
  last: boolean;
  lift: number;
  hot: boolean;
  children: ReactNode;
}) {
  const color = hot ? GOLD : GUIDE;
  const top = first ? -lift : 0;
  return (
    <div className="relative">
      {children}
      {last ? (
        <span
          aria-hidden
          className="pointer-events-none absolute rounded-bl-[5px]"
          style={{ left: x, top, height: mid - top + 1, width: tick, borderLeft: `1px solid ${color}`, borderBottom: `1px solid ${color}` }}
        />
      ) : (
        <>
          <span aria-hidden className="pointer-events-none absolute w-px" style={{ left: x, top, bottom: 0, background: color }} />
          <span aria-hidden className="pointer-events-none absolute h-px" style={{ left: x, top: mid, width: tick, background: color }} />
        </>
      )}
    </div>
  );
}

/** Wrap each child of one parent in its Twig. Items carry their own row centre (threads 17, folders 16). */
function twigs(items: Array<{ key: string; mid: number; el: ReactNode }>, guide: { x: number; tick: number; lift: number; hot: boolean }) {
  return items.map((it, i) => (
    <Twig key={it.key} x={guide.x} tick={guide.tick} mid={it.mid} lift={guide.lift} hot={guide.hot} first={i === 0} last={i === items.length - 1}>
      {it.el}
    </Twig>
  ));
}

/** A small stacked-folders glyph for rail groups (theme colour, no icon-set dependency). */
function GroupGlyph() {
  return (
    <svg aria-hidden viewBox="0 0 16 16" className="size-3.5 shrink-0 opacity-75" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round">
      <path d="M1.5 5.5V3.5a1 1 0 0 1 1-1h3l1.5 1.5h5.5a1 1 0 0 1 1 1" />
      <path d="M1.5 6.5a1 1 0 0 1 1-1h11a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1z" />
    </svg>
  );
}

/** An up-and-out arrow for "Move out of group". */
function OutGlyph() {
  return (
    <svg aria-hidden viewBox="0 0 16 16" className="size-3.5 shrink-0 opacity-75" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
      <path d="M13.5 13.5H7a2.5 2.5 0 0 1-2.5-2.5V3" />
      <path d="M1.5 6l3-3 3 3" />
    </svg>
  );
}

/* -------------------------------- rows --------------------------------- */

type FolderOption = { id: string | null; label: string; depth: number; group?: boolean };

type RowCtx = {
  ops: RailOps;
  /** Chats handed over to the always-on machine, keyed by this laptop's thread id. */
  machine: Record<string, MachineItem>;
  /** An always-on machine is set up, so the hand-off menu items show. */
  hasMachine: boolean;
  selecting: boolean;
  selected: ReadonlySet<string>;
  /** Handles ⌘/⇧-click and Select mode; returns true when the click was a selection. */
  onSelectGesture: (id: string, e: { metaKey: boolean; ctrlKey: boolean; shiftKey: boolean }) => boolean;
  onNewTag: (threadIds: string[]) => void;
  /** Keep my order: whether the dragged chat can be dropped next to this row (always false with the setting off). */
  canPlace: (dragged: DragChat, target: PluginSidebarThread, list: string) => boolean;
  /** Keep my order: put the dragged chat above (or below) this row, moving it to this row's folder if it came from another. */
  onPlace: (dragged: DragChat, target: PluginSidebarThread, list: string, after: boolean) => void;
  /** Row highlights setting: tint and mark finished, asking and failed rows. */
  highlights: boolean;
};

/** Copy the project-folders install line, for the greyed-out folder actions. */
function copyFoldersInstall() {
  void navigator.clipboard.writeText(PROJECT_FOLDERS_INSTALL).then(
    () => toast.success("Install command copied. Paste it into a terminal or a bb chat, then reload bb."),
    () => toast.message(PROJECT_FOLDERS_INSTALL),
  );
}

function ThreadRow({ thread, list, active, depth, now, onNavigate, moveTargets, foldersMissing, onMove, ctx }: {
  thread: PluginSidebarThread;
  /** The list this row sits in (see DragChat). */
  list: string;
  active: boolean;
  depth: number;
  now: number;
  onNavigate: () => void;
  moveTargets: FolderOption[] | null;
  foldersMissing: boolean;
  onMove: (folderId: string | null) => void;
  ctx: RowCtx;
}) {
  const actions = useThreadActions();
  const machineActions = useMachineActions();
  const onMachine = ctx.machine[thread.id];
  const [renaming, setRenaming] = useState(false);
  // Keep my order: where a dragged chat would land, above or below this row.
  const [dropAt, setDropAt] = useState<"before" | "after" | null>(null);
  const state = stateOf(thread);
  const h = harnessOf(thread.providerId);
  const later = (ctx.ops.state.later[thread.id]?.reason ?? null) as LaterReason | null;
  const tagIds = ctx.ops.state.assign[thread.id] ?? [];
  const tags = ctx.ops.state.tags.filter((t) => tagIds.includes(t.id));
  const isSelected = ctx.selected.has(thread.id);
  // Menu actions apply to the whole selection when this row is part of it.
  const targets = isSelected && ctx.selected.size > 1 ? [...ctx.selected] : [thread.id];

  if (renaming) {
    return (
      <InlineInput
        initial={thread.displayTitle}
        placeholder="Thread title"
        depth={depth}
        onCancel={() => setRenaming(false)}
        onSubmit={(v) => {
          setRenaming(false);
          actions.rename(thread.id, v).catch(report("Rename"));
        }}
      />
    );
  }

  const onDragStart = (e: DragEvent<HTMLAnchorElement>) => {
    e.dataTransfer.setData(DRAG_THREAD, JSON.stringify({ id: thread.id, projectId: thread.projectId }));
    e.dataTransfer.effectAllowed = "move";
    draggingChat = { id: thread.id, projectId: thread.projectId, list };
  };
  const placeable = () => draggingChat !== null && draggingChat.id !== thread.id && ctx.canPlace(draggingChat, thread, list);
  const half = (e: DragEvent<HTMLElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return e.clientY - r.top < r.height / 2 ? ("before" as const) : ("after" as const);
  };

  // Row highlights: a finished chat (its agent stopped since you last opened
  // it), one asking you a question, or one that failed is marked in place:
  // tinted row, coloured edge, bold title. Green finished, blue asking, red failed.
  const finished = ctx.highlights && state === "unread" && !active;
  const asking = ctx.highlights && asksYou(thread) && !active;
  const failed = ctx.highlights && state === "needs" && !active && !asking;
  const flag = finished ? "var(--success)" : asking ? ASK : failed ? "var(--destructive)" : null;

  const anchor = (
    <a
      href={thread.href}
      onClick={(e) => {
        if (ctx.onSelectGesture(thread.id, e)) {
          e.preventDefault();
          return;
        }
        onNavigate();
      }}
      aria-selected={ctx.selecting || ctx.selected.size > 0 ? isSelected : undefined}
      draggable
      onDragStart={onDragStart}
      onDragEnd={() => {
        draggingChat = null;
      }}
      onDragOver={(e) => {
        if (!placeable()) return;
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = "move";
        setDropAt(half(e));
      }}
      onDragLeave={() => setDropAt(null)}
      onDrop={(e) => {
        setDropAt(null);
        const dragged = draggingChat;
        if (!dragged || !placeable()) return;
        e.preventDefault();
        e.stopPropagation();
        draggingChat = null;
        ctx.onPlace(dragged, thread, list, half(e) === "after");
      }}
      data-sidebar-thread-shortcut-target=""
      data-sidebar-thread-id={thread.id}
      aria-current={active ? "page" : undefined}
      aria-label={`${thread.displayTitle}, ${h.label}${finished ? ", finished, not opened yet" : asking ? ", waiting for your answer" : ""}${thread.indicatorLabel ? `, ${thread.indicatorLabel}` : ""}`}
      title={thread.displayTitle}
      className={cn(
        "group relative flex h-[34px] items-center gap-2.5 rounded-md pr-2 text-[13.5px] no-underline outline-none transition-colors",
        "hover:bg-[var(--state-hover)] focus-visible:ring-1 focus-visible:ring-ring data-[state=open]:bg-accent",
        active ? "bg-accent font-semibold text-foreground" : state === "parked" && !later ? "text-muted-foreground" : "text-foreground",
        flag && "font-semibold",
        isSelected && "bg-[var(--surface-selected)] ring-1 ring-inset ring-[var(--surface-selected-border)]",
      )}
      // isolate: the highlight tint sits above the row's own hover colour but under its text.
      style={{ paddingLeft: 10 + depth * 16, isolation: "isolate" }}
    >
      {flag && !isSelected ? (
        <span aria-hidden className="pointer-events-none absolute inset-0 rounded-md" style={{ zIndex: -1, background: `color-mix(in srgb, ${flag} 11%, transparent)` }} />
      ) : null}
      {active ? <span aria-hidden className="absolute inset-y-2 left-0 w-[2px]" style={{ background: GOLD }} /> : flag ? <span aria-hidden className="absolute rounded-full" style={{ left: 0, top: 6, bottom: 6, width: 3, background: flag }} /> : null}
      {dropAt ? (
        <span aria-hidden className="pointer-events-none absolute rounded-full" style={{ left: 4, right: 4, height: 2, background: GOLD, zIndex: 1, ...(dropAt === "before" ? { top: -1 } : { bottom: -1 }) }} />
      ) : null}
      {ctx.selecting ? (
        <span aria-hidden className={cn("inline-flex size-[13px] shrink-0 items-center justify-center rounded-[3px] border", isSelected ? "border-foreground bg-foreground text-background" : "border-input bg-background")}>
          {isSelected ? <Icon name="Check" className="size-2.5" /> : null}
        </span>
      ) : asking ? (
        <span className="inline-flex w-[11px] shrink-0 items-center justify-center"><AskMark size={14} /></span>
      ) : later && state !== "running" ? (
        <span className="inline-flex w-[11px] shrink-0 items-center justify-center"><StatusMark reason={later} size={13} /></span>
      ) : finished ? (
        <span className="inline-flex w-[11px] shrink-0 items-center justify-center"><FinishedMark size={14} /></span>
      ) : (
        <Node state={state} />
      )}
      <span className="min-w-0 flex-1 truncate">{thread.displayTitle}</span>
      {onMachine ? <MachineMark item={onMachine} threadId={thread.id} /> : null}
      <TagSwatches tags={tags} />
      {thread.isPinned ? <Icon name="Pin" className="size-3 shrink-0 opacity-50" /> : null}
      <span className="shrink-0 text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground/80">{h.label}</span>
      <span className="w-6 shrink-0 text-right text-[11px] text-muted-foreground" style={tnum}>
        {ago(thread.updatedAt, now)}
      </span>
    </a>
  );

  return (
    <Menu trigger={anchor}>
      <MenuItem icon="ArrowUpRight" label="Open" onSelect={() => { actions.open(thread.id); onNavigate(); }} />
      <MenuItem icon="Columns2" label="Open in split" onSelect={() => { actions.open(thread.id, { split: true }); onNavigate(); }} />
      <MenuSeparator />
      <MenuItem icon={thread.isPinned ? "Pin" : "Pin"} label={thread.isPinned ? "Unpin" : "Pin"} onSelect={() => actions.setPinned(thread.id, !thread.isPinned).catch(report("Pin"))} />
      <MenuItem
        icon={thread.isUnread ? "Mail" : "Mail"}
        label={thread.isUnread ? "Mark as read" : "Mark as unread"}
        onSelect={() => actions.setRead(thread.id, thread.isUnread).catch(report("Update"))}
      />
      <MenuItem icon="Edit" label="Rename" onSelect={() => setRenaming(true)} />
      <MenuSeparator />
      <MenuSub icon="Clock" label={targets.length > 1 ? `Come back later (${targets.length})` : "Come back later"}>
        {(["revisit", "done", "mistake"] as const).map((r) => (
          <MenuItem key={r} lead={<StatusMark reason={r} size={13} />} label={LATER_LABEL[r]} checked={later === r && targets.length === 1} onSelect={() => void ctx.ops.setLater(targets, r)} />
        ))}
        {later ? <MenuSeparator /> : null}
        {later ? <MenuItem icon="X" label="Clear the flag" onSelect={() => void ctx.ops.setLater(targets, null)} /> : null}
      </MenuSub>
      <MenuSub icon="ListTodo" label={targets.length > 1 ? `Tags (${targets.length})` : "Tags"}>
        {ctx.ops.state.tags.map((t) => {
          const on = targets.every((id) => (ctx.ops.state.assign[id] ?? []).includes(t.id));
          return <MenuItem key={t.id} swatch={TAG_CSS[t.color]} label={t.name} checked={on} onSelect={() => void ctx.ops.applyTag(targets, t.id, !on)} />;
        })}
        {ctx.ops.state.tags.length > 0 ? <MenuSeparator /> : null}
        <MenuItem icon="Plus" label="New tag…" onSelect={() => ctx.onNewTag(targets)} />
      </MenuSub>
      <MenuSeparator />
      {ctx.hasMachine ? (
        <>
          <MenuItem lead={<CloudGlyph />} label={onMachine ? "Send to my always-on machine again" : "Send to my always-on machine"} onSelect={() => void machineActions.send(thread)} />
          {onMachine ? <MenuItem icon="ArrowUpRight" label="Watch on my machine" onSelect={() => machineActions.watch(onMachine)} /> : null}
          {onMachine ? <MenuItem icon="Copy" label="Pull results from my machine" onSelect={() => void machineActions.pull(thread.id, onMachine)} /> : null}
          <MenuSeparator />
        </>
      ) : null}
      <MenuItem icon="Check" label={isSelected ? "Deselect" : "Select"} hint="⌘-click" onSelect={() => ctx.onSelectGesture(thread.id, { metaKey: true, ctrlKey: false, shiftKey: false })} />
      {moveTargets && moveTargets.length > 0 ? (
        <MenuSub icon="FolderEdit" label="Move to folder">
          {moveTargets.map((t) => (
            <MenuItem key={t.id ?? "root"} icon={t.id ? "Folder" : "Folder"} label={`${"  ".repeat(t.depth)}${t.label}`} onSelect={() => onMove(t.id)} />
          ))}
        </MenuSub>
      ) : foldersMissing && moveTargets ? (
        <MenuItem muted icon="FolderEdit" label="Move to folder" hint="Install project-folders to use folders" onSelect={copyFoldersInstall} />
      ) : null}
      <MenuItem
        icon="Copy"
        label="Copy link"
        onSelect={() => void navigator.clipboard?.writeText(new URL(thread.href, window.location.origin).toString())}
      />
      <MenuSeparator />
      <MenuItem icon="Archive" label="Archive" onSelect={() => actions.archive(thread.id)} />
      <MenuItem icon="Trash2" label="Delete…" danger onSelect={() => actions.requestDelete(thread.id)} />
    </Menu>
  );
}

/* ------------------------------ sections ------------------------------- */

const DRAG_SECTION = "application/x-nav-section";

function Section({ id, label, numeral, count, actions, onDrop, menu, collapsed, onToggle, onReorder, onNest, nested, mark, children }: {
  id: string;
  label: string;
  numeral?: string;
  count: number;
  actions?: ReactNode;
  onDrop?: (e: DragEvent<HTMLElement>) => void;
  menu?: ReactNode;
  collapsed: boolean;
  onToggle: () => void;
  /** Drop another section header here to put it above this one. */
  onReorder: (draggedId: string, beforeId: string) => void;
  /** Rail groups only: drop a section header on the lower part of the heading to put it inside. */
  onNest?: (draggedId: string) => void;
  /** Inside a rail group: no top rule, tighter spacing (the tree guide does the separating). */
  nested?: boolean;
  mark?: ReactNode;
  children: ReactNode;
}) {
  const [over, setOver] = useState<"item" | "section" | "into" | null>(null);
  // Upper third of a group heading = "put above"; the rest = "put inside".
  const zone = (e: DragEvent<HTMLElement>) => {
    if (!onNest) return "section" as const;
    const r = e.currentTarget.getBoundingClientRect();
    return e.clientY - r.top < r.height / 3 ? ("section" as const) : ("into" as const);
  };
  const heading = (
    <h3
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData(DRAG_SECTION, id);
        e.dataTransfer.effectAllowed = "move";
      }}
      className={cn(
        caps,
        "group relative mx-1 mb-1.5 flex h-6 cursor-pointer select-none items-center justify-between rounded-md",
        over === "item" && "bg-accent",
        over === "into" && "bg-accent ring-1 ring-[var(--attention)]",
      )}
      onClick={onToggle}
      onDragOver={(e) => {
        const isSection = e.dataTransfer.types.includes(DRAG_SECTION);
        if (!isSection && !onDrop) return;
        e.preventDefault();
        setOver(isSection ? zone(e) : "item");
      }}
      onDragLeave={() => setOver(null)}
      onDrop={(e) => {
        setOver(null);
        const dragged = e.dataTransfer.getData(DRAG_SECTION);
        if (dragged) {
          e.preventDefault();
          if (dragged === id) return;
          if (zone(e) === "into" && onNest) onNest(dragged);
          else onReorder(dragged, id);
          return;
        }
        onDrop?.(e);
      }}
      title={onNest ? "Click to fold · drag to reorder · drop a project here to put it inside" : "Click to fold · drag to reorder"}
    >
      {over === "section" ? <span aria-hidden className="absolute -top-1 left-0 right-0 h-[2px] rounded-full" style={{ background: GOLD }} /> : null}
      <span className="flex min-w-0 items-center gap-2">
        <Icon name="ChevronRight" className={cn("size-3 shrink-0 transition-transform", !collapsed && "rotate-90")} />
        {numeral ? (
          <i className="-ml-0.5 font-serif text-[14px] normal-case tracking-normal" style={{ color: GOLD_INK }}>
            {numeral}
          </i>
        ) : null}
        {mark}
        <span className="truncate">{label}</span>
      </span>
      <span className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
        {actions ? <span className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">{actions}</span> : null}
        <span className="w-5 text-right" style={tnum}>{count}</span>
      </span>
    </h3>
  );
  return (
    <section className={nested ? "mb-1 pt-1" : "mb-4 border-t border-border pt-3"}>
      {menu ? <Menu trigger={heading}>{menu}</Menu> : heading}
      {collapsed ? null : children}
    </section>
  );
}

/** Shown at the top of an open group while one of its projects or groups is dragged: drop to take it out. */
function OutStrip({ onDrop }: { onDrop: (draggedId: string) => void }) {
  const [over, setOver] = useState(false);
  return (
    <div
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes(DRAG_SECTION)) return;
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        setOver(false);
        const dragged = e.dataTransfer.getData(DRAG_SECTION);
        if (!dragged) return;
        e.preventDefault();
        onDrop(dragged);
      }}
      className={cn(
        "mx-1 mb-1.5 flex h-8 items-center justify-center rounded-md border border-dashed text-[12px] transition-colors",
        over ? "border-[var(--attention)] bg-accent text-foreground" : "border-border text-muted-foreground",
      )}
    >
      Drop here to take it out of the group
    </div>
  );
}

function IconButton({ icon, label, onClick }: { icon: string; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={(e) => { e.preventDefault(); e.stopPropagation(); onClick(); }}
      className="inline-flex size-6 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
    >
      <Icon name={icon} className="size-3.5" />
    </button>
  );
}

/* -------------------------------- rail --------------------------------- */

type Draft =
  | { kind: "new"; projectId: string; parentId: string | null }
  | { kind: "rename"; folder: Folder }
  | { kind: "group-new"; parentId: string | null; members: string[] }
  | { kind: "group-rename"; id: string };

export function Rail({ activeThreadId, activeProjectId, onNavigate }: PluginThreadListProps) {
  const { status, threads, projects } = useSidebarThreads();
  const actions = useThreadActions();
  const [harness, setHarness] = usePersisted<string | null>("nav-skin:harness", null);
  const [collapsed, setCollapsed] = usePersisted<Record<string, boolean>>("nav-skin:collapsed", {});
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [draft, setDraft] = useState<Draft | null>(null);
  const [dirs, setDirs] = useState<Record<string, Directory[] | "loading">>({});
  const [picker, setPicker] = useState<string | null>(null);
  const folders = useFolders(threads.length);
  const ops = useRailState();
  const todoCounts = useFolderTodoCounts();
  // Several tags at once now; the old single-tag key seeds it once.
  const [tagFilter, setTagFilter] = usePersisted<string[]>("nav-skin:tags", readOldTagFilter());
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const anchor = useRef<string | null>(null);
  const orderRef = useRef<string[]>([]);
  const [tagEdit, setTagEditState] = useState<TagEdit>(null);
  // Chats a new tag goes onto once it is made (from a row's or the bulk bar's New tag…).
  const tagTargets = useRef<string[]>([]);
  // The dropdown's own New tag… goes onto no chats; only newTagFor sets targets.
  const setTagEdit = useCallback((e: TagEdit) => {
    if (e?.kind === "new") tagTargets.current = [];
    setTagEditState(e);
  }, []);
  const newTagFor = useCallback((ids: string[]) => {
    tagTargets.current = ids;
    setTagEditState({ kind: "new" });
  }, []);
  const navMode = useNavMode();
  // Which section heading is being dragged, so open groups can offer a "take it out" strip.
  const [draggingSection, setDraggingSection] = useState<string | null>(null);
  useEffect(() => {
    const start = (e: globalThis.DragEvent) => {
      const id = e.dataTransfer?.types.includes(DRAG_SECTION) ? e.dataTransfer.getData(DRAG_SECTION) : "";
      if (id) setDraggingSection(id);
    };
    const end = () => setDraggingSection(null);
    window.addEventListener("dragstart", start);
    window.addEventListener("dragend", end);
    window.addEventListener("drop", end);
    return () => {
      window.removeEventListener("dragstart", start);
      window.removeEventListener("dragend", end);
      window.removeEventListener("drop", end);
    };
  }, []);
  const now = Date.now();

  const tagKey = ops.state.tags.filter((t) => tagFilter.includes(t.id)).map((t) => t.id).join(",");
  const activeTags = useMemo(() => (tagKey ? tagKey.split(",") : []), [tagKey]);
  const { values: settings } = useSettings();
  const keepOrder = settings?.keepOrder === true;
  const highlights = settings?.rowHighlights === true;
  const place = ops.state.threadOrder ?? [];
  const model = useMemo(
    () => buildModel(threads, projects, folders.available ? folders.data : null, harness, activeProjectId, ops.state, activeTags, keepOrder),
    [threads, projects, folders.available, folders.data, harness, activeProjectId, ops.state, activeTags, keepOrder],
  );

  // Keep my order: give every chat a fixed place the first time the rail sees
  // it. The first run (nothing saved yet) keeps the order on screen at that
  // moment; after that a new chat joins the top of its list. Each chat is
  // tried once per session, so a failed save cannot loop.
  const triedPlace = useRef(new Set<string>());
  useEffect(() => {
    if (!keepOrder || !ops.loaded || status === "loading" || status === "error") return;
    const placed = new Set(place);
    const fresh = threads.filter((t) => !t.isArchived && !t.isHidden && !t.parentThreadId && !placed.has(t.id) && !triedPlace.current.has(t.id));
    if (fresh.length === 0) return;
    fresh.sort(place.length === 0 ? byUrgencyThenRecent : byNewest);
    for (const t of fresh) triedPlace.current.add(t.id);
    void ops.setThreadOrder([...fresh.map((t) => t.id), ...place]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keepOrder, ops.loaded, place, status, threads]);

  const clearSelection = useCallback(() => {
    setSelected(new Set());
    setSelecting(false);
    anchor.current = null;
  }, []);
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape" && (selected.size > 0 || selecting)) clearSelection();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selected.size, selecting, clearSelection]);

  const onSelectGesture = useCallback(
    (id: string, e: { metaKey: boolean; ctrlKey: boolean; shiftKey: boolean }) => {
      if (e.shiftKey && anchor.current) {
        const order = orderRef.current;
        const a = order.indexOf(anchor.current);
        const b = order.indexOf(id);
        if (a >= 0 && b >= 0) {
          const [lo, hi] = a < b ? [a, b] : [b, a];
          setSelected((cur) => new Set([...cur, ...order.slice(lo, hi + 1)]));
          return true;
        }
      }
      if (e.metaKey || e.ctrlKey || selecting) {
        setSelected((cur) => {
          const next = new Set(cur);
          if (next.has(id)) next.delete(id);
          else next.add(id);
          return next;
        });
        anchor.current = id;
        return true;
      }
      if (selected.size > 0) setSelected(new Set());
      anchor.current = id;
      return false;
    },
    [selecting, selected.size],
  );
  const machine = useMachine();
  // Keep my order: drag a chat onto another. Same list reorders; another folder
  // (or the root) of the same project also moves it there. Pinned, Come back
  // later and sub-agent chats reorder only among themselves.
  const isRootList = (l: string) => l.startsWith("f:") || l.startsWith("p:");
  const canPlace = (dragged: DragChat, target: PluginSidebarThread, list: string) =>
    keepOrder && (dragged.list === list || (folders.available && isRootList(dragged.list) && isRootList(list) && dragged.projectId === target.projectId));
  const onPlace = (dragged: DragChat, target: PluginSidebarThread, list: string, after: boolean) => {
    if (dragged.list !== list) folders.placeThread(dragged.id, target.projectId, list.startsWith("f:") ? list.slice(2) : null).catch(report("Move"));
    const order = place.filter((id) => id !== dragged.id);
    let at = order.indexOf(target.id);
    if (at < 0) {
      order.unshift(target.id);
      at = 0;
    }
    order.splice(after ? at + 1 : at, 0, dragged.id);
    void ops.setThreadOrder(order);
  };
  const rowCtx: RowCtx = { ops, machine: machine.items, hasMachine: machine.configured, selecting, selected, onSelectGesture, onNewTag: newTagFor, canPlace, onPlace, highlights };
  const renderOrder: string[] = [];

  const loadDirs = useCallback(
    (projectId: string, folderId: string | null) => {
      const key = `${projectId}:${folderId ?? ""}`;
      if (dirs[key]) return;
      setDirs((d) => ({ ...d, [key]: "loading" }));
      folders.browse(projectId, folderId).then(
        (list) => setDirs((d) => ({ ...d, [key]: list })),
        (e) => { setDirs((d) => ({ ...d, [key]: [] })); report("Listing folders")(e); },
      );
    },
    [dirs, folders],
  );

  if (status === "loading" && threads.length === 0) return <p className={cn(caps, "px-3 py-4")}>Loading the room…</p>;
  if (status === "error") return <p className="px-3 py-4 text-[12px] text-destructive">Could not load threads.</p>;

  const toggle = (id: string) => setCollapsed((c) => ({ ...c, [id]: !c[id] }));

  const onDropInto = (projectId: string, folderId: string | null) => (e: DragEvent<HTMLElement>) => {
    e.preventDefault();
    const t = e.dataTransfer.getData(DRAG_THREAD);
    const f = e.dataTransfer.getData(DRAG_FOLDER);
    if (t) {
      const { id, projectId: from } = JSON.parse(t) as { id: string; projectId: string };
      if (from !== projectId) return toast.error("Chats can only move between folders of the same project.");
      folders.placeThread(id, projectId, folderId).catch(report("Move"));
    } else if (f) {
      const { id, projectId: from } = JSON.parse(f) as { id: string; projectId: string };
      if (from !== projectId || id === folderId) return;
      if (folderId && model.isDescendant(folderId, id)) return toast.error("A folder cannot move inside itself.");
      folders.reparentFolder(id, folderId).catch(report("Move"));
    }
  };

  // Keep my order: a folder dropped on the top or bottom edge of another lands
  // just above or below it, among that folder's siblings (leaving its old
  // parent if needed). The order is saved in project-folders (its reorder
  // RPC), so its own pages agree and nothing moves on disk.
  const placeFolder = async (draggedId: string, target: Folder, after: boolean) => {
    const data = folders.data;
    if (!data || draggedId === target.id) return;
    const dragged = data.folders.find((x) => x.id === draggedId);
    if (!dragged || dragged.projectId !== target.projectId) return void toast.error("Folders can only move within the same project.");
    const parentId = target.parentId ?? null;
    if (parentId && model.isDescendant(parentId, draggedId)) return void toast.error("A folder cannot move inside itself.");
    const ids = data.folders
      .filter((x) => x.projectId === target.projectId && (x.parentId ?? null) === parentId && x.id !== draggedId)
      .sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0) || a.name.localeCompare(b.name))
      .map((x) => x.id);
    const at = ids.indexOf(target.id);
    ids.splice(after ? at + 1 : at, 0, draggedId);
    try {
      if ((dragged.parentId ?? null) !== parentId) await folders.reparentFolder(draggedId, parentId);
      await folders.reorderFolders(target.projectId, parentId, ids);
    } catch (e) {
      report("Move")(e);
    }
  };

  // Sub-agent chats hang under their parent at every depth, joined by a guide
  // from the parent's node (thread rows: node centre at 15.5 + depth * 16).
  const hasRunning = (t: PluginSidebarThread): boolean =>
    (model.children.get(t.id) ?? []).some((c) => stateOf(c) === "running" || hasRunning(c));
  const renderThread = (t: PluginSidebarThread, depth: number, list: string, child = false): ReactNode => {
    renderOrder.push(t.id);
    const kids = model.children.get(t.id) ?? [];
    return (
      <div key={t.id}>
        <ThreadRow
          ctx={rowCtx}
          thread={t}
          list={list}
          active={t.id === activeThreadId}
          depth={depth}
          now={now}
          onNavigate={onNavigate}
          moveTargets={child ? null : (model.moveTargets.get(t.projectId) ?? []).filter((o) => !o.group)}
          foldersMissing={!folders.available}
          onMove={(folderId) => folders.placeThread(t.id, t.projectId, folderId).catch(report("Move"))}
        />
        {kids.length > 0
          ? twigs(
              kids.map((c) => ({ key: c.id, mid: 17, el: renderThread(c, depth + 1, `c:${t.id}`, true) })),
              { x: 15 + depth * 16, tick: 9, lift: 10, hot: hasRunning(t) },
            )
          : null}
      </div>
    );
  };

  const isDrafting = (projectId: string, parentId: string | null) =>
    draft?.kind === "new" && draft.projectId === projectId && draft.parentId === parentId;
  const renderDraft = (projectId: string, parentId: string | null, depth: number) =>
    isDrafting(projectId, parentId) ? (
      <InlineInput
        initial=""
        placeholder="Folder name"
        depth={depth}
        onCancel={() => setDraft(null)}
        onSubmit={(name) => {
          setDraft(null);
          folders.createFolder(projectId, parentId, name).then(() => toast.success(`Created ${slug(name)}`), report("Create folder"));
        }}
      />
    ) : null;

  const renderFolder = (f: Folder, depth: number): ReactNode => {
    const node = model.folderNodes.get(f.id);
    if (!node) return null;
    const isOpen = !collapsed[f.id];
    if (draft?.kind === "rename" && draft.folder.id === f.id) {
      return (
        <InlineInput
          key={f.id}
          initial={f.name}
          placeholder="Folder name"
          depth={depth}
          onCancel={() => setDraft(null)}
          onSubmit={(name) => { setDraft(null); folders.renameFolder(f.projectId, f.id, name).catch(report("Rename")); }}
        />
      );
    }
    const dirKey = `${f.projectId}:${f.id}`;
    const dirList = dirs[dirKey];
    const newInside = () => { setCollapsed((c) => ({ ...c, [f.id]: false })); setDraft({ kind: "new", projectId: f.projectId, parentId: f.id }); };
    return (
      <div key={f.id}>
        <FolderRow
          folder={f}
          depth={depth}
          open={isOpen}
          count={node.total}
          live={node.live}
          todos={todoCounts.get(f.id) ?? 0}
          onToggle={() => toggle(f.id)}
          onDrop={onDropInto(f.projectId, f.id)}
          onPlace={keepOrder ? (id, after) => void placeFolder(id, f, after) : null}
          onNewChat={f.kind === "group" ? null : () => { goTo(newChatInFolderUrl(f.projectId, f.id)); onNavigate(); }}
          onNewFolder={newInside}
          menu={(
            <>
              {f.kind !== "group" ? <MenuItem icon="MessageCirclePlus" label="New chat here" onSelect={() => { goTo(newChatInFolderUrl(f.projectId, f.id)); onNavigate(); }} /> : null}
              <MenuItem icon="FolderPlus" label="New folder inside" onSelect={newInside} />
              <MenuSub icon="Search" label="Add existing subfolder" onOpen={() => loadDirs(f.projectId, f.id)}>
                <DirectoryItems list={dirList} taken={model.takenPaths} onPick={(d) => folders.createFolder(f.projectId, f.id, d.name, d.relative).catch(report("Add folder"))} />
              </MenuSub>
              <MenuSeparator />
              <MenuItem icon="Edit" label="Rename" onSelect={() => setDraft({ kind: "rename", folder: f })} />
              <MenuSub icon="FolderEdit" label="Move to">
                {(model.moveTargets.get(f.projectId) ?? [])
                  .filter((o) => o.id !== f.id && !(o.id && model.isDescendant(o.id, f.id)))
                  .map((o) => (
                    <MenuItem key={o.id ?? "root"} icon={o.id ? "Folder" : "Folder"} label={`${"  ".repeat(o.depth)}${o.label}`} onSelect={() => folders.reparentFolder(f.id, o.id).catch(report("Move"))} />
                  ))}
              </MenuSub>
              <MenuItem icon="Copy" label="Copy path" hint={f.path.split("/").slice(-1)[0]} onSelect={() => void navigator.clipboard?.writeText(f.path)} />
              <MenuSeparator />
              <MenuItem icon="FolderMinus" label="Remove from rail" hint="keeps files" onSelect={() => folders.forgetFolder(f.projectId, f.id).catch(report("Remove"))} />
            </>
          )}
        />
        {isOpen
          ? twigs(
              [
                ...(isDrafting(f.projectId, f.id) ? [{ key: "__draft", mid: 17, el: renderDraft(f.projectId, f.id, depth + 1) }] : []),
                ...node.subfolders.map((sf) => ({ key: sf.id, mid: 16, el: renderFolder(sf, depth + 1) })),
                ...node.threads.map((t) => ({ key: t.id, mid: 17, el: renderThread(t, depth + 1, `f:${f.id}`) })),
              ],
              // Folder rows: chevron centre at 13 + depth * 16.
              { x: 13 + depth * 16, tick: 10, lift: 8, hot: node.live },
            )
          : null}
      </div>
    );
  };

  type Group = (typeof model.groups)[number];
  const renderGroup = (g: Group, sid: string, numeral: string | undefined, nested: boolean) => {
    const label = g.project ? (g.project.isPersonal ? "Personal" : g.project.name) : "Other";
    const canFolder = folders.available && g.hasRoot;
    const open = !!expanded[g.id] || g.loose.length <= FOLD + 2;
    const loose = open ? g.loose : g.loose.slice(0, FOLD);
    const rootDirs = dirs[`${g.id}:`];
    const isCollapsed = ops.state.collapsed.includes(sid);
    return (
      <Section
        key={sid}
        id={sid}
        label={label}
        numeral={numeral}
        nested={nested}
        count={g.total}
        collapsed={isCollapsed}
        onToggle={() => ops.setCollapsed(sid, !isCollapsed)}
        onReorder={reorder}
        onDrop={canFolder ? onDropInto(g.id, null) : undefined}
        actions={
          <>
            <IconButton icon="MessageCirclePlus" label={`New chat in ${label}`} onClick={() => { actions.openNewThread({ projectId: g.id, focusPrompt: true }); onNavigate(); }} />
            {canFolder ? <IconButton icon="FolderPlus" label={`New folder in ${label}`} onClick={() => { if (isCollapsed) ops.setCollapsed(sid, false); setDraft({ kind: "new", projectId: g.id, parentId: null }); }} /> : null}
            {canFolder ? <IconButton icon="FolderOpen" label={`Add folders from the drive to ${label}`} onClick={() => { if (isCollapsed) ops.setCollapsed(sid, false); loadDirs(g.id, null); setPicker((p) => (p === g.id ? null : g.id)); }} /> : null}
          </>
        }
        menu={
          <>
            <MenuLabel>{label}</MenuLabel>
            <MenuItem icon="MessageCirclePlus" label="New chat" onSelect={() => { actions.openNewThread({ projectId: g.id, focusPrompt: true }); onNavigate(); }} />
            {canFolder ? <MenuItem icon="FolderPlus" label="New folder" onSelect={() => setDraft({ kind: "new", projectId: g.id, parentId: null })} /> : null}
            {canFolder ? (
              <MenuSub icon="Search" label="Add existing folder" onOpen={() => loadDirs(g.id, null)}>
                <DirectoryItems list={rootDirs} taken={model.takenPaths} onPick={(d) => folders.createFolder(g.id, null, d.name, d.relative).catch(report("Add folder"))} />
              </MenuSub>
            ) : null}
            <MenuSeparator />
            <MenuItem icon="ChevronsUp" label="Move to top of list" onSelect={() => toTop(sid)} />
            {groupMenu(sid)}
            <MenuItem icon={isCollapsed ? "ChevronsDown" : "ChevronsUp"} label={isCollapsed ? "Unfold section" : "Fold section"} onSelect={() => ops.setCollapsed(sid, !isCollapsed)} />
            {canFolder ? <MenuItem icon="ChevronsUp" label="Collapse all folders" onSelect={() => setCollapsed((c) => ({ ...c, ...Object.fromEntries(g.allFolderIds.map((id) => [id, true])) }))} /> : null}
            {canFolder ? <MenuItem icon="ChevronsDown" label="Expand all folders" onSelect={() => setCollapsed((c) => ({ ...c, ...Object.fromEntries(g.allFolderIds.map((id) => [id, false])) }))} /> : null}
          </>
        }
      >
        {renderDraft(g.id, null, 0)}
        {picker === g.id ? (
          <DrivePicker
            list={rootDirs}
            taken={model.takenPaths}
            onClose={() => setPicker(null)}
            onPick={(d) => folders.createFolder(g.id, null, d.name, d.relative).then(() => toast.success(`Added ${d.name}`), report("Add folder"))}
          />
        ) : null}
        {canFolder && g.folders.length === 0 && picker !== g.id && !(draft?.kind === "new" && draft.projectId === g.id) ? (
          <div className="mx-1 mb-1 flex h-8 items-center gap-3 rounded-md border border-dashed border-border px-2.5 text-[12px] text-muted-foreground">
            <Icon name="Folder" className="size-3.5 opacity-60" />
            <button type="button" className="hover:text-foreground hover:underline" onClick={() => setDraft({ kind: "new", projectId: g.id, parentId: null })}>New folder</button>
            <span aria-hidden>·</span>
            <button type="button" className="hover:text-foreground hover:underline" onClick={() => { loadDirs(g.id, null); setPicker(g.id); }}>Add from drive</button>
          </div>
        ) : null}
        {g.folders.map((f) => renderFolder(f, 0))}
        {loose.map((t) => renderThread(t, 0, `p:${g.id}`))}
        <More shown={loose.length} total={g.loose.length} open={open && g.loose.length > FOLD + 2} onToggle={() => setExpanded((o) => ({ ...o, [g.id]: !open }))} />
      </Section>
    );
  };

  const collapsedSet = new Set(ops.state.collapsed);
  type Entry = { id: string; el: (numeral: string | undefined, nested: boolean) => ReactNode; live: boolean; count: number };
  const sections: Entry[] = [];

  if (model.later.length > 0) {
    sections.push({
      id: "later",
      el: () => (
        <Section
          key="later"
          id="later"
          label="Come back later"
          mark={<StatusMark reason="revisit" size={12} />}
          count={model.later.length}
          collapsed={collapsedSet.has("later")}
          onToggle={() => ops.setCollapsed("later", !collapsedSet.has("later"))}
          onReorder={reorder}
        >
          {model.later.map((t) => renderThread(t, 0, "later"))}
        </Section>
      ),
      live: false,
      count: model.later.length,
    });
  }
  if (model.needs.length > 0) {
    sections.push({
      id: "needs",
      el: () => (
        <Section
          key="needs"
          id="needs"
          label="Needs you"
          count={model.needs.length}
          collapsed={collapsedSet.has("needs")}
          onToggle={() => ops.setCollapsed("needs", !collapsedSet.has("needs"))}
          onReorder={reorder}
          actions={<IconButton icon="Check" label="Select all that need you" onClick={() => { setSelecting(true); setSelected(new Set(model.needs.map((t) => t.id))); }} />}
        >
          {(expanded.__needs ? model.needs : model.needs.slice(0, NEEDS_FOLD)).map((t) => renderThread(t, 0, "needs"))}
          <More shown={expanded.__needs ? model.needs.length : Math.min(NEEDS_FOLD, model.needs.length)} total={model.needs.length} open={!!expanded.__needs} onToggle={() => setExpanded((o) => ({ ...o, __needs: !o.__needs }))} />
        </Section>
      ),
      live: false,
      count: model.needs.length,
    });
  }
  if (model.pinned.length > 0) {
    sections.push({
      id: "pinned",
      el: () => (
        <Section
          key="pinned"
          id="pinned"
          label="Pinned"
          count={model.pinned.length}
          collapsed={collapsedSet.has("pinned")}
          onToggle={() => ops.setCollapsed("pinned", !collapsedSet.has("pinned"))}
          onReorder={reorder}
        >
          {model.pinned.map((t) => renderThread(t, 0, "pinned"))}
        </Section>
      ),
      live: false,
      count: model.pinned.length,
    });
  }
  for (const g of model.groups) {
    const sid = `project:${g.id}`;
    sections.push({
      id: sid,
      el: (numeral, nested) => renderGroup(g, sid, numeral, nested),
      live: model.running.some((t) => t.projectId === g.id),
      count: g.total,
    });
  }

  // Rail groups: the member's own folders of projects, kept only in rail state.
  const railGroups = ops.state.groups;
  const groupIds = new Set(railGroups.map((x) => x.id));
  const parentOf = (id: string): string | null => {
    if (!id.startsWith("project:") && !id.startsWith("group:")) return null;
    const gid = ops.state.within[id];
    return gid && groupIds.has(gid) ? `group:${gid}` : null;
  };
  /** The chain of groups above a section, nearest first (stops on a loop, which the server never writes). */
  const ancestors = (id: string): string[] => {
    const out: string[] = [];
    for (let cur = parentOf(id); cur && !out.includes(cur); cur = parentOf(cur)) out.push(cur);
    return out;
  };
  const isWithin = (id: string, ancestor: string) => id === ancestor || ancestors(id).includes(ancestor);
  const entries = new Map<string, Entry>(sections.map((x) => [x.id, x]));
  const childrenOf = (parent: string | null) => [...entries.values()].filter((x) => (parentOf(x.id) ?? null) === parent).sort((a, b) => rank(a.id) - rank(b.id));
  const liveOf = (id: string): boolean => {
    const e = entries.get(id);
    return id.startsWith("group:") ? childrenOf(id).some((c) => liveOf(c.id)) : !!e?.live;
  };
  const countOf = (id: string): number => (id.startsWith("group:") ? childrenOf(id).reduce((n, c) => n + countOf(c.id), 0) : entries.get(id)?.count ?? 0);

  // the member's saved order first; anything new keeps its natural place after.
  const saved = ops.state.order;
  const natural = [...sections.map((x) => x.id), ...railGroups.map((x) => `group:${x.id}`)];
  // A group not yet in the saved order sits where its first project sits.
  const ranks = new Map<string, number>();
  const rank = (id: string): number => {
    const known = ranks.get(id);
    if (known !== undefined) return known;
    ranks.set(id, Number.MAX_SAFE_INTEGER); // guards a loop the server never writes
    const i = saved.indexOf(id);
    let r = i >= 0 ? i : saved.length + natural.indexOf(id);
    if (i < 0 && id.startsWith("group:")) {
      const inside = [...entries.keys()].filter((x) => parentOf(x) === id).map(rank);
      if (inside.length > 0) r = Math.min(...inside) - 0.5;
    }
    ranks.set(id, r);
    return r;
  };
  const flatIds = (parent: string | null = null): string[] => childrenOf(parent).flatMap((x) => [x.id, ...flatIds(x.id)]);
  /** The new order, keeping saved ids that are not on screen right now (filtered or empty projects). */
  const withHidden = (ids: string[]) => [...ids, ...saved.filter((x) => !ids.includes(x))].slice(0, 200);

  function reorder(dragged: string, before: string) {
    const nestable = /^(project|group):/.test(dragged);
    let target = before;
    // Needs you, Pinned and Come back later always stay at the top level.
    if (!nestable) for (let up = parentOf(target); up; up = parentOf(target)) target = up;
    const into = nestable ? parentOf(target) : null;
    if (into && isWithin(into, dragged)) return void toast.error("A group cannot go inside itself.");
    const ids = flatIds().filter((x) => x !== dragged);
    const at = ids.indexOf(target);
    ids.splice(at < 0 ? ids.length : at, 0, dragged);
    if (nestable && parentOf(dragged) !== into) void ops.placeInGroup([dragged], into ? into.slice(6) : null, withHidden(ids));
    else void ops.setOrder(withHidden(ids));
  }
  function nest(dragged: string, groupSid: string) {
    if (!/^(project|group):/.test(dragged)) return void toast.error("Only projects and groups go inside a group.");
    if (isWithin(groupSid, dragged)) return void toast.error("A group cannot go inside itself.");
    // Lands at the end of the group.
    const ids = flatIds().filter((x) => x !== dragged);
    let at = ids.indexOf(groupSid);
    while (at >= 0 && at + 1 < ids.length && isWithin(ids[at + 1], groupSid)) at++;
    ids.splice(at + 1, 0, dragged);
    void ops.placeInGroup([dragged], groupSid.slice(6), withHidden(ids));
    if (collapsedSet.has(groupSid)) ops.setCollapsed(groupSid, false);
  }
  function toTop(sid: string) {
    const first = childrenOf(parentOf(sid))[0]?.id;
    if (first && first !== sid) reorder(sid, first);
  }
  /** Every rail group as a flat, indented list, for the "Move to group" menus. */
  const groupOptions = (): Array<{ sid: string; name: string; depth: number }> => {
    const out: Array<{ sid: string; name: string; depth: number }> = [];
    const walk = (parent: string | null, depth: number) => {
      for (const g of railGroups.filter((x) => parentOf(`group:${x.id}`) === parent).sort((a, b) => rank(`group:${a.id}`) - rank(`group:${b.id}`))) {
        out.push({ sid: `group:${g.id}`, name: g.name, depth });
        walk(`group:${g.id}`, depth + 1);
      }
    };
    walk(null, 0);
    return out;
  };
  /** Take a section out of its group: one level up, or straight to the top level. Lands just above the group it left. */
  function moveOut(sid: string, toTopLevel: boolean) {
    const chain = ancestors(sid);
    if (chain.length === 0) return;
    reorder(sid, toTopLevel ? chain[chain.length - 1] : chain[0]);
  }
  /** "Move out of group" (and "Out to the top level" when nested deeper), then the Move to group submenu. */
  function groupMenu(sid: string) {
    const here = parentOf(sid);
    const depth = ancestors(sid).length;
    const options = groupOptions().filter((o) => !isWithin(o.sid, sid));
    return (
      <>
        {here ? <MenuItem lead={<OutGlyph />} label="Move out of group" hint={depth > 1 ? "one level up" : undefined} onSelect={() => moveOut(sid, false)} /> : null}
        {depth > 1 ? <MenuItem icon="ChevronsUp" label="Out to the top level" onSelect={() => moveOut(sid, true)} /> : null}
      <MenuSub lead={<GroupGlyph />} label="Move to group">
        {options.map((o) => (
          <MenuItem key={o.sid} lead={<GroupGlyph />} label={`${"  ".repeat(o.depth)}${o.name}`} checked={o.sid === here} onSelect={() => (o.sid === here ? undefined : nest(sid, o.sid))} />
        ))}
        {options.length > 0 ? <MenuSeparator /> : null}
        <MenuItem icon="Plus" label="New group…" onSelect={() => setDraft({ kind: "group-new", parentId: here ? here.slice(6) : null, members: [sid] })} />
      </MenuSub>
      </>
    );
  }
  const groupDraft = (parentId: string | null, depth: number) =>
    draft?.kind === "group-new" && draft.parentId === parentId ? (
      <InlineInput
        key="__group-draft"
        initial=""
        placeholder="Group name"
        depth={depth}
        onCancel={() => setDraft(null)}
        onSubmit={(name) => {
          const members = draft.members;
          setDraft(null);
          void ops.createGroup(name.slice(0, 48), parentId, members).then((g) => {
            if (g) toast.success(members.length > 0 ? `Moved into ${g.name}` : `Created ${g.name}`);
          });
        }}
      />
    ) : null;

  for (const g of railGroups) {
    const sid = `group:${g.id}`;
    sections.push({
      id: sid,
      live: false,
      count: 0,
      el: (numeral, nested) => {
        const isCollapsed = collapsedSet.has(sid);
        const kids = level(sid, numeral ?? null);
        const hint = kids.length === 0 && !(draft?.kind === "group-new" && draft.parentId === g.id);
        if (draft?.kind === "group-rename" && draft.id === g.id) {
          return (
            <section key={sid} className={nested ? "mb-1 pt-1" : "mb-4 border-t border-border pt-3"}>
              <InlineInput
                initial={g.name}
                placeholder="Group name"
                depth={0}
                onCancel={() => setDraft(null)}
                onSubmit={(name) => { setDraft(null); void ops.renameGroup(g.id, name.slice(0, 48)); }}
              />
            </section>
          );
        }
        return (
          <Section
            key={sid}
            id={sid}
            label={g.name}
            numeral={numeral}
            nested={nested}
            mark={<GroupGlyph />}
            count={countOf(sid)}
            collapsed={isCollapsed}
            onToggle={() => ops.setCollapsed(sid, !isCollapsed)}
            onReorder={reorder}
            onNest={(dragged) => nest(dragged, sid)}
            menu={
              <>
                <MenuLabel>{g.name}</MenuLabel>
                <MenuItem lead={<GroupGlyph />} label="New group inside" onSelect={() => { if (isCollapsed) ops.setCollapsed(sid, false); setDraft({ kind: "group-new", parentId: g.id, members: [] }); }} />
                <MenuItem icon="Edit" label="Rename" onSelect={() => setDraft({ kind: "group-rename", id: g.id })} />
                <MenuSeparator />
                <MenuItem icon="ChevronsUp" label="Move to top of list" onSelect={() => toTop(sid)} />
                {groupMenu(sid)}
                <MenuItem icon={isCollapsed ? "ChevronsDown" : "ChevronsUp"} label={isCollapsed ? "Unfold group" : "Fold group"} onSelect={() => ops.setCollapsed(sid, !isCollapsed)} />
                <MenuSeparator />
                <MenuItem icon="Trash2" label="Delete group" hint="keeps its projects" danger onSelect={() => void ops.deleteGroup(g.id)} />
              </>
            }
          >
            {draggingSection && draggingSection !== sid && isWithin(draggingSection, sid) ? (
              <OutStrip onDrop={(dragged) => reorder(dragged, sid)} />
            ) : null}
            {twigs(
              [
                ...(draft?.kind === "group-new" && draft.parentId === g.id ? [{ key: "__group-draft", mid: 17, el: <div style={{ paddingLeft: 16 }}>{groupDraft(g.id, 0)}</div> }] : []),
                ...kids.map((k) => ({ key: k.id, mid: 16, el: <div style={{ paddingLeft: 16 }}>{k.node}</div> })),
              ],
              // Group headings: chevron centre at 10 inside the section.
              { x: 10, tick: 9, lift: 14, hot: liveOf(sid) },
            )}
            {hint ? (
              <p className="mb-1 ml-[20px] mr-1 flex min-h-8 py-1 items-center rounded-md border border-dashed border-border px-2.5 text-[12px] text-muted-foreground">
                Drag a project heading here, or right-click one and choose Move to group. Right-click anything inside to move it out.
              </p>
            ) : null}
          </Section>
        );
      },
    });
    entries.set(sid, sections[sections.length - 1]);
  }

  /** One level of the rail: top level numbered i, ii, iii; inside a group i.1, i.2, then i.1.1. */
  function level(parent: string | null, prefix: string | null): Array<{ id: string; node: ReactNode }> {
    let k = 0;
    return childrenOf(parent).map((x) => {
      const numbered = x.id.startsWith("project:") || x.id.startsWith("group:");
      const n = numbered ? (prefix ? `${prefix}.${++k}` : roman(++k)) : undefined;
      return { id: x.id, node: x.el(n, parent !== null) };
    });
  }

  const body = level(null, null).map((x) => x.node);
  orderRef.current = renderOrder;

  const selectedThreads = threads.filter((t) => selected.has(t.id));

  // Right-click anywhere on the rail that has no menu of its own: New group.
  return (
    <Menu
      trigger={
        <div className="min-h-full px-2 pb-6 pt-2">
          <NowCard running={model.running} needs={model.allNeeds} onNavigate={onNavigate} />
          <HarnessFilter counts={model.counts} value={harness} onChange={setHarness} />
          <div className="mx-1 mb-3 flex min-w-0 items-center gap-1.5">
            <TagFilter ops={ops} counts={model.tagCounts} value={activeTags} onChange={setTagFilter} setEdit={setTagEdit} />
            <button
              type="button"
              aria-pressed={selecting}
              title="Select several chats (or ⌘-click, ⇧-click)"
              onClick={() => (selecting ? clearSelection() : setSelecting(true))}
              className={cn(
                "ml-auto inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full px-2 text-[12px] transition-colors",
                selecting ? "bg-accent text-foreground" : "text-muted-foreground hover:text-foreground",
              )}
            >
              <Icon name="ListTodo" className="size-3.5" />
              {selecting ? "Done" : "Select"}
            </button>
          </div>
          <TagChips ops={ops} value={activeTags} onChange={setTagFilter} setEdit={setTagEdit} />
          <TagEditor
            ops={ops}
            edit={tagEdit}
            setEdit={setTagEdit}
            onCreated={(tag) => {
              if (tagTargets.current.length > 0) void ops.applyTag(tagTargets.current, tag.id, true);
              tagTargets.current = [];
            }}
          />

          {groupDraft(null, 0)}
          {body}
          {model.groups.length > 0 ? (
            <button
              type="button"
              onClick={() => setDraft({ kind: "group-new", parentId: null, members: [] })}
              className="mx-1 mt-1 inline-flex items-center gap-1.5 text-[12px] text-muted-foreground hover:text-foreground"
              title="A group holds whole projects. It lives only in this rail; nothing changes on disk."
            >
              <GroupGlyph />
              New group
            </button>
          ) : null}

          {model.groups.length === 0 && model.later.length + model.needs.length + model.pinned.length === 0 ? (
            <p className="mx-1 border-t border-border pt-3 text-[12px] text-muted-foreground">Nothing matches this filter.</p>
          ) : null}
          {!folders.available ? (
            <p className="mx-1 mt-2 text-[11px] text-muted-foreground">
              Install project-folders to use folders.{" "}
              <button type="button" className="underline underline-offset-2 hover:text-foreground" onClick={copyFoldersInstall}>Copy the install command</button>
            </p>
          ) : null}
          {selected.size > 0 ? (
            <BulkBar
              ids={[...selected]}
              pinnedAll={selectedThreads.length > 0 && selectedThreads.every((t) => t.isPinned)}
              ops={ops}
              onClear={clearSelection}
              onNewTag={() => newTagFor([...selected])}
            />
          ) : null}
        </div>
      }
    >
      <MenuItem lead={<GroupGlyph />} label="New group" hint="holds projects" onSelect={() => setDraft({ kind: "group-new", parentId: null, members: [] })} />
      {navMode === "hidden" ? (
        <>
          <MenuSeparator />
          <MenuItem icon="Eye" label="Show navigation" hint={NAV_SHORTCUT} onSelect={() => setNavMode("open")} />
        </>
      ) : null}
    </Menu>
  );
}

function More({ shown, total, open, onToggle }: { shown: number; total: number; open: boolean; onToggle: () => void }) {
  if (total <= shown && !open) return null;
  return (
    <button
      type="button"
      onClick={onToggle}
      className="ml-[30px] mt-1 text-[12px] text-muted-foreground underline decoration-border underline-offset-[3px] hover:text-foreground"
    >
      {open ? "Show fewer" : `Show ${total - shown} more`}
    </button>
  );
}

function DrivePicker({ list, taken, onPick, onClose }: { list: Directory[] | "loading" | undefined; taken: ReadonlySet<string>; onPick: (d: Directory) => void; onClose: () => void }) {
  const [query, setQuery] = useState("");
  const ready = Array.isArray(list);
  const free = ready ? list.filter((d) => !d.name.startsWith(".") && !d.name.startsWith("#") && !taken.has(d.relative.replace(/\/+$/, ""))) : [];
  const shown = free.filter((d) => d.name.toLowerCase().includes(query.trim().toLowerCase()));
  return (
    <div className="mx-1 mb-2 overflow-hidden rounded-lg border border-border bg-card shadow-sm">
      <div className="flex items-center gap-2 border-b border-border px-2.5">
        <Icon name="Search" className="size-3.5 text-muted-foreground" />
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Escape") onClose(); }}
          placeholder="Add folders from the drive"
          className="h-8 flex-1 bg-transparent text-[12.5px] text-foreground outline-none placeholder:text-muted-foreground"
        />
        <IconButton icon="X" label="Close" onClick={onClose} />
      </div>
      <div className="max-h-[260px] overflow-y-auto py-1">
        {!ready ? <p className="px-3 py-2 text-[12px] text-muted-foreground">Reading the drive…</p> : null}
        {ready && shown.length === 0 ? <p className="px-3 py-2 text-[12px] text-muted-foreground">Nothing left to add here.</p> : null}
        {shown.map((d) => (
          <button
            key={d.relative}
            type="button"
            onClick={() => onPick(d)}
            className="group flex h-8 w-full items-center gap-2 px-3 text-left text-[12.5px] text-foreground hover:bg-accent"
          >
            <Icon name="Folder" className="size-3.5 shrink-0 opacity-60" />
            <span className="min-w-0 flex-1 truncate">{d.name}</span>
            <Icon name="Plus" className="size-3.5 shrink-0 opacity-0 transition-opacity group-hover:opacity-70" />
          </button>
        ))}
      </div>
    </div>
  );
}

function DirectoryItems({ list, taken, onPick }: { list: Directory[] | "loading" | undefined; taken: ReadonlySet<string>; onPick: (d: Directory) => void }) {
  if (list === undefined || list === "loading") return <MenuItem label="Reading the drive…" disabled onSelect={() => undefined} />;
  const free = list.filter((d) => !d.name.startsWith(".") && !taken.has(d.relative.replace(/\/+$/, "")));
  if (free.length === 0) return <MenuItem label="No other folders here" disabled onSelect={() => undefined} />;
  return (
    <>
      {free.slice(0, 60).map((d) => (
        <MenuItem key={d.relative} icon="Folder" label={d.name} onSelect={() => onPick(d)} />
      ))}
    </>
  );
}

function FolderRow({ folder, depth, open, count, live, todos, onToggle, onDrop, onPlace, onNewChat, onNewFolder, menu }: {
  folder: Folder;
  depth: number;
  open: boolean;
  count: number;
  live: boolean;
  todos: number;
  onToggle: () => void;
  /** A chat or folder dropped inside this folder. */
  onDrop: (e: DragEvent<HTMLElement>) => void;
  /** Keep my order: a folder dropped on the top or bottom edge goes above (or below) this one. Null with the setting off. */
  onPlace: ((draggedId: string, after: boolean) => void) | null;
  onNewChat: (() => void) | null;
  onNewFolder: () => void;
  menu: ReactNode;
}) {
  const [over, setOver] = useState<"before" | "into" | "after" | null>(null);
  // A dragged chat always goes inside. With Keep my order, a dragged folder
  // goes above (top third), below (bottom third) or inside (middle).
  const zone = (e: DragEvent<HTMLElement>) => {
    if (!onPlace || !draggingFolder) return "into" as const;
    const r = e.currentTarget.getBoundingClientRect();
    const y = (e.clientY - r.top) / r.height;
    return y < 1 / 3 ? ("before" as const) : y > 2 / 3 ? ("after" as const) : ("into" as const);
  };
  const row = (
    <div
      role="button"
      tabIndex={0}
      aria-expanded={open}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData(DRAG_FOLDER, JSON.stringify({ id: folder.id, projectId: folder.projectId }));
        e.dataTransfer.effectAllowed = "move";
        draggingFolder = { id: folder.id, projectId: folder.projectId };
      }}
      onDragEnd={() => {
        draggingFolder = null;
      }}
      onDragOver={(e) => {
        // Folders only reorder within their own project, and never onto themselves.
        if (onPlace && draggingFolder && (draggingFolder.id === folder.id || draggingFolder.projectId !== folder.projectId)) return;
        e.preventDefault();
        setOver(zone(e));
      }}
      onDragLeave={() => setOver(null)}
      onDrop={(e) => {
        const where = over ?? zone(e);
        setOver(null);
        const dragged = draggingFolder;
        draggingFolder = null;
        if (onPlace && dragged && where !== "into") {
          e.preventDefault();
          e.stopPropagation();
          onPlace(dragged.id, where === "after");
          return;
        }
        onDrop(e);
      }}
      onClick={onToggle}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onToggle(); } }}
      title={folder.path}
      className={cn(
        "group relative flex h-[32px] cursor-pointer select-none items-center gap-2 rounded-md pr-1 text-[13px] font-medium text-foreground outline-none",
        "hover:bg-[var(--state-hover)] focus-visible:ring-1 focus-visible:ring-ring data-[state=open]:bg-accent",
        over === "into" && "bg-accent ring-1 ring-[var(--attention)]",
      )}
      style={{ paddingLeft: 6 + depth * 16 }}
    >
      {over === "before" || over === "after" ? (
        <span aria-hidden className="pointer-events-none absolute rounded-full" style={{ left: 4, right: 4, height: 2, background: GOLD, zIndex: 1, ...(over === "before" ? { top: -1 } : { bottom: -1 }) }} />
      ) : null}
      <Icon name="ChevronRight" className={cn("size-3.5 shrink-0 text-muted-foreground transition-transform", open && "rotate-90")} />
      <Icon name={open ? "FolderOpen" : "Folder"} className="size-4 shrink-0 opacity-75" />
      <span className="min-w-0 flex-1 truncate">{folder.name}</span>
      {live ? <Lattice cell={2} gap={1} label="Something in here is working" /> : null}
      <TodoBadge n={todos} />
      <span className="flex items-center opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
        <IconButton icon="FolderPlus" label={`New folder inside ${folder.name}`} onClick={onNewFolder} />
        {onNewChat ? <IconButton icon="MessageCirclePlus" label={`New chat in ${folder.name}`} onClick={onNewChat} /> : null}
      </span>
      <span className="w-5 shrink-0 text-right text-[11px] font-normal text-muted-foreground" style={tnum}>{count || ""}</span>
    </div>
  );
  return <Menu trigger={row}>{menu}</Menu>;
}

/* ----------------------------- the model ------------------------------- */

type FolderNode = { folder: Folder; subfolders: Folder[]; threads: PluginSidebarThread[]; total: number; live: boolean };

function buildModel(
  threads: readonly PluginSidebarThread[],
  projects: readonly PluginSidebarProject[],
  data: FolderData | null,
  harness: string | null,
  activeProjectId: string | null,
  rail: { later: Record<string, { reason: string; at: number }>; assign: Record<string, string[]>; threadOrder?: string[] },
  tagFilter: readonly string[],
  keepOrder: boolean,
) {
  // Keep my order: every list of chats follows the member's own order, never activity.
  const sortChats = keepOrder ? byPlace(rail.threadOrder ?? []) : byUrgencyThenRecent;
  const live = threads.filter((t) => !t.isHidden && !t.isArchived);
  const ids = new Set(live.map((t) => t.id));
  const children = new Map<string, PluginSidebarThread[]>();
  const roots: PluginSidebarThread[] = [];
  for (const t of live) {
    if (t.parentThreadId && ids.has(t.parentThreadId)) {
      const list = children.get(t.parentThreadId) ?? [];
      list.push(t);
      children.set(t.parentThreadId, list);
    } else roots.push(t);
  }
  for (const list of children.values()) list.sort(sortChats);

  const counts = new Map<string, [Harness, number]>();
  for (const t of live) {
    const h = harnessOf(t.providerId);
    const entry = counts.get(h.key) ?? [h, 0];
    entry[1] += 1;
    counts.set(h.key, entry);
  }
  const tagCounts = new Map<string, number>();
  for (const t of roots) for (const id of rail.assign[t.id] ?? []) tagCounts.set(id, (tagCounts.get(id) ?? 0) + 1);
  const match = (t: PluginSidebarThread) =>
    (harness === null || harnessOf(t.providerId).key === harness) && (tagFilter.length === 0 || (rail.assign[t.id] ?? []).some((id) => tagFilter.includes(id)));
  const shown = roots.filter(match);
  const isLater = (t: PluginSidebarThread) => rail.later[t.id] !== undefined;
  const running = live.filter((t) => stateOf(t) === "running" && match(t)).sort((a, b) => b.updatedAt - a.updatedAt);
  const later = keepOrder
    ? shown.filter(isLater).sort(sortChats)
    : shown.filter(isLater).sort((a, b) => (rail.later[b.id]?.at ?? 0) - (rail.later[a.id]?.at ?? 0));
  // Keep my order leaves a chat that needs you in its place instead of lifting it into Needs you.
  const lifted = (t: PluginSidebarThread) => !keepOrder && stateOf(t) === "needs";
  const needs = shown.filter((t) => !isLater(t) && lifted(t)).sort((a, b) => b.updatedAt - a.updatedAt);
  const pinned = shown.filter((t) => !isLater(t) && t.isPinned && !lifted(t)).sort(sortChats);
  const rest = shown.filter((t) => !isLater(t) && !t.isPinned && !lifted(t));

  // Folder index
  const folderList = (data?.folders ?? []).filter((f) => (f.kind ?? "folder") === "folder" || f.kind === "group");
  const folderIds = new Set(folderList.map((f) => f.id));
  const byParent = new Map<string, Folder[]>();
  for (const f of folderList) {
    const key = `${f.projectId}:${f.parentId && folderIds.has(f.parentId) ? f.parentId : ""}`;
    const list = byParent.get(key) ?? [];
    list.push(f);
    byParent.set(key, list);
  }
  for (const list of byParent.values()) list.sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0) || a.name.localeCompare(b.name));
  const parentOf = new Map(folderList.map((f) => [f.id, f.parentId && folderIds.has(f.parentId) ? f.parentId : null]));
  const isDescendant = (candidate: string, ancestor: string) => {
    let cur: string | null | undefined = candidate;
    while (cur) {
      if (cur === ancestor) return true;
      cur = parentOf.get(cur);
    }
    return false;
  };

  const threadsByFolder = new Map<string, PluginSidebarThread[]>();
  const looseByProject = new Map<string, PluginSidebarThread[]>();
  for (const t of rest) {
    const fid = data ? folderOfThread(data, folderIds, t.id, t.environment?.id ?? null) : null;
    if (fid) {
      const list = threadsByFolder.get(fid) ?? [];
      list.push(t);
      threadsByFolder.set(fid, list);
    } else {
      const list = looseByProject.get(t.projectId) ?? [];
      list.push(t);
      looseByProject.set(t.projectId, list);
    }
  }

  const folderNodes = new Map<string, FolderNode>();
  const walk = (f: Folder): FolderNode => {
    const subfolders = byParent.get(`${f.projectId}:${f.id}`) ?? [];
    const own = (threadsByFolder.get(f.id) ?? []).sort(sortChats);
    let total = own.length;
    let isLive = own.some((t) => stateOf(t) === "running");
    for (const s of subfolders) {
      const n = walk(s);
      total += n.total;
      isLive = isLive || n.live;
    }
    const node = { folder: f, subfolders, threads: own, total, live: isLive };
    folderNodes.set(f.id, node);
    return node;
  };

  const rootIds = new Set((data?.roots ?? []).map((r) => r.projectId));
  const projectById = new Map(projects.map((p) => [p.id, p]));
  const projectIds = new Set<string>([...looseByProject.keys(), ...folderList.map((f) => f.projectId)]);
  const moveTargets = new Map<string, Array<{ id: string | null; label: string; depth: number; group?: boolean }>>();
  const takenPaths = new Set<string>();

  const groups = [...projectIds].map((id) => {
    const project = projectById.get(id);
    const top = byParent.get(`${id}:`) ?? [];
    let total = 0;
    for (const f of top) total += walk(f).total;
    const loose = (looseByProject.get(id) ?? []).sort(sortChats);
    total += loose.length;
    const options: Array<{ id: string | null; label: string; depth: number; group?: boolean }> = [{ id: null, label: project?.name ?? "Project root", depth: 0 }];
    const allFolderIds: string[] = [];
    const root = (data?.roots ?? []).find((r) => r.projectId === id);
    const collect = (f: Folder, depth: number) => {
      options.push({ id: f.id, label: f.name, depth, group: f.kind === "group" });
      allFolderIds.push(f.id);
      if (root && f.path.startsWith(root.path)) takenPaths.add(f.path.slice(root.path.length).replace(/^\/+/, "").replace(/\/+$/, ""));
      for (const s of byParent.get(`${id}:${f.id}`) ?? []) collect(s, depth + 1);
    };
    for (const f of top) collect(f, 1);
    moveTargets.set(id, rootIds.has(id) ? options : []);
    const latest = Math.max(0, ...loose.map((t) => t.updatedAt), ...top.flatMap((f) => (folderNodes.get(f.id)?.threads ?? []).map((t) => t.updatedAt)));
    return { id, project, folders: top, loose, total, latest, hasRoot: rootIds.has(id), allFolderIds };
  });
  // Projects not dragged into a saved order: by activity, or with Keep my order
  // by name (personal last), so opening a chat or new activity never moves them.
  groups.sort(
    keepOrder
      ? (a, b) =>
          Number(a.project?.isPersonal ?? false) - Number(b.project?.isPersonal ?? false) ||
          (a.project?.name ?? "").localeCompare(b.project?.name ?? "")
      : (a, b) =>
          Number(b.id === activeProjectId) - Number(a.id === activeProjectId) ||
          Number(a.project?.isPersonal ?? false) - Number(b.project?.isPersonal ?? false) ||
          b.latest - a.latest,
  );

  return {
    counts: [...counts.values()].sort((a, b) => b[1] - a[1]),
    running,
    later,
    needs,
    pinned,
    groups,
    tagCounts,
    children,
    folderNodes,
    moveTargets,
    takenPaths,
    isDescendant,
    allNeeds: live.filter((t) => stateOf(t) === "needs").length,
  };
}

/* --------------------------- NOW and filter ---------------------------- */

function NowCard({ running, needs, onNavigate }: { running: PluginSidebarThread[]; needs: number; onNavigate: () => void }) {
  const lead = running[0];
  const v = useVoiceState();
  const nav = useBbNavigate();
  const mood = v.status === "connecting" ? "connecting" : v.status === "on" ? (v.mode === "speaking" ? "speaking" : "listening") : running.length > 0 ? "busy" : "idle";
  return (
    <div className="mx-1 mb-5 mt-1 rounded-lg border border-border bg-card px-3.5 pb-0 pt-3 shadow-sm">
      <div className="flex gap-3">
      <div className="pb-3 pt-0.5">
        <LogoOrb size={58} mood={mood} onClick={() => nav.toPluginPanel("home")} title="NavAIgate Home" />
      </div>
      <div className="min-w-0 flex-1">
      <div className="flex items-center justify-between">
        <span className={cn(caps, "flex min-w-0 items-center gap-2 whitespace-nowrap text-foreground")}>
          {running.length > 0 ? <Lattice cell={3} gap={1.5} /> : <span aria-hidden className="inline-block size-[6px] bg-muted-foreground" />}
          {running.length > 0 ? `Now · ${running.length} cooking` : "Now · quiet"}
        </span>
        {needs > 0 ? <span className="ml-2 shrink-0 whitespace-nowrap text-[11px] font-medium text-destructive" style={tnum}>{needs} need you</span> : null}
      </div>
      {lead ? (
        <a href={lead.href} onClick={onNavigate} className="mt-1.5 block truncate text-[14px] font-semibold text-foreground no-underline hover:underline">
          {lead.displayTitle}
        </a>
      ) : (
        <p className="mt-1.5 text-[14px] font-semibold text-foreground">Nothing running</p>
      )}
      <p className="mt-0.5 truncate pb-3 text-[12px] text-muted-foreground">
        {lead ? (running.length > 1 ? `${harnessOf(lead.providerId).label} · and ${running.length - 1} more` : harnessOf(lead.providerId).label) : "Every harness is parked"}
      </p>
      </div>
      </div>
      <div aria-hidden className="-mx-3.5 h-[2px] overflow-hidden rounded-b-lg bg-border">
        {running.length > 0 ? <div className="h-full w-2/5 animate-pulse" style={{ background: GOLD }} /> : null}
      </div>
    </div>
  );
}

/** All · Claude · Codex · Cursor as one segmented row that never wraps; the active segment is gold. */
function HarnessFilter({ counts, value, onChange }: { counts: Array<[Harness, number]>; value: string | null; onChange: (key: string | null) => void }) {
  const item = (key: string | null, label: string, n: number) => {
    const on = value === key;
    return (
      <button
        key={key ?? "all"}
        type="button"
        aria-pressed={on}
        title={`${label}: ${n}`}
        onClick={() => onChange(key)}
        className={cn(
          "inline-flex h-6 min-w-0 flex-auto items-center justify-center gap-1 rounded-full px-1.5 text-[12px] transition-colors",
          on ? "bg-[var(--attention)] font-medium text-neutral-900" : "text-muted-foreground hover:text-foreground",
        )}
      >
        <span className="min-w-0 truncate">{label}</span>
        <span className={cn("shrink-0", on ? "opacity-70" : "opacity-60")} style={tnum}>{n}</span>
      </button>
    );
  };
  const total = counts.reduce((s, [, n]) => s + n, 0);
  return (
    <div className="mx-1 mb-2 flex h-7 min-w-0 flex-nowrap items-center gap-0.5 rounded-full border border-border p-0.5" role="group" aria-label="Filter by harness">
      {item(null, "All", total)}
      {counts.map(([h, n]) => item(h.key, h.label, n))}
    </div>
  );
}
