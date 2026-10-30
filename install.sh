#!/usr/bin/env bash
# BB Overlay installer, from NavAIgate (https://navaigate.dev).
#
# Installs everything BB Overlay uses, in one go:
#   - NavAIgate Workspace and Kanban, from this repository
#   - the five mods, from this repository (bb 0.46 or later): Helper Desk,
#     Cache Clock, Reflect, Screen Share and Finder Links
#   - NavMotion Skin, from this repository (bb 0.47 or later): three moving
#     skins, a Skin button and Markdown in the chat box
#   - Projects & Sections (project-folders) by VKirill, MIT, from its own repository
#   - Agent Board by aaronphifer, MIT, from its own repository
#   - bb's built-in Tasks plugin (opt-in in bb, so it is installed if missing)
# then turns on the NavAIgate theme and rail, reloads, and prints a checklist.
#
# Safe to run again: anything already installed is updated within its own pin,
# and nothing is removed or downgraded without asking. The one thing it asks
# about: Projects & Sections at 0.6.20 or later, or following a version range,
# which it offers to switch to the pinned 0.6.19 (your folders are kept). A
# plugin you installed from somewhere else (a local copy, say) is left exactly
# as it is.
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/skyremote/bb-overlay/main/install.sh | bash
#   bash install.sh [--dry-run] [--no-look] [--no-mods] [--pin-folders] [--help]
#
#   --dry-run       print every command, change nothing
#   --no-look       leave the theme, navigation and sidebar list as they are
#   --no-mods       skip the five mods (Helper Desk, Cache Clock, Reflect,
#                   Screen Share, Finder Links); ones you already have are left as they are
#   --pin-folders   switch Projects & Sections to 0.6.19 without asking
#                   (your folders are kept); see MAINTAINERS.md

set -euo pipefail

EDITION="BB Overlay"
REPO_URL="https://github.com/skyremote/bb-overlay.git"
REPO_REF="main"
MIN_BB="0.45"
MIN_BB_MODS="0.46"

# Either NavAIgate edition counts as ours: the public BB Overlay and the
# members' edition ship the same plugins, so a copy from the other one is
# updated where it is, not kept as it was.
NAV_MATCH="github.com/skyremote/bb-overlay|github.com/skyremote/navaigate-workspace"

# From 0.6.20 on, Projects & Sections declares functions only VKirill's own bb
# build has (vk-requires.json), yet bb still offers those releases to a range.
# 0.6.19 is the last release that runs on standard bb, so it is installed
# pinned, and an existing copy is never updated by this script. A copy at
# 0.6.20 or later, or one that follows a version range (so bb offers it the
# newer releases), is offered a switch to the pinned 0.6.19. When to lift the
# pin: MAINTAINERS.md.
PF_VERSION="0.6.19"
PF_SOURCE="git:https://github.com/VKirill/bb-plugin-project-folders.git@v${PF_VERSION}"
PF_FALLBACK="$PF_SOURCE"
PF_MATCH="github.com/VKirill/bb-plugin-project-folders"
AB_SOURCE="git:https://github.com/aaronphifer/bb-plugin-agent-board.git@semver:^0.6.1"
AB_MATCH="github.com/aaronphifer/bb-plugin-agent-board"

WS_ID="navaigate-workspace"
THEME_ID="plugin:${WS_ID}:navaigate"
RAIL_ID="${WS_ID}/rail"

DRY_RUN=0
SET_LOOK=1
SET_MODS=1
PIN_FOLDERS=0
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=1 ;;
    --no-look) SET_LOOK=0 ;;
    --no-mods) SET_MODS=0 ;;
    --pin-folders) PIN_FOLDERS=1 ;;
    -h|--help)
      if [ -f "$0" ]; then awk 'NR > 1 && !/^#/ { exit } NR > 1 { sub(/^# ?/, ""); print }' "$0"
      else echo "Options: --dry-run, --no-look, --no-mods, --pin-folders. Run with bash -s -- <option> after the pipe."; fi
      exit 0 ;;
    *) echo "Unknown option: $arg (try --help)" >&2; exit 2 ;;
  esac
