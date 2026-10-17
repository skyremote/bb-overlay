// Navigation you can fold: bb's sidebar navigation (New thread, Search, Board,
// Automations, plugin pages, More) under one "Navigate" row. Click the row to
// fold the whole list to that line, so the rail moves up; right-click it to
// hide the navigation entirely ("Show navigation" in the rail's right-click
// menu brings it back). The choice is kept in localStorage; ⌘⇧B toggles it.
//
// The rows themselves stay bb's own: experimental_Original renders bb's bundled
// Navigation plugin, so clicks, the active item, the "…" menus, More, drag to
// reorder and keyboard focus behave exactly as before. It stays mounted while
// folded (only hidden), so nothing it listens for is lost. If a later bb drops
// experimental_Original. (bb 0.46.1 removed useSidebarNavigation, so there is no
// self-drawn fallback any more: without Original the rows are simply bb's own.)
import { useSyncExternalStore } from "react";
import type { ComponentType } from "react";
import { experimental_Icon as Icon, type ExperimentalSidebarNavigationProps } from "@get-bb/plugin-sdk/app";
import { cn } from "@/lib/utils";
import { tnum } from "./shared";
import { Menu, MenuItem } from "./menu";

/* ------------------------------ state ------------------------------ */

export type NavMode = "open" | "folded" | "hidden";
const KEY = "nav-skin:nav";
export const NAV_SHORTCUT = "⌘⇧B";

function read(): NavMode {
  try {
    const v = window.localStorage.getItem(KEY);
    return v === "folded" || v === "hidden" ? v : "open";
  } catch {
    return "open";
  }
}

let mode: NavMode = typeof window === "undefined" ? "open" : read();
const subs = new Set<() => void>();
const notify = () => subs.forEach((f) => f());
if (typeof window !== "undefined") {
  window.addEventListener("storage", (e) => {
    if (e.key === KEY) {
      mode = read();
      notify();
    }
  });
}

export function setNavMode(next: NavMode) {
  mode = next;
  try {
    window.localStorage.setItem(KEY, next);
  } catch {
    /* storage blocked: the choice lasts until reload */
  }
  notify();
}

/** Fold when open; open when folded or hidden. */
export function toggleNav() {
  setNavMode(mode === "open" ? "folded" : "open");
}

export function useNavMode(): NavMode {
  return useSyncExternalStore(
    (f) => {
      subs.add(f);
      return () => subs.delete(f);
    },
    () => mode,
    () => "open",
  );
}

/* ----------------------------- provider ---------------------------- */

export function FoldableNavigation({ experimental_Original }: ExperimentalSidebarNavigationProps) {
  const navMode = useNavMode();
  const Original = (experimental_Original as ComponentType | undefined) ?? null;
  const folded = navMode !== "open";

  return (
    <div data-nav-skin-nav={navMode}>
      {navMode === "hidden" ? null : (
        <Menu
          trigger={
            <button
              type="button"
              aria-expanded={!folded}
              aria-controls="nav-skin-nav-rows"
              aria-keyshortcuts="Meta+Shift+B"
              title={folded ? `Show the navigation (${NAV_SHORTCUT})` : `Fold the navigation (${NAV_SHORTCUT}). Right-click for more.`}
              onClick={() => setNavMode(folded ? "open" : "folded")}
              className={cn(
                "group/navhead mx-2 flex h-7 w-[calc(100%-1rem)] items-center gap-1.5 rounded-md pl-2 pr-1.5 text-left outline-none",
                "text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground hover:bg-sidebar-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring",
                folded ? "mt-2 mb-1" : "mt-2 -mb-1.5",
              )}
            >
              <span className="flex-1">Navigate</span>
              {folded ? <span className="normal-case tracking-normal opacity-0 transition-opacity group-hover/navhead:opacity-70" style={tnum}>{NAV_SHORTCUT}</span> : null}
              <Icon name="ChevronDown" className={cn("size-3.5 opacity-70 transition-transform duration-150", folded && "-rotate-90")} />
            </button>
          }
        >
          <MenuItem icon={folded ? "ChevronsDown" : "ChevronsUp"} label={folded ? "Unfold navigation" : "Fold navigation"} hint={NAV_SHORTCUT} onSelect={() => setNavMode(folded ? "open" : "folded")} />
          <MenuItem icon="EyeOff" label="Hide navigation entirely" onSelect={() => setNavMode("hidden")} />
        </Menu>
      )}
      {/* Kept mounted while folded or hidden, so bb's rows keep their own state. */}
      <div id="nav-skin-nav-rows" hidden={folded}>
        {Original ? <Original /> : null}
      </div>
    </div>
  );
}
