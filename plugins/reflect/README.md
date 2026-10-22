# Reflect

Part of [BB Overlay](../../README.md), by [NavAIgate](https://navaigate.dev).

When you tell an agent a rule you want kept ("from now on never use hashtags in my LinkedIn posts", "don't ever deploy on a Friday"), Reflect notices and puts a small card above the chat box: **That sounds like a lasting rule. Save it?**, with the rule tidied up and a button for each place you keep rules. Press one and the rule is written there, or press Skip.

- It only reads messages you type, never messages from agents or plugins.
- It never blocks or changes your message, and it uses no AI: detection is a fixed pattern check, so it costs nothing to run. It prefers missing a rule to showing a card for nothing.
- Writes only ever add a line, never add the same rule twice, and back the file up first.

## Where rules can go

Each button appears only when you have set its destination:

| Setting | Default | What the button does |
| --- | --- | --- |
| `claudeMdPath` | `~/.claude/CLAUDE.md` | Adds the rule under `## Rules from corrections`, so every new Claude chat follows it. |
| `voiceProfilePath` | empty | Adds the rule to a section (`voiceSection`, default "Rules from corrections") of your own voice or style guide. If that file is in a git repo it commits it (`commitVoice`, on), and can push (`pushVoice`, off). |
| `brainCommand` | empty | Runs your own notes or memory tool, for example `mynotes add "Rule: {rule}"`. `{rule}` and `{thread}` are filled in, and no shell is used. |

Example: `bb plugin config reflect set voiceProfilePath ~/Documents/style/VOICE.md`

## Commands

- `bb reflect test "never use the word synergy"` shows what it would catch.
- `bb reflect paths` shows where each button writes.

Switch detection off with `bb plugin config reflect set enabled false`, or the whole mod with `bb plugin disable reflect`.