done

SET_LOOK_REQUESTED=$SET_LOOK

W_INST="[installed]"; W_UPD="[up to date]"
if [ "$DRY_RUN" -eq 1 ]; then W_INST="[would install]"; W_UPD="[would update]"; fi
W_INST="$(printf '%-12s' "$W_INST")"; W_UPD="$(printf '%-12s' "$W_UPD")"   # line up the checklist

say()  { printf '%s\n' "$*"; }
step() { printf '\n== %s\n' "$*"; }
warn() { printf 'Note: %s\n' "$*" >&2; }
die()  { printf 'Stopped: %s\n' "$*" >&2; exit 1; }

# Print a command, then run it (or only print it with --dry-run).
run() {
  printf '  $ %s\n' "$*"
  if [ "$DRY_RUN" -eq 1 ]; then return 0; fi
  "$@"
}

CHANGED=()   # plugin ids installed or updated in this run (reloaded at the end)
OUTCOME=()   # checklist lines

# ---------------------------------------------------------------- bb itself
step "Checking bb"
BB="$(command -v bb || true)"
if [ -z "$BB" ] && [ -x "/Applications/bb.app/Contents/Resources/app.asar.unpacked/node_modules/bb-app/host-daemon/dist/bb" ]; then
  BB="/Applications/bb.app/Contents/Resources/app.asar.unpacked/node_modules/bb-app/host-daemon/dist/bb"
fi
[ -n "$BB" ] || die "bb is not installed, or its command is not on your PATH. Install bb from https://getbb.app, open it once, then run this again."
bb() { "$BB" "$@"; }

BB_VERSION="$(bb --version 2>/dev/null | head -n1 | tr -d '[:space:]')"
say "bb $BB_VERSION"
version_lt() { # true when $1 < $2 (major.minor.patch)
  local IFS=.
  # shellcheck disable=SC2206
  local a=($1) b=($2)
  for i in 0 1 2; do
    local x="${a[$i]:-0}" y="${b[$i]:-0}"
    x="${x%%[!0-9]*}"; y="${y%%[!0-9]*}"
    [ "${x:-0}" -lt "${y:-0}" ] && return 0
    [ "${x:-0}" -gt "${y:-0}" ] && return 1
  done
  return 1
}
if version_lt "$BB_VERSION" "$MIN_BB"; then
  warn "BB Overlay is tested on bb $MIN_BB and later. Update bb first (bb updates, or download it again from getbb.app); installing anyway."
fi

PLUGIN_LIST="$(bb plugin list 2>/dev/null)" || die "bb is installed but not answering. Open the bb app, wait for it to load, then run this again."

# The repository must be reachable (the members' edition is private).
if command -v git >/dev/null 2>&1; then
  if ! GIT_TERMINAL_PROMPT=0 git ls-remote "$REPO_URL" HEAD >/dev/null 2>&1; then
    die "Can't reach $REPO_URL. If it is private, check you have access, then sign git in to GitHub (for example: gh auth login, then gh auth setup-git) and run this again."
  fi
fi

# ---------------------------------------------------------------- helpers
# plugin_line <id> -> "<version> <status>" or empty when not installed
plugin_line() {
  printf '%s\n' "$PLUGIN_LIST" | awk -v id="$1" '
    $0 ~ /^[^ ]/ { split($1, p, "@"); if (p[1] == id) { print p[2], $2; exit } }'
}
# plugin_source <id> -> source string or empty
plugin_source() {
  printf '%s\n' "$PLUGIN_LIST" | awk -v id="$1" '
    $0 ~ /^[^ ]/ { split($1, p, "@"); cur = p[1]; next }
    cur == id && $1 == "source:" { sub(/^ *source: */, ""); print; exit }'
}

# src_matches <source> <a|b|...> -> true when the source contains any of them
src_matches() {
  local src="$1" m IFS='|'
  for m in $2; do [[ "$src" == *"$m"* ]] && return 0; done
  return 1
}

