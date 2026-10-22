# Cache Clock

Part of [BB Overlay](../../README.md), by [NavAIgate](https://navaigate.dev).

Claude keeps a saved copy of your chat (the prompt cache) for a limited time after each reply. While it is warm, your next message reads that copy for a small part of the normal price. Once it goes cold, the next message re-reads the whole chat at full price, which on a long chat can cost many times more.

Cache Clock puts a bar above the chat box on Claude Code chats:

- **Cache warm 59:55** with a bar that drains, counted from the last reply. When time runs out it turns amber: **Cache cold**, with how many tokens the next message will re-read.
- **Keep warm** sends a short ping message (you will see it in the chat) about two minutes before the cache expires, so the clock restarts. It stops on your next message or after two hours.
- **Hand off** asks the chat to write a full brief (goal, decisions, files, tools, current state, next steps), then opens a new chat with that brief in the box. You read it and press send. Nothing hands off on its own.

bb does not tell plugins how long the provider keeps the cache, so the length is a setting: 60 minutes on a Claude subscription (the default), 5 minutes with an API key.

## Settings

- `ttlMinutes` (default `60`): `bb plugin config cache-clock set ttlMinutes 5`
- `keepWarmMaxHours` (default `2`): `bb plugin config cache-clock set keepWarmMaxHours 4`

## CLI

- `bb cache-clock status <thread-id>`
- `bb cache-clock keep-warm <thread-id> on|off`

Switch it off with `bb plugin disable cache-clock`.
