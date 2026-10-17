// The rail: bb's sidebar thread list, run-sheet style.
//   NOW card -> harness filter -> Needs you -> Pinned -> one section per
//   project, each a tree of real folders (from project-folders) with chats
//   inside, every row marked with its harness.
// Every row has a right-click menu wired to bb's own thread actions; folders
// have their own. Chats drag onto folders; folders drag onto folders.
// Rail groups (kept only in rail state) hold whole projects and other groups;
// project headings drag onto them. Children of chats, folders and groups hang
// off explorer-style tree guides that turn gold while the branch is running.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { DragEvent, KeyboardEvent, ReactNode } from "react";
import {
  experimental_Icon as Icon,
  experimental_useSidebarThreadActions as useThreadActions,
  experimental_useSidebarThreads as useSidebarThreads,
  experimental_ProviderIcon as ProviderIcon,
  experimental_useProviders as useProviders,
  type PluginSidebarProject,
  type PluginSidebarThread,
  type PluginThreadListProps,
} from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import { useBbNavigate } from "@get-bb/plugin-sdk/app";
import { LogoOrb } from "./orb";
import { useVoiceState } from "./voice";
import { cn } from "@/lib/utils";
import { GOLD, GOLD_INK, Lattice, Node, ago, byUrgencyThenRecent, caps, harnessOf, stateOf, tnum, type Harness } from "./shared";
import { PROJECT_FOLDERS_INSTALL, folderOfThread, goTo, newChatInFolderUrl, slug, useFolders, type Directory, type Folder, type FolderData } from "./folders";
import { Menu, MenuItem, MenuLabel, MenuSeparator, MenuSub } from "./menu";
import { TAG_CSS, useRailState, type LaterReason, type RailOps, type Tag } from "./rail-state";
import { LATER_LABEL, StatusMark } from "./status-mark";
import { TagChips, TagEditor, TagFilter, TagSwatches, type TagEdit } from "./tags";
import { NAV_SHORTCUT, setNavMode, useNavMode } from "./nav-fold";
import { BulkBar } from "./bulk-bar";
import { TodoBadge, useFolderTodoCounts } from "./todo";
import { CloudGlyph, MachineMark, useMachine, useMachineActions, type MachineItem } from "./machine";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { closeChatTab } from "./tabs";
import {
  GLYPH_LABEL,
  PROJECT_COLORS,
  PROJECT_COLOR_LABEL,
  SubAgentGlyph,
  Spinner,
  StateGlyph,
  ensureRailLook,
  execLine,
  glyphOf,
  projectColorOf,
  projectCss,
  useJustOpened,
  useThreadExec,
  type Exec,
} from "./rail-look";

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
/** Rows sit 6px further in than before, clear of the project colour bar. */
const INSET = 6;
const DRAG_FOLDER = "application/x-nav-folder";

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
    <div className="flex h-[34px] items-center pr-2" style={{ paddingLeft: 10 + INSET + depth * 16 }}>
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

/* ------------------------- sub-agents that fold ------------------------- */

const reducedMotion = () => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
const EASE = "cubic-bezier(.23,1,.32,1)";

/**
 * One sub-agent row growing in or folding away: height and opacity together,
 * clipped only while it moves so the tree guides stay whole at rest.
 */
function Reveal({ phase, delay, onGone, children }: { phase: "in" | "out" | "still"; delay: number; onGone: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const gone = useRef(onGone);
  gone.current = onGone;
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || phase === "still") return;
    if (reducedMotion()) {
      if (phase === "out") gone.current();
      return;
    }
    const h = el.scrollHeight;
    el.getAnimations().forEach((a) => a.cancel());
    el.style.overflow = "hidden";
    const frames = phase === "in"
      ? [{ height: "0px", opacity: 0 }, { height: `${h}px`, opacity: 1 }]
      : [{ height: `${h}px`, opacity: 1 }, { height: "0px", opacity: 0 }];
    const anim = el.animate(frames, { duration: phase === "in" ? 150 : 130, delay: phase === "in" ? delay : 0, easing: EASE, fill: phase === "in" ? "backwards" : "forwards" });
    // No cleanup on the next phase: "in" turning "still" must not cut the move
    // short. A new move cancels this one first, and cancel skips onfinish.
    anim.onfinish = () => {
      el.style.overflow = "";
      if (phase === "out") gone.current();
    };
  }, [phase, delay]);
  return <div ref={ref}>{children}</div>;
}

/**
 * The sub-agents under one chat, each in its Twig. `el` is null for a child
 * that is folded away; it keeps drawing (from its last render) while it folds
 * out, and children that appear grow in 20 ms apart.
 */