# ask <question> -> true on yes. Reads the terminal, so it works under
# curl | bash; with no terminal (an agent, CI) the answer is no.
ask() {
  local reply=""
  if (: </dev/tty) 2>/dev/null; then
    printf '%s [y/N] ' "$1" >/dev/tty
    read -r reply </dev/tty || reply=""
  fi
  case "$reply" in y|Y|yes|Yes|YES) return 0 ;; *) return 1 ;; esac
}

# folders_existing <label> <version> <source>: Projects & Sections is already
# installed from VKirill's repository. 0.6.20 and later need VKirill's own bb
# build, and a copy that follows a range is offered those releases by bb, so
# offer the pinned 0.6.19. bb keeps a plugin's data when it is removed, so the
# folders survive the switch.
folders_existing() {
  local label="$1" ver="$2" src="$3" why=""
  if ! version_lt "$ver" "0.6.20"; then
    why="$ver needs VKirill's own build of bb, so on standard bb its folders can stop working"
  elif [[ "$src" == *"@semver:"* || "$src" != *.git@* ]]; then
    why="it follows a version range or branch, so bb offers 0.6.20 and later as updates, and those need VKirill's own build of bb"
  fi
  if [ -z "$why" ]; then
    say "$label: installed ($ver, pinned). Leaving it as it is."
    OUTCOME+=("[ok]         $label ($ver, pinned)")
    return 0
  fi
  warn "$label: $why. $PF_VERSION is the last release for standard bb, and switching to it keeps your folders."
  if [ "$DRY_RUN" -eq 1 ]; then
    say "Would ask to switch to $PF_VERSION (or switch without asking with --pin-folders). A yes runs:"
    run bb plugin remove project-folders --yes
    run bb plugin install "$PF_SOURCE" --yes
    OUTCOME+=("[would ask]  $label ($ver): switch to $PF_VERSION, pinned")
  elif [ "$PIN_FOLDERS" -eq 1 ] || ask "Switch $label to $PF_VERSION, pinned? Your folders are kept."; then
    if run bb plugin remove project-folders --yes && run bb plugin install "$PF_SOURCE" --yes; then
      CHANGED+=("project-folders"); OUTCOME+=("$W_INST $label ($PF_VERSION, pinned; your folders kept)")
    else
      warn "The switch didn't finish. Putting back what you had."
      bb plugin list 2>/dev/null | grep -q '^project-folders@' || run bb plugin install "$src" --yes || true
      OUTCOME+=("[FAILED]     $label: switch to $PF_VERSION failed, see above")
    fi
  else
    say "Left as it is. To switch later, run this installer again with --pin-folders (after a pipe: bash -s -- --pin-folders)."
    OUTCOME+=("[warning]    $label ($ver): not pinned to $PF_VERSION; run again with --pin-folders")
  fi
}

# [FALLBACK=<source>] ensure <id> <label> <match-in-source> <install args...>
# FALLBACK is tried when the install fails, and an installed copy is never updated.
ensure() {
  local id="$1" label="$2" match="$3"; shift 3
  local line src status fallback="${FALLBACK:-}"
  line="$(plugin_line "$id")"
  if [ -z "$line" ]; then
    say "$label: not installed, installing."
    if run bb plugin install "$@" --yes; then
      CHANGED+=("$id"); OUTCOME+=("$W_INST $label")
    elif [ -n "$fallback" ] && [ "$fallback" != "$1" ] && say "$label: no recent release runs on this bb, trying ${fallback##*@}." \
      && run bb plugin install "$fallback" --yes; then
      CHANGED+=("$id"); OUTCOME+=("$W_INST $label (${fallback##*@}, the last release for this bb)")
    else
      OUTCOME+=("[FAILED]     $label: install failed, see above")
    fi
    return 0
  fi
  src="$(plugin_source "$id")"
  status="${line#* }"
  if [[ "$src" == builtin:* ]]; then
    say "$label: installed (${line%% *}, updates with bb)."
    OUTCOME+=("[ok]         $label")
  elif [ -n "$match" ] && ! src_matches "$src" "$match"; then
    say "$label: already installed from $src. Keeping your copy as it is."
    OUTCOME+=("[kept]       $label (your own copy: $src)")
  elif [ -n "$fallback" ]; then
    # Never update this one in place: bb offers releases that need VKirill's
    # own bb build as updates. Offer the pinned release instead.
    folders_existing "$label" "${line%% *}" "$src"
  else
    say "$label: installed (${line%% *}), checking for an update."
    if run bb plugin update "$id" --yes; then
      CHANGED+=("$id"); OUTCOME+=("$W_UPD $label")
    else
      OUTCOME+=("[ok]         $label (update check failed, kept ${line%% *})")
    fi
  fi
  if [ "$status" = "disabled" ]; then
    say "$label is turned off, turning it on."
    run bb plugin enable "$id" || warn "Couldn't turn on $label. Try: bb plugin enable $id"
  fi
}

