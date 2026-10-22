See what every sub-agent is doing while an agent works.

## What you get

- A taskbar above the composer with the to-do list's progress, or the sub-agent batch's progress when there is no to-do list, and what is happening now.
- A Helper Desk side panel with the chat's cost, sub-agent tokens and time, and one card per sub-agent showing its tokens, time, current step and progress.
- A short "Done" notice when each sub-agent finishes.

## How it works

It reads the thread's own bb events and the local Claude Code sub-agent transcripts on this machine. Nothing leaves the machine and nothing is sent to a model. Cost is an API-equivalent estimate unless bb reports a real figure.