function Kids({ items, guide }: { items: Array<{ key: string; mid: number; el: ReactNode | null }>; guide: { x: number; tick: number; lift: number; hot: boolean } }) {
  const cache = useRef(new Map<string, ReactNode>());
  const before = useRef<Set<string> | null>(null);
  const [leaving, setLeaving] = useState<ReadonlySet<string>>(() => new Set());
  const shown = new Set(items.filter((i) => i.el).map((i) => i.key));
  for (const i of items) if (i.el) cache.current.set(i.key, i.el);
  const prev = before.current;
  const entering = prev ? items.filter((i) => i.el && !prev.has(i.key)).map((i) => i.key) : [];
  useLayoutEffect(() => {
    const was = before.current;
    before.current = shown;
    if (!was) return;
    const out = [...was].filter((k) => !shown.has(k) && items.some((i) => i.key === k));
    const back = [...leaving].filter((k) => shown.has(k));
    if (out.length > 0 || back.length > 0) {
      setLeaving((l) => new Set([...[...l].filter((k) => !shown.has(k)), ...out]));
    }
  });
  // Shown last time and folded now: it draws on and folds out from this render on.
  const drawn = items.filter((i) => i.el || leaving.has(i.key) || prev?.has(i.key));
  if (drawn.length === 0) return null;
  return (
    <>
      {drawn.map((i, n) => {
        const el = i.el ?? cache.current.get(i.key) ?? null;
        const k = entering.indexOf(i.key);
        return (
          <Reveal
            key={i.key}
            phase={i.el ? (k >= 0 ? "in" : "still") : "out"}
            delay={Math.min(Math.max(k, 0), 12) * 20}
            onGone={() => setLeaving((l) => {
              if (!l.has(i.key)) return l;
              const next = new Set(l);
              next.delete(i.key);
              cache.current.delete(i.key);
              return next;
            })}
          >
            <Twig x={guide.x} tick={guide.tick} mid={i.mid} lift={guide.lift} hot={guide.hot} first={n === 0} last={n === drawn.length - 1}>
              {el}
            </Twig>
          </Reveal>
        );
      })}
    </>
  );
}

/** Folding state of a chat that has sub-agents. */
type Fold = {
  open: boolean;
  /** Something under it is running / needs the member. */
  running: boolean;
  needs: boolean;
  set: (open: boolean) => void;
};

/**
 * The "done/total" chip of a chat with sub-agents, with its chevron. The whole
 * chip opens or folds the sub-agents; folded, it also carries a spinner while
 * one runs and a red dot when one needs the member.
 */
function SubChip({ progress, fold }: { progress: [number, number]; fold: Fold }) {
  const [done, total] = progress;
  const { open, running, needs } = fold;
  const verb = open ? "Hide" : "Show";
  const tip = `${done} of ${total} sub-agents finished${!open && needs ? ", one needs you" : ""}. Click to ${verb.toLowerCase()} them.`;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Badge
          variant="outline"
          role="button"
          aria-expanded={open}
          aria-label={`${verb} sub-agents, ${done} of ${total} finished`}
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); fold.set(!open); }}
          onMouseDown={(e) => e.stopPropagation()}
          className={cn(
            "h-4 shrink-0 cursor-pointer gap-[3px] rounded-[4px] py-0 pl-[2px] pr-1 text-[10px] font-medium leading-none hover:bg-[var(--state-hover)]",
            done < total ? "border-[color-mix(in_srgb,var(--attention)_55%,transparent)] text-[var(--warning-text)]" : "border-border text-muted-foreground",
          )}
          style={tnum}
        >
          <Icon name="ChevronRight" className={cn("size-2.5 shrink-0 transition-transform duration-150 motion-reduce:transition-none", open && "rotate-90")} />
          {done}/{total}
          {!open && running ? <Spinner size={8} label="A sub-agent is working" /> : null}
          {!open && needs ? <span aria-label="A sub-agent needs you" className="size-[5px] shrink-0 rounded-full bg-destructive" /> : null}
        </Badge>
      </TooltipTrigger>
      <TooltipContent side="right">{tip}</TooltipContent>
    </Tooltip>
  );
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
  /** One-line rows (harness and time), as before 0.28. */
  compact: boolean;
  /** Model and effort per chat, from the batched cache (undefined until known). */
  exec: (id: string) => Exec | null | undefined;
  /** CSS colour of a project's dot and bar. */
  colorOf: (projectId: string) => string;
  /** Close a chat the way the tab strip's x does. */
  close: (id: string) => void;
};

/** Copy the project-folders install line, for the greyed-out folder actions. */
function copyFoldersInstall() {
  void navigator.clipboard.writeText(PROJECT_FOLDERS_INSTALL).then(
    () => toast.success("Install command copied. Paste it into a terminal or a bb chat, then reload bb."),
    () => toast.message(PROJECT_FOLDERS_INSTALL),
  );
}

