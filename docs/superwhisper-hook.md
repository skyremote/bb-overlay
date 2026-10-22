# Superwhisper and bb: stop chats sticking on "Working"

If you use the Superwhisper plugin for Claude Code, its hook runs every time Claude finishes a reply and waits for a voice response in the Superwhisper panel. In a normal terminal that is what you want. Inside bb, Claude Code runs without a terminal, so nobody answers and the hook holds the turn open: the chat says "Working" for minutes after the reply has arrived.

The plugin's hook honours a `CLAUDE_HOOK` environment variable, so you can point it at a small wrapper that skips the hook inside bb (bb sets `BB_THREAD_ID` for every chat it runs) and runs the real hook everywhere else.

1. Save this as `~/bin/sw-hook` and make it executable (`chmod +x ~/bin/sw-hook`):

   ```sh
   #!/bin/sh
   # Skip the Superwhisper hook inside bb chats; run it as normal everywhere else.
   [ -n "$BB_THREAD_ID" ] && exit 0
   exec /Applications/superwhisper.app/Contents/Resources/claude-hook "$@"
   ```

2. Add the variable to the `env` block of `~/.claude/settings.json` (create the block if it is missing, keep everything else as it is, and back the file up first). Use your own home folder in place of `/Users/you`:

   ```json
   "env": {
     "CLAUDE_HOOK": "/Users/you/bin/sw-hook"
   }
   ```

New Claude Code sessions pick it up. Chats that are already open pick it up when their Claude process restarts. To undo it, remove the line and delete the file.
