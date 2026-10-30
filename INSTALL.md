# Install BB Overlay: Simple or Pro

You need **bb 0.48 or later** on macOS or Linux, open and signed in to your chosen AI harness.

## Choose your starting setup

**Simple** gives you a quiet branded project/chat sidebar, Helper Desk, Cache Clock, Reflect, Screen Share and the guided tour. BB keeps its own conversations, models, files, terminal, diffs and Side Chat. Simple does not install the full Workspace, boards, folders, voice, Inbox, Calendar or remote-machine services.

**Pro** is the established full Workspace, with the existing rail, tabs, folders, pages and tools. It has not been replaced by the Pro design concept. An existing Pro installation keeps its appearance, personal plugin sources and disabled tools; the update adds the guide.

For a fresh Simple install:

```sh
curl -fsSL https://raw.githubusercontent.com/skyremote/bb-overlay/main/install.sh | bash
```

For a fresh Pro install:

```sh
curl -fsSL https://raw.githubusercontent.com/skyremote/bb-overlay/main/install.sh | bash -s -- --edition pro
```

Already installed? The first command detects and preserves your current edition. Explicitly select `--edition simple` or `--edition pro` to change it. Switching disables the other Workspace core without removing its data; independently installed plugins are kept. When switching from Pro with appearance changes enabled, its navigation, thread-list and theme are saved locally for a return to Pro.

To inspect the commands first, add `--dry-run`. Use `--no-look` to leave appearance preferences alone, or `--no-mods` to omit the helper plugins. Read [install.sh](install.sh) before running it if you prefer. No installer path uninstalls a plugin.

## Walk through the real workspace

Reload BB with **Cmd-R** on Mac or **Ctrl-R** on Linux. The guide offers to start once for the installed edition and guide version.

The tour highlights the actual control it explains and moves between locations with short, polished transitions. There are no videos. Each step needs an explicit **I've read this** acknowledgement before you can continue. Closing pauses the guide; it does not mark it complete. Progress is saved on your BB server, separately for Simple and Pro. Missing controls are explained rather than highlighted incorrectly.

In Simple, **Features → Open BB Overlay guide** returns to it. In either edition, open **Settings → Plugins → BB Overlay guide** to open/resume or replay the walkthrough. The command palette also has **BB Overlay guide: open or resume** and **BB Overlay guide: replay**. Replay starts a fresh set of read acknowledgements while retaining prior completion history. Reduced-motion preferences keep the guidance with gentler transitions.

The existing Pro **Set up** page is still available for its optional service connections. The workspace tour does not connect accounts, enter credentials, send prompts or change plugin settings for you.

## Appearance and optional tools

A fresh install selects **Navigation → Rail**. Simple uses **Thread list → NavAIgate Simple** and its warm light/dark theme; Pro uses the existing **NavAIgate rail**. Navigation and Thread list are separate settings under **Settings → Appearance**. Existing installations keep their saved values.

Simple's Features drawer shows real helper status and lets you explicitly turn installed helpers on or off. Use their own settings for configuration. Cache Clock is useful for applicable Claude chats; Screen Share has specific matching coverage, so preview before sharing. No edition implies universal privacy protection or a particular provider's cache guarantee.

Optional third-party folders and Agent Board remain part of the full Pro installer. Projects & Sections is pinned to 0.6.19 for standard BB compatibility; existing versions are not automatically removed or downgraded. Disabled plugins stay disabled on an ordinary update.

## If the guide does not appear

- Reload BB, then open or resume it from its plugin Settings section.
- A paused or completed guide does not pop up again on each update. Choose **Replay** to start it again.
- If you deliberately disabled `bb-overlay-guide`, enable it in Plugins first.
- Update BB if the installer says your version is too old.
