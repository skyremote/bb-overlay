---
name: reflect
description: How the Reflect bb plugin catches lasting rules in the user's messages and where it saves them. Use when the user asks why a "That sounds like a lasting rule" card appeared, where a saved rule went, or to test the detector.
---

# Reflect

Reflect watches messages the user types (never agent or plugin messages). When one contains a lasting rule
("from now on never use hashtags", "no emojis in my community posts", "don't ever deploy on a Friday"), a card
appears above the composer with the tidied rule and save buttons. It never blocks or changes the message and
makes no model calls; detection is a deterministic heuristic.

Save buttons (each shows only when its destination is set in the plugin settings):
- Save to voice profile: appends to a `##` section of a markdown voice or style profile, and can commit that one
  file (push is off by default). Listed first when the rule is about wording or tone.
- Save to CLAUDE.md: appends under `## Rules from corrections` in `~/.claude/CLAUDE.md`.
- Save to second brain: runs the user's own command with `{rule}` and `{thread}` filled in, without a shell.
- Skip: dismisses the card.

Every write is append-only and idempotent; each file is backed up to `/tmp/reflect/backups/` before its first
write in a plugin session.

Commands:
- `bb reflect test <text>` shows what the detector would catch.
- `bb reflect pending <thread-id>` shows a thread's unanswered card.
- `bb reflect paths` shows the save destinations.
- `bb plugin config reflect set <key> <value>` changes a destination, or `enabled false` switches detection off.
