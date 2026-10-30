---
name: bb-overlay-guide
description: Resume or replay the interactive BB Overlay guide for Simple or the existing Pro workspace.
---

# BB Overlay guide

The guide is a real, local coach-mark overlay. Open it from the command palette:
**BB Overlay guide: open or resume**. Use **BB Overlay guide: replay** to start a
fresh set of read checks while retaining completion history. Both are also in
Settings, Installed plugins, BB Overlay guide.

Each step requires the person to tick **I’ve read this step** before Next. Never
acknowledge on their behalf. Back preserves this run’s read checks. Close/Escape
saves the current position. Missing controls receive an explicit explanation and
Try again; the guide never clicks a substitute control or activates a plugin.

Configuration (guide only; it never changes an edition’s layout):

- `bb plugin config bb-overlay-guide set edition simple` (or `pro`).
- `bb plugin config bb-overlay-guide set autoStart true` offers this edition/version
  once. It does not reopen a dismissed, paused or completed guide on installer reruns.
- `bb plugin config bb-overlay-guide set guideVersion 1` selects a progress namespace.

No video, model call, account connection or provider configuration is used.

Live acknowledgement boundary: never tick a live user's read checks, progress the
live tour or mark completion on their behalf. Only the person's own deliberate UI
action satisfies the read check. Automated progression tests must run against an
isolated static fixture or isolated BB data directory, never Daniel's live guide.
