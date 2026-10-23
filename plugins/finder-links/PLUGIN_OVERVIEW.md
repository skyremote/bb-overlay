# Finder Links

Click a file or folder path in an agent's reply to show it in Finder. Paths only become clickable once the mod has checked that they exist.

## What you get

- A path in inline code (absolute, `~/`, or a name relative to a folder mentioned earlier in the same reply) gets a dotted underline. Click it and Finder opens on your Mac with the file selected, or the folder open in its own window.
- bb's own file links that point at the wrong folder (bb guesses the project root) are repaired: clicking opens bb's preview on the file that actually exists.
- Finder opens on the Mac running bb, including when you view bb remotely in a browser.
- Drag across a path to copy it as before. Only a plain click opens it.

## How it works

The frontend reads the paths in each reply and asks the plugin's server which exist; nothing else is marked. Relative names are tried against folders mentioned earlier in the same reply, then the chat's working folder. The optional "Mirror folders" setting tries a missing path under a second root, for example a local copy of a network share. Every check gives up after 1.5 seconds, so an unreachable share never freezes the chat. Nothing leaves your machine. macOS only, as it uses Finder.
