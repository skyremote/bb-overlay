---
name: cache-clock
description: How the Cache Clock mod works in bb - the cache countdown above the composer, Keep warm, and the manual handoff to a new thread. Use when the user asks about the cache clock, keeping a chat warm, or handing a thread over.
---

# Cache Clock

A banner above the composer of Claude Code threads shows how long the prompt cache stays warm after the last reply.

- **Countdown**: counted from the last completed turn. bb does not expose the provider's cache lifetime, so it is a setting: `bb plugin config cache-clock set ttlMinutes 60` (Claude subscription) or `5` (API key).
- **Keep warm**: sends a short ping message, visible in the chat, about two minutes before expiry. Stops on the user's next message or after `keepWarmMaxHours` (default 2).
- **Hand off**: manual only. The thread's own agent writes a `<handoff>` brief; the user opens a new thread with it from the banner, the `+` menu row "Hand off to a new thread", or the command palette, and presses send themselves. Nothing triggers a handoff automatically.

CLI:
- `bb cache-clock status <thread-id>` - JSON status for a thread.
- `bb cache-clock keep-warm <thread-id> on|off`.

Do not send keep-warm pings or handoff requests to a thread unless the user asks.