# ---------------------------------------------------------------- plugins
step "Installing $EDITION"
ensure "$WS_ID" "NavAIgate Workspace" "$NAV_MATCH" "git:${REPO_URL}@${REPO_REF}" --plugin workspace
ensure "kanban" "Kanban" "$NAV_MATCH" "git:${REPO_URL}@${REPO_REF}" --plugin kanban

step "Installing the mods"
if [ "$SET_MODS" -eq 0 ]; then
  say "Skipped (--no-mods)."
  OUTCOME+=("[skipped]    Mods: Helper Desk, Cache Clock, Reflect, Screen Share, Finder Links (--no-mods)")
elif version_lt "$BB_VERSION" "$MIN_BB_MODS"; then
  say "The mods need bb $MIN_BB_MODS or later; this is bb $BB_VERSION. Skipping them for now."
  OUTCOME+=("[skipped]    Mods: need bb $MIN_BB_MODS or later, then run this again")
else
  ensure "helper-desk" "Helper Desk (sub-agents at a glance)" "$NAV_MATCH" "git:${REPO_URL}@${REPO_REF}" --plugin helper-desk
  ensure "cache-clock" "Cache Clock (cache countdown, Keep warm, Hand off)" "$NAV_MATCH" "git:${REPO_URL}@${REPO_REF}" --plugin cache-clock
  ensure "reflect" "Reflect (save the rules you give your agents)" "$NAV_MATCH" "git:${REPO_URL}@${REPO_REF}" --plugin reflect
  ensure "screen-share" "Screen Share (hide names and amounts on screen)" "$NAV_MATCH" "git:${REPO_URL}@${REPO_REF}" --plugin screen-share
  ensure "finder-links" "Finder Links (click a path in a reply to show it in Finder)" "$NAV_MATCH" "git:${REPO_URL}@${REPO_REF}" --plugin finder-links
fi

step "Installing NavMotion Skin"
if version_lt "$BB_VERSION" "0.47"; then
  say "NavMotion Skin needs bb 0.47 or later; this is bb $BB_VERSION. Skipping it for now."
  OUTCOME+=("[skipped]    NavMotion Skin: needs bb 0.47 or later, then run this again")
else
  ensure "navmotion-skin" "NavMotion Skin (moving skins, a Skin button, Markdown in the chat box)" "$NAV_MATCH" "git:${REPO_URL}@${REPO_REF}" --plugin navmotion-skin
fi

step "Installing the companions (made by other people, MIT, from their own repositories)"
FALLBACK="$PF_FALLBACK" ensure "project-folders" "Projects & Sections by VKirill (folders, Move to folder)" "$PF_MATCH" "$PF_SOURCE"
ensure "agent-board" "Agent Board by aaronphifer" "$AB_MATCH" "$AB_SOURCE"

step "Checking bb's built-in plugins"
# Tasks powers To-do and the Board. It ships with bb but is opt-in.
ensure "tasks" "Tasks (built into bb; To-do and Board)" "" tasks
# Account Pooler is optional: it routes Claude and Codex traffic across your
# accounts, so we report it rather than switch it on for you.
ap="$(plugin_line account-pool)"
case "${ap#* }" in
  "") OUTCOME+=("[optional]   Account Pooler (built into bb): not present in this bb") ;;
  disabled) OUTCOME+=("[optional]   Account Pooler (built into bb) is off. Turn it on with: bb plugin enable account-pool, then add accounts with: bb pool") ;;
  *) OUTCOME+=("[ok]         Account Pooler (built into bb)") ;;