function ThreadRow({ thread, active, depth, now, onNavigate, moveTargets, foldersMissing, onMove, ctx, progress, fold, child = false, mixed = false }: {
  thread: PluginSidebarThread;
  active: boolean;
  depth: number;
  now: number;
  /** Sub-agents finished and in all, when the chat has any. */
  progress?: [number, number] | null;
  /** Open or fold its sub-agents, when it has any. */
  fold?: Fold;
  /** A sub-agent chat, drawn with a small mark before its title. */
  child?: boolean;
  /** In a section that mixes projects (Pinned, Needs you, Come back later): show the project dot. */
  mixed?: boolean;
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
  const state = stateOf(thread);
  const h = harnessOf(thread.providerId);
  const later = (ctx.ops.state.later[thread.id]?.reason ?? null) as LaterReason | null;
  const tagIds = ctx.ops.state.assign[thread.id] ?? [];
  const tags = ctx.ops.state.tags.filter((t) => tagIds.includes(t.id));
  const isSelected = ctx.selected.has(thread.id);
  // Status glyphs animate only when they change, not when the row first draws.
  const born = useRef(Date.now());
  const settle = Date.now() - born.current > 600;
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
  };

  const running = state === "running";
  const glyph = glyphOf(thread);
  const gutter = ctx.selecting ? (
    <span aria-hidden className={cn("inline-flex size-[13px] shrink-0 items-center justify-center rounded-[3px] border", isSelected ? "border-foreground bg-foreground text-background" : "border-input bg-background")}>
      {isSelected ? <Icon name="Check" className="size-2.5" /> : null}
    </span>
  ) : later && !running ? (
    <span key={`later-${later}`} className={cn("inline-flex w-[11px] shrink-0 items-center justify-center", settle && "nav-glyph-in")}><StatusMark reason={later} size={13} /></span>
  ) : ctx.compact ? (
    <Node state={state} />
  ) : (
    <span key={glyph} className={cn("inline-flex w-[11px] shrink-0 items-center justify-center", settle && glyph !== "none" && (glyph === "done" ? "nav-pop" : "nav-glyph-in"))}>
      <StateGlyph kind={glyph} />
    </span>
  );
  const branch = thread.environment?.branchName ?? null;
  const label = `${thread.displayTitle}, ${ctx.compact ? h.label : execLine(thread.providerId, ctx.exec(thread.id))}${glyph !== "none" ? `, ${GLYPH_LABEL[glyph]}` : thread.indicatorLabel ? `, ${thread.indicatorLabel}` : ""}`;
  const closeButton = active ? (
    <span
      role="button"
      tabIndex={-1}
      aria-label="Close this chat"
      title="Close this chat"
      onClick={(e) => { e.preventDefault(); e.stopPropagation(); ctx.close(thread.id); }}
      className="nav-fade absolute inset-y-0 right-0 inline-flex w-5 items-center justify-center rounded text-muted-foreground opacity-0 hover:text-foreground group-hover/row:opacity-100"
    >
      <Icon name="X" className="size-3" />
    </span>
  ) : null;

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
      onKeyDown={(e) => {
        // Right opens a chat's sub-agents, Left folds them.
        if (!fold || e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
        if ((e.key === "ArrowRight" && !fold.open) || (e.key === "ArrowLeft" && fold.open)) {
          e.preventDefault();
          e.stopPropagation();
          fold.set(e.key === "ArrowRight");
        }
      }}
      aria-expanded={fold ? fold.open : undefined}
      data-sidebar-thread-shortcut-target=""
      data-sidebar-thread-id={thread.id}
      aria-current={active ? "page" : undefined}
      aria-label={label}
      title={thread.displayTitle}
      className={cn(
        "group/row relative isolate flex rounded-md pr-2 text-[13.5px] no-underline outline-none",
        "focus-visible:ring-1 focus-visible:ring-ring data-[state=open]:bg-accent",
        ctx.compact ? "h-[34px] items-center gap-2.5" : "h-[46px] items-start gap-2.5 pt-[6px]",
        ctx.compact
          ? active ? "font-semibold text-foreground" : state === "parked" && !later ? "text-muted-foreground" : "text-foreground"
          : active ? "font-medium text-foreground" : "text-foreground",
        isSelected && "ring-1 ring-inset ring-[var(--surface-selected-border)]",
      )}
      style={{ paddingLeft: 10 + INSET + depth * 16 }}
    >
      {/* Hover and selected fills fade in on opacity alone. */}
      <span aria-hidden className="nav-fade pointer-events-none absolute inset-0 -z-10 rounded-md bg-[var(--state-hover)] opacity-0 group-hover/row:opacity-100" />
      <span aria-hidden className={cn("nav-fade pointer-events-none absolute inset-0 -z-10 rounded-md", isSelected ? "bg-[var(--surface-selected)]" : "bg-accent", active || isSelected ? "opacity-100" : "opacity-0")} />
      {active ? <span aria-hidden className={cn("absolute left-0 w-[2px]", ctx.compact ? "inset-y-2" : "inset-y-2.5")} style={{ background: GOLD }} /> : null}
      {ctx.compact ? (
        <>
          {gutter}
          <span className="min-w-0 flex-1 truncate">{thread.displayTitle}</span>
          {onMachine ? <MachineMark item={onMachine} threadId={thread.id} /> : null}
          <TagSwatches tags={tags} />
          {thread.isPinned ? <Icon name="Pin" className="size-3 shrink-0 opacity-50" /> : null}
          {progress && fold ? <SubChip progress={progress} fold={fold} /> : null}
          <span className="shrink-0 text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground/80">{h.label}</span>
          <span className="relative w-6 shrink-0 text-right text-[11px] text-muted-foreground" style={tnum}>
            <span className={cn(active && "nav-fade group-hover/row:opacity-0")}>{ago(thread.updatedAt, now)}</span>
            {closeButton}
          </span>
        </>
      ) : (
        <>
          <span className="flex h-[18px] shrink-0 items-center">{gutter}</span>
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="flex h-[18px] min-w-0 items-center gap-1.5">
              {child ? <SubAgentGlyph /> : null}
              <span className="min-w-0 flex-1 truncate leading-[18px]">{thread.displayTitle}</span>
              {onMachine ? <MachineMark item={onMachine} threadId={thread.id} /> : null}
              <TagSwatches tags={tags} />
              {thread.isPinned ? <Icon name="Pin" className="size-3 shrink-0 opacity-50" /> : null}
              <span className="relative inline-flex h-[18px] w-6 shrink-0 items-center justify-end text-[11px] font-normal text-muted-foreground" style={tnum}>
                {running ? (
                  <Spinner size={12} />
                ) : (
                  <span className={cn(active && "nav-fade group-hover/row:opacity-0")}>{ago(thread.updatedAt, now)}</span>
                )}
                {running ? null : closeButton}
              </span>
            </span>
            <span className="nav-l2 mt-[2px] flex h-4 min-w-0 items-center gap-1.5 text-[11.5px] font-normal leading-4 text-muted-foreground">
              {mixed ? <span aria-hidden className="size-[6px] shrink-0 rounded-full" style={{ background: ctx.colorOf(thread.projectId) }} /> : null}
              <span className="min-w-0 flex-1 truncate">{execLine(thread.providerId, ctx.exec(thread.id))}</span>
              {progress && fold ? <SubChip progress={progress} fold={fold} /> : null}
              {branch ? (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Badge variant="outline" className="h-4 min-w-0 max-w-[96px] shrink rounded-[4px] border-border px-1 py-0 font-mono text-[10px] font-normal leading-none text-muted-foreground">
                      <span className="truncate">{branch}</span>
                    </Badge>
                  </TooltipTrigger>
                  <TooltipContent side="right">{`Branch ${branch}`}</TooltipContent>
                </Tooltip>
              ) : null}
            </span>
          </span>
        </>
      )}
    </a>
  );

  return (
    <Menu trigger={anchor}>
      <MenuItem icon="ArrowUpRight" label="Open" onSelect={() => { actions.open(thread.id); onNavigate(); }} />
      <MenuItem icon="Columns2" label="Open in split" onSelect={() => { actions.open(thread.id, { split: true }); onNavigate(); }} />
      {fold && progress ? (
        <MenuItem icon={fold.open ? "ChevronsUp" : "ChevronsDown"} label={fold.open ? "Hide sub-agents" : "Show sub-agents"} hint={`${progress[1]}`} onSelect={() => fold.set(!fold.open)} />
      ) : null}
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

function Section({ id, label, numeral, count, actions, onDrop, menu, collapsed, onToggle, onReorder, onNest, nested, mark, color, live = 0, onNew, children }: {
  id: string;
  /** A project section: its colour dot, the bar down its chats, and the always-there new chat button. */
  color?: string;
  /** Chats running in this section, for the small live pill. */
  live?: number;
  onNew?: { label: string; run: () => void };
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
  const opening = useJustOpened(!collapsed);
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
        "group/head relative mx-1 mb-1.5 flex h-6 cursor-pointer select-none items-center justify-between rounded-md",
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
      {color ? (
        <span className="flex min-w-0 items-center gap-2 normal-case tracking-normal">
          <span aria-hidden className="size-2 shrink-0 rounded-full" style={{ background: color }} />
          {numeral ? <i className="font-serif text-[12px] text-muted-foreground/70">{numeral}</i> : null}
          {mark}
          <span className="truncate text-[13px] font-semibold text-foreground">{label}</span>
          <Icon
            name="ChevronRight"
            className={cn("size-3 shrink-0 text-muted-foreground transition-[transform,opacity] duration-150", collapsed ? "opacity-100" : "rotate-90 opacity-0 group-hover/head:opacity-100")}
          />
        </span>
      ) : (
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
      )}
      <span className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
        {actions ? (
          color ? (
            // Project headings: the folder buttons take the count's place on hover, so the name keeps its room.
            <span className="hidden items-center gap-0.5 group-hover/head:flex focus-within:flex">{actions}</span>
          ) : (
            <span className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover/head:opacity-100 focus-within:opacity-100">{actions}</span>
          )
        ) : null}
        {color && live > 0 ? (
          <Badge
            variant="outline"
            className="h-[18px] gap-1 rounded-full border-[color-mix(in_srgb,var(--attention)_45%,transparent)] bg-[color-mix(in_srgb,var(--attention)_12%,transparent)] px-1.5 py-0 text-[10.5px] font-medium normal-case tracking-normal text-[var(--warning-text)]"
            title={`${live} running`}
          >
            <Spinner size={9} label="" />
            <span style={tnum}>{live}</span>
          </Badge>
        ) : null}
        <span className={cn("w-5 text-right", color && actions && "group-hover/head:hidden")} style={tnum}>{count}</span>
        {onNew ? <IconButton icon="Plus" label={onNew.label} onClick={onNew.run} /> : null}
      </span>
    </h3>
  );
  return (
    <section className={nested ? "mb-1 pt-1" : "mb-4 border-t border-border pt-3"}>
      {menu ? <Menu trigger={heading}>{menu}</Menu> : heading}
      {collapsed ? null : color ? (
        <div className="relative">
          {/* The project's bar: joins its chats, grows in when the section opens. */}
          <span
            aria-hidden
            className={cn("nav-bar pointer-events-none absolute -top-2.5 bottom-1 left-[7px] w-[2px] rounded-full", opening && "nav-bar-grow")}
            style={{ background: `color-mix(in srgb, ${color} 70%, transparent)` }}
          />
          <div className={opening ? "nav-sec-in" : undefined}>{children}</div>
        </div>
      ) : (
        <div className={opening ? "nav-sec-in" : undefined}>{children}</div>
      )}
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
  // Two-line rows by default; "Compact rows" brings back the one-line rows.
  const [compact, setCompactNow] = usePersisted<boolean>("nav-skin:compact-rows", false);
  const [rowsMotion, setRowsMotion] = useState<"" | "out" | "in">("");
  const setCompact = useCallback((on: boolean) => {
    // The second line fades out before the rows close up, and fades in after they open.
    if (on) {
      setRowsMotion("out");
      window.setTimeout(() => { setCompactNow(true); setRowsMotion(""); }, 140);
    } else {
      setCompactNow(false);
      setRowsMotion("in");
      window.setTimeout(() => setRowsMotion(""), 320);
    }
  }, [setCompactNow]);
  const exec = useThreadExec(threads, !compact);
  ensureRailLook();
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
  const model = useMemo(
    () => buildModel(threads, projects, folders.available ? folders.data : null, harness, activeProjectId, ops.state, activeTags),
    [threads, projects, folders.available, folders.data, harness, activeProjectId, ops.state, activeTags],
  );

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
  const colorOf = (projectId: string) => projectCss(projectColorOf(projectId, ops.state.colors));
  const close = (id: string) => {
    closeChatTab(id, { threadId: activeThreadId, projectId: activeProjectId }, {
      open: (x) => actions.open(x),
      openNewThread: (o) => actions.openNewThread(o),
    });
    onNavigate();
  };
  const rowCtx: RowCtx = { ops, machine: machine.items, hasMachine: machine.configured, selecting, selected, onSelectGesture, onNewTag: newTagFor, compact, exec, colorOf, close };
  // Row geometry for the tree guides: the gutter mark sits at the centre of line 1.
  const rowMid = compact ? 17 : 15;
  const kidLift = compact ? 10 : 23;
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

  // Sub-agent chats hang under their parent at every depth, joined by a guide
  // from the parent's node (thread rows: node centre at 15.5 + depth * 16).
  // They start folded; while folded, the ones running or needing the member (or
  // holding the open chat) still peek out, and fold away again once they settle.
  const subOpen = new Set(ops.state.subOpen);
  const below = (t: PluginSidebarThread, test: (c: PluginSidebarThread) => boolean): boolean =>
    (model.children.get(t.id) ?? []).some((c) => test(c) || below(c, test));
  const isRunning = (c: PluginSidebarThread) => stateOf(c) === "running";
  const isNeeds = (c: PluginSidebarThread) => stateOf(c) === "needs";
  const hasRunning = (t: PluginSidebarThread): boolean => below(t, isRunning);
  const peeks = (c: PluginSidebarThread): boolean =>
    isRunning(c) || isNeeds(c) || c.id === activeThreadId || below(c, (x) => isRunning(x) || isNeeds(x) || x.id === activeThreadId);
  const renderThread = (t: PluginSidebarThread, depth: number, child = false, mixed = false): ReactNode => {
    renderOrder.push(t.id);
    const kids = model.children.get(t.id) ?? [];
    const progress: [number, number] | null = kids.length > 0 ? [kids.filter((c) => stateOf(c) !== "running").length, kids.length] : null;
    const open = subOpen.has(t.id);
    const fold: Fold | undefined = kids.length > 0
      ? { open, running: hasRunning(t), needs: below(t, isNeeds), set: (o) => { if (o !== open) ops.setSubOpen([t.id], o); } }
      : undefined;
    return (
      <div key={t.id}>
        <ThreadRow
          ctx={rowCtx}
          thread={t}
          progress={progress}
          fold={fold}
          child={child}
          mixed={mixed}
          active={t.id === activeThreadId}
          depth={depth}
          now={now}
          onNavigate={onNavigate}
          moveTargets={child ? null : (model.moveTargets.get(t.projectId) ?? []).filter((o) => !o.group)}
          foldersMissing={!folders.available}
          onMove={(folderId) => folders.placeThread(t.id, t.projectId, folderId).catch(report("Move"))}
        />
        {kids.length > 0 ? (
          <Kids
            items={kids.map((c) => ({ key: c.id, mid: rowMid, el: open || peeks(c) ? renderThread(c, depth + 1, true) : null }))}
            guide={{ x: 15 + INSET + depth * 16, tick: 9, lift: kidLift, hot: fold?.running ?? false }}
          />
        ) : null}
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
                ...node.threads.map((t) => ({ key: t.id, mid: rowMid, el: renderThread(t, depth + 1) })),
              ],
              // Folder rows: chevron centre at 13 + INSET + depth * 16.
              { x: 13 + INSET + depth * 16, tick: 10, lift: 8, hot: node.live },
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
    const picked = ops.state.colors[g.id];
    const color = projectColorOf(g.id, ops.state.colors);
    const newChat = () => { actions.openNewThread({ projectId: g.id, focusPrompt: true }); onNavigate(); };
    return (
      <Section
        key={sid}
        id={sid}
        label={label}
        numeral={numeral}
        nested={nested}
        color={projectCss(color)}
        live={model.running.filter((t) => t.projectId === g.id).length}
        onNew={{ label: `New chat in ${label}`, run: newChat }}
        count={g.total}
        collapsed={isCollapsed}
        onToggle={() => ops.setCollapsed(sid, !isCollapsed)}
        onReorder={reorder}
        onDrop={canFolder ? onDropInto(g.id, null) : undefined}
        actions={
          <>
            {canFolder ? <IconButton icon="FolderPlus" label={`New folder in ${label}`} onClick={() => { if (isCollapsed) ops.setCollapsed(sid, false); setDraft({ kind: "new", projectId: g.id, parentId: null }); }} /> : null}
            {canFolder ? <IconButton icon="FolderOpen" label={`Add folders from the drive to ${label}`} onClick={() => { if (isCollapsed) ops.setCollapsed(sid, false); loadDirs(g.id, null); setPicker((p) => (p === g.id ? null : g.id)); }} /> : null}
          </>
        }
        menu={
          <>
            <MenuLabel>{label}</MenuLabel>
            <MenuItem icon="MessageCirclePlus" label="New chat" onSelect={newChat} />
            {canFolder ? <MenuItem icon="FolderPlus" label="New folder" onSelect={() => setDraft({ kind: "new", projectId: g.id, parentId: null })} /> : null}
            {canFolder ? (
              <MenuSub icon="Search" label="Add existing folder" onOpen={() => loadDirs(g.id, null)}>
                <DirectoryItems list={rootDirs} taken={model.takenPaths} onPick={(d) => folders.createFolder(g.id, null, d.name, d.relative).catch(report("Add folder"))} />
              </MenuSub>
            ) : null}
            <MenuSeparator />
            <MenuItem icon="ChevronsUp" label="Move to top of list" onSelect={() => toTop(sid)} />
            {groupMenu(sid)}
            <MenuSub lead={<span aria-hidden className="size-2.5 rounded-full" style={{ background: projectCss(color) }} />} label="Colour">
              {PROJECT_COLORS.map((c) => (
                <MenuItem key={c} lead={<span aria-hidden className="size-2.5 rounded-full" style={{ background: projectCss(c) }} />} label={PROJECT_COLOR_LABEL[c]} checked={picked === c} onSelect={() => ops.setProjectColor(g.id, c)} />
              ))}
              <MenuSeparator />
              <MenuItem label="Automatic" hint={PROJECT_COLOR_LABEL[projectColorOf(g.id, undefined)]} checked={!picked} onSelect={() => ops.setProjectColor(g.id, null)} />
            </MenuSub>
            <MenuItem icon={isCollapsed ? "ChevronsDown" : "ChevronsUp"} label={isCollapsed ? "Unfold section" : "Fold section"} onSelect={() => ops.setCollapsed(sid, !isCollapsed)} />
            <MenuItem label="Compact rows" checked={compact} onSelect={() => setCompact(!compact)} />
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
        {loose.map((t) => renderThread(t, 0))}
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
          {model.later.map((t) => renderThread(t, 0, false, true))}
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
          {(expanded.__needs ? model.needs : model.needs.slice(0, NEEDS_FOLD)).map((t) => renderThread(t, 0, false, true))}
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
          {model.pinned.map((t) => renderThread(t, 0, false, true))}
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
  const activeProject = projects.find((p) => p.id === activeProjectId) ?? null;
  return (
    <TooltipProvider delayDuration={450} skipDelayDuration={150}>
    <Menu
      trigger={
        <div className={cn("min-h-full px-2 pb-6 pt-2", rowsMotion === "out" && "nav-rows-out", rowsMotion === "in" && "nav-rows-in")}>
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

          <button
            type="button"
            onClick={() => { actions.openNewThread({ projectId: activeProjectId ?? undefined, focusPrompt: true }); onNavigate(); }}
            title={activeProject ? `New chat in ${activeProject.isPersonal ? "Personal" : activeProject.name}` : "New chat"}
            className="group/new relative isolate mb-3 flex h-8 w-full items-center gap-2.5 rounded-md pr-2 text-left text-[13px] text-muted-foreground outline-none hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring"
            style={{ paddingLeft: 10 + INSET - 1 }}
          >
            <span aria-hidden className="nav-fade pointer-events-none absolute inset-0 -z-10 rounded-md bg-[var(--state-hover)] opacity-0 group-hover/new:opacity-100" />
            <Icon name="Plus" className="size-[13px] shrink-0" />
            <span className="min-w-0 flex-1 truncate">New chat</span>
            {activeProject ? (
              <span className="flex min-w-0 shrink items-center gap-1.5 text-[11px]">
                <span aria-hidden className="size-[6px] shrink-0 rounded-full" style={{ background: colorOf(activeProject.id) }} />
                <span className="truncate">{activeProject.isPersonal ? "Personal" : activeProject.name}</span>
              </span>
            ) : null}
          </button>

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
      <MenuSeparator />
      <MenuItem label="Compact rows" hint={compact ? undefined : "one line each"} checked={compact} onSelect={() => setCompact(!compact)} />
      <MenuSeparator />
      <MenuItem icon="ChevronsDown" label="Expand all" hint="sub-agents" onSelect={() => ops.setSubOpen([...model.children.keys()], true)} />
      <MenuItem icon="ChevronsUp" label="Collapse all" hint="sub-agents" onSelect={() => ops.setSubOpen([...ops.state.subOpen], false)} />
      {navMode === "hidden" ? (
        <>
          <MenuSeparator />
          <MenuItem icon="Eye" label="Show navigation" hint={NAV_SHORTCUT} onSelect={() => setNavMode("open")} />
        </>
      ) : null}
    </Menu>
    </TooltipProvider>
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
            className="group/pick flex h-8 w-full items-center gap-2 px-3 text-left text-[12.5px] text-foreground hover:bg-accent"
          >
            <Icon name="Folder" className="size-3.5 shrink-0 opacity-60" />
            <span className="min-w-0 flex-1 truncate">{d.name}</span>
            <Icon name="Plus" className="size-3.5 shrink-0 opacity-0 transition-opacity group-hover/pick:opacity-70" />
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

function FolderRow({ folder, depth, open, count, live, todos, onToggle, onDrop, onNewChat, onNewFolder, menu }: {
  folder: Folder;
  depth: number;
  open: boolean;
  count: number;
  live: boolean;
  todos: number;
  onToggle: () => void;
  onDrop: (e: DragEvent<HTMLElement>) => void;
  onNewChat: (() => void) | null;
  onNewFolder: () => void;
  menu: ReactNode;
}) {
  const [over, setOver] = useState(false);
  const row = (
    <div
      role="button"
      tabIndex={0}
      aria-expanded={open}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData(DRAG_FOLDER, JSON.stringify({ id: folder.id, projectId: folder.projectId }));
        e.dataTransfer.effectAllowed = "move";
      }}
      onDragOver={(e) => { e.preventDefault(); setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => { setOver(false); onDrop(e); }}
      onClick={onToggle}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onToggle(); } }}
      title={folder.path}
      className={cn(
        "group/folder relative flex h-[32px] cursor-pointer select-none items-center gap-2 rounded-md pr-1 text-[13px] font-medium text-foreground outline-none",
        "hover:bg-[var(--state-hover)] focus-visible:ring-1 focus-visible:ring-ring data-[state=open]:bg-accent",
        over && "bg-accent ring-1 ring-[var(--attention)]",
      )}
      style={{ paddingLeft: 6 + INSET + depth * 16 }}
    >
      <Icon name="ChevronRight" className={cn("size-3.5 shrink-0 text-muted-foreground transition-transform", open && "rotate-90")} />
      <Icon name={open ? "FolderOpen" : "Folder"} className="size-4 shrink-0 opacity-75" />
      <span className="min-w-0 flex-1 truncate">{folder.name}</span>
      {live ? <Lattice cell={2} gap={1} label="Something in here is working" /> : null}
      <TodoBadge n={todos} />
      <span className="flex items-center opacity-0 transition-opacity group-hover/folder:opacity-100 group-focus-visible/folder:opacity-100">
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
  rail: { later: Record<string, { reason: string; at: number }>; assign: Record<string, string[]> },
  tagFilter: readonly string[],
) {
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
  for (const list of children.values()) list.sort(byUrgencyThenRecent);

  const counts = new Map<string, [Harness, number, string]>();
  for (const t of live) {
    const h = harnessOf(t.providerId);
    const entry = counts.get(h.key) ?? [h, 0, t.providerId];
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
  const later = shown.filter(isLater).sort((a, b) => (rail.later[b.id]?.at ?? 0) - (rail.later[a.id]?.at ?? 0));
  const needs = shown.filter((t) => !isLater(t) && stateOf(t) === "needs").sort((a, b) => b.updatedAt - a.updatedAt);
  const pinned = shown.filter((t) => !isLater(t) && t.isPinned && stateOf(t) !== "needs").sort(byUrgencyThenRecent);
  const rest = shown.filter((t) => !isLater(t) && !t.isPinned && stateOf(t) !== "needs");

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
    const own = (threadsByFolder.get(f.id) ?? []).sort(byUrgencyThenRecent);
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
    const loose = (looseByProject.get(id) ?? []).sort(byUrgencyThenRecent);
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
  groups.sort(
    (a, b) =>
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

/** bb's own logo for a harness (an id-only record falls back to bb's generic glyph). */
function HarnessIcon({ providerId }: { providerId: string }) {
  const { providers } = useProviders();
  const rec = providers.find((p) => p.id === providerId) as { id: string; logoUrl?: string | null } | undefined;
  return <ProviderIcon providerKind="agent" provider={rec ?? { id: providerId }} className="size-3.5 shrink-0" />;
}

/**
 * All · Claude · Codex · Cursor as one segmented row that never wraps; the active
 * segment is gold. At the rail's usual width each harness is its logo and count
 * (the name in a tooltip and the accessible label); the names come back once the
 * row is wide enough to show every one in full. Words are never cut short.
 */
function HarnessFilter({ counts, value, onChange }: { counts: Array<[Harness, number, string]>; value: string | null; onChange: (key: string | null) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.round(e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  // Room for "Claude 79" and the like in every segment, with a margin.
  const words = width > 0 && width >= 44 + counts.reduce((n, [h, c]) => n + 34 + h.label.length * 7 + String(c).length * 7, 0);
  const item = (key: string | null, label: string, n: number, providerId: string | null) => {
    const on = value === key;
    const button = (
      <button
        key={key ?? "all"}
        type="button"
        aria-pressed={on}
        aria-label={`${label}: ${n} chats`}
        onClick={() => onChange(key)}
        className={cn(
          "inline-flex h-6 flex-auto items-center justify-center gap-1 whitespace-nowrap rounded-full px-1.5 text-[12px] transition-colors",
          on ? "bg-[var(--attention)] font-medium text-neutral-900" : "text-muted-foreground hover:text-foreground",
        )}
      >
        {providerId ? <HarnessIcon providerId={providerId} /> : <span>{label}</span>}
        {providerId && words ? <span>{label}</span> : null}
        <span className={cn(on ? "opacity-70" : "opacity-60")} style={tnum}>{n}</span>
      </button>
    );
    if (!providerId || words) return button;
    return (
      <Tooltip key={key ?? "all"}>
        <TooltipTrigger asChild>{button}</TooltipTrigger>
        <TooltipContent side="bottom">{`${label}: ${n} chats`}</TooltipContent>
      </Tooltip>
    );
  };
  const total = counts.reduce((s, [, n]) => s + n, 0);
  return (
    <div ref={ref} className="mx-1 mb-2 flex h-7 min-w-0 flex-nowrap items-center gap-0.5 rounded-full border border-border p-0.5" role="group" aria-label="Filter by harness">
      {item(null, "All", total, null)}
      {counts.map(([h, n, providerId]) => item(h.key, h.label, n, providerId))}
    </div>
  );
}
