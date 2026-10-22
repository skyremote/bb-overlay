# Helper Desk

Part of [BB Overlay](../../README.md), by [NavAIgate](https://navaigate.dev).

Shows what the lead agent and its sub-agents are doing while they work.

- **Taskbar** above the composer: purple progress bar, "Tasks n/m" (to-do list) or "Agents n/m" (sub-agent batch when there is no to-do list), percentage, close button, and "Now: ..." line.
- **Orchestrator card**, pinned at the top of Live and always present: an original navy-and-gold lead bot with a navigator's cap, "Lead · <model>", its state (Working, animated; Waiting for you, slow blink; Needs you, when an interaction is pending or the turn errored), a one-line activity ("Running install.sh", "Reading README.md", "Thinking", "Writing reply"), context used ("288k · 29%") and the estimated session cost.
- **Agent tree**: sub-agents hang under the lead on connector lines in each agent's colour. A pulse travels down on launch, a signal loops while running, and a pulse travels back up when an agent finishes, then the card hops, ticks and slides away. Nested sub-agents indent one more level. When idle, a thin dashed "No agents running · View history" row hangs under the lead.
- **Helper Desk panel** (thread right panel, opens itself once per batch): "N subagents in this chat", three tiles (Total chat cost, Subagent tokens, Time), green "Running · n" and yellow "Finished · n" bars, one card per sub-agent with an original pixel navigator bot in the agent's colour, tokens and time, current step, recent actions and a progress bar.
- **Auto-hide** (setting "Auto-hide finished agents", on by default; delay "Seconds to keep finished agents on screen", default 8): when every agent in a batch has finished, the cards stay with their final numbers, then slide away and the taskbar fades. A panel that opened itself closes again if you did not touch it; a panel you opened shows "No agents running · View history".
- **History tab**: a timeline of every agent batch on the current thread, newest first ("Today 14:32", the request, agents, tokens, duration, estimated cost). Each node expands to the lead line ("Lead · model · request") with that batch's agents beneath it in the same tree, each with the agent's result and "Show more". Rebuilt from the thread's event log; the parsed state is cached in plugin storage by thread and last event seq. The header button shows the lead mini-bot, plus a count while agents run, and reads "Helper Desk" when idle (opens History directly).
- **Animated navigator bots** (original pixel character, pure SVG and CSS): running bots step, blink their antenna light and glance around, offset so they never move in lockstep; a finished bot hops with a tick above its head, then settles; a failed or interrupted bot slumps grey with flat eyes; history bots stay still and blink on hover; a tiny bot walks along the taskbar. Static under reduced motion, paused when off screen.
- **Toasts**: "Done: <agent>" when a sub-agent finishes while you are watching.
- **CLI**: `bb helper-desk show <thread-id>` (live) and `bb helper-desk history <thread-id>` (past batches).

Data: bb thread events (delegations, background agents and the sub-agent items bb streams into the parent thread), bb's to-do list and context usage, and the local Claude Code sub-agent transcripts (read incrementally) for live tokens, model and cost. Cost is an API-equivalent estimate marked "est." unless bb reports a real figure.

Develop: `npm install --include=dev`, `npm run check`, `npm test`, `bb plugin build`, `bb plugin reload helper-desk`. The test log is synthetic: regenerate it with `node tests/fixtures/make-events.mjs`.

Switch it off with `bb plugin disable helper-desk`.