esac

# ---------------------------------------------------------------- reload
if [ "${#CHANGED[@]}" -gt 0 ]; then
  step "Reloading"
  for id in "${CHANGED[@]}"; do run bb plugin reload "$id" || warn "Couldn't reload $id. Reload bb with Cmd-R (Ctrl-R on Linux)."; done
fi

# ---------------------------------------------------------------- the look
manual_look() {
  say "Set the look by hand in bb: Settings, Appearance."
  say "  Theme: NavAIgate"
  say "  Thread list: NavAIgate rail"
  say "  Navigation: Rail (bb 0.47 or later)"
}
step "The NavAIgate theme and rail"
if [ "$SET_LOOK" -eq 0 ]; then
  say "Skipped (--no-look)."
  OUTCOME+=("[skipped]    Theme and rail (--no-look)")
elif ! bb theme --help >/dev/null 2>&1 || ! bb settings ui --help >/dev/null 2>&1; then
  manual_look
  OUTCOME+=("[by hand]    Theme and rail: Settings, Appearance")
else
  rail="$(bb settings ui get sidebar.threadListProvider 2>/dev/null | tr -d '"[:space:]' || true)"
  theme="$(bb theme show 2>/dev/null | head -n1 || true)"
  if [ "$rail" = "$RAIL_ID" ]; then
    say "The NavAIgate rail is already your sidebar list."
  elif [[ "$rail" == *navaigate* ]]; then
    # Another NavAIgate rail (a personal build) is in use: leave the look alone.
    say "Another NavAIgate rail ($rail) is your sidebar list. Leaving your theme and rail as they are."
    OUTCOME+=("[kept]       Theme and rail (your own NavAIgate rail: $rail)")
    SET_LOOK=0
  else
    [ -n "$rail" ] && say "Sidebar list was: $rail (to go back: bb settings ui set sidebar.threadListProvider $rail)"
    run bb settings ui set sidebar.threadListProvider "$RAIL_ID" || { warn "Couldn't set the rail."; manual_look; }
  fi
  if [ "$SET_LOOK" -eq 1 ]; then
    if [[ "$theme" == *"$THEME_ID"* ]]; then
      say "The NavAIgate theme is already on."
    else
      [ -n "$theme" ] && say "Theme was: $theme (to go back: bb theme reset, or bb theme set <id>)"
      run bb theme set "$THEME_ID" || { warn "Couldn't set the theme."; manual_look; }
    fi
    OUTCOME+=("[ok]         NavAIgate theme and rail")
  fi
fi

# Navigation and thread list are separate preferences. Since bb 0.47,
# Automatic can pick another plugin's navigation list above the chats.
# Pin the bundled icon rail even when preserving a personal NavAIgate theme.
if [ "$SET_LOOK_REQUESTED" -eq 1 ] && ! version_lt "$BB_VERSION" "0.47"; then
  nav="$(bb settings ui get sidebar.navigationProvider 2>/dev/null | tr -d '"[:space:]' || true)"
  if [ "$nav" = "navigation/rail" ]; then
    say "Navigation is already the left icon rail."
    OUTCOME+=("[ok]         Left icon rail (navigation/rail)")
  elif run bb settings ui set sidebar.navigationProvider navigation/rail; then
    OUTCOME+=("[ok]         Left icon rail (navigation/rail)")
  else
    warn "Couldn't set navigation. Open Settings, Appearance, Navigation and choose Rail."
    OUTCOME+=("[by hand]    Navigation: Settings, Appearance, Navigation, Rail")
  fi
fi

# ---------------------------------------------------------------- checklist
step "Checklist"
[ "$DRY_RUN" -eq 1 ] && say "(dry run: nothing was changed)"
for l in "${OUTCOME[@]}"; do say "  $l"; done
cat <<EOF

Next:
  1. Reload bb (Cmd-R on a Mac, Ctrl-R on Linux).
  2. Open Home in the sidebar and walk through Set up.
Run this again any time to update everything. It never removes anything without asking.
EOF
