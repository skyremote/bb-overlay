---
name: finder-links
description: How the Finder Links bb mod turns file and folder paths in chat replies into clickable links. Use when the user asks why a path or file link in bb does or does not open, or how to make agents' paths clickable.
---

# Finder Links

Any path an agent writes in inline code (`/Users/me/Projects/report.pdf`, `~/Documents/...`,
or a relative name such as `Source/deck.pptx`) becomes clickable once the mod has
checked that it really exists. A dotted underline marks it.

- Click a path: Finder opens on the Mac running bb with the file selected (a folder opens as a window).
- bb's own file links that point at the wrong folder (bb guesses the project root) are
  repaired: the click opens bb's preview on the file that actually exists.

Relative names resolve against folders named earlier in the same reply, then the
thread's working folder. The optional setting "Mirror folders" (`folder = other folder`
per line) makes a path missing on one side try the other.

For agents: write paths in backticks, absolute where possible, and name the folder before
listing bare file names, so they resolve.
