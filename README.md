# BB Overlay

**A complete front end for [bb](https://getbb.app), from [NavAIgate](https://navaigate.dev).** One place for your agents, your inbox, your calendar and your to-dos, with a voice agent and the option to hand work to an always-on machine.

> **In plain words**
>
> - Free to download and use, for yourself or for your own business.
> - Change it as much as you like for your own use.
> - Your team is covered: your employees and contractors, working for you and under your direction, can use and change your copy for your organisation's work, under your licence.
> - Contributions are welcome: you can make a public fork, on GitHub or similar, only to send changes back here as pull requests, and keep it public while they're being reviewed. See [CONTRIBUTING.md](CONTRIBUTING.md).
> - Don't sell it, share copies of it (other than a contribution fork), repackage it as a product, course, template, starter kit or community perk (Skool or anywhere else), or offer it as a hosted service.
> - Keep the NavAIgate name and logo as they are, don't remove the attribution, and don't present it as your own work.
> - Want to do something else with it? Ask first: [navaigate.dev](https://navaigate.dev).
>
> The legal terms are in [LICENSE](LICENSE) (PolyForm Internal Use 1.0.0) and [NOTICE](NOTICE). If this box and those files ever disagree, the files win.

## What's inside

Two bb plugins:

- **NavAIgate Workspace** (`plugins/workspace`)
  - **Home:** a greeting, your daily brief, an Ask box that Jev routes to the right harness, today's calendar, mail that needs a reply, social posts, and how much of each subscription you've used.
  - **Inbox:** every email from your Gmail accounts, read-only. "Sort with Jev" puts each one in a pile (Reply today, Clients, Partners, Billing, Community, Newsletters and more). "Hand to agent" starts a chat that drafts the reply but never sends it.
  - **Calendar:** your Google Calendars as a month view, with your booking links.
  - **The rail:** a run-sheet sidebar with two-line chat rows (model, effort, sub-agents and branch), a colour per project, a NOW card, a harness filter, a Tags dropdown, folders (and folders inside folders), groups that hold whole projects, guide lines that show what sits inside what, "Come back later", and right-click on everything. bb's navigation sits under a Navigate row that folds to one line (⌘⇧B) or hides.
  - **Tabs:** a strip of the chats you have open, with a hover preview and drag to reorder.
  - **Chips under the chat box:** hold a message until the chat's sub-agents finish, start or move a chat on your always-on machine, and see which Claude account a chat runs on.
  - **To-do and Board:** to-dos linked to chats, which move on their own as the chats start and finish.
  - **Agents panel:** start any agent from `~/.claude/agents` in one click and watch the whole family of chats.
  - **Talk:** the Savvy voice agent on ElevenLabs. Speak to whichever harness chat you have open.
  - **Always-on machine:** right-click a chat and choose "Send to my always-on machine" (a home Mac, mini PC or VPS). The chat carries on there, a cloud on the row shows its status, and a panel shows its progress live. Add the same machine to bb and you can also start chats on it, or move a chat there and back, without leaving this sidebar.
  - **Home or away (optional):** if your files live on a NAS, new chats start on the share at home and on a local copy when you're away.
  - **The NavAIgate theme**, chat charts and link cards.
- **Kanban** (`plugins/kanban`): a board where every card is a chat. Agents move their own cards from Backlog to In progress, Review and Done.

## Install

You need bb installed (0.45 or later, on macOS or Linux), open, and signed in to at least one harness (Claude Code, Codex or Cursor). Then run one command in a terminal:

```sh
curl -fsSL https://raw.githubusercontent.com/skyremote/bb-overlay/main/install.sh | bash
```

It installs everything BB Overlay uses, in one go: the workspace and Kanban plugins from this repository, the two companion plugins from their own repositories (Projects & Sections for folders, and Agent Board), and bb's built-in Tasks. Then it turns on the NavAIgate theme and the NavAIgate rail as the sidebar list, reloads, and prints a checklist. Reload bb, open **Home** and walk through Set up.

**Read it first.** It's a good habit to read a script before you pipe it into a shell: [install.sh](install.sh). To see every command it would run without changing anything:

```sh
curl -fsSL https://raw.githubusercontent.com/skyremote/bb-overlay/main/install.sh | bash -s -- --dry-run
```

Safe to run again: it updates what's already there within its own pin, never removes or downgrades anything without asking, and leaves alone any plugin you installed from somewhere else. The one thing it asks about is Projects & Sections at 0.6.20 or later: it offers to switch you to 0.6.19 and keeps your folders (`--pin-folders` switches without asking). If a different NavAIgate rail is already your sidebar list, it leaves your theme and rail as they are; `--no-look` skips that step altogether. There is no Windows version, because bb runs on macOS and Linux.

**Prefer a bb chat?** Paste: "Run the BB Overlay installer: `curl -fsSL https://raw.githubusercontent.com/skyremote/bb-overlay/main/install.sh | bash`. Then open Home and walk me through Set up."

### Install by hand

```sh
bb plugin install git:https://github.com/skyremote/bb-overlay.git@main --plugin workspace
bb plugin install git:https://github.com/skyremote/bb-overlay.git@main --plugin kanban
bb plugin install git:https://github.com/VKirill/bb-plugin-project-folders.git@v0.6.19
bb plugin install git:https://github.com/aaronphifer/bb-plugin-agent-board.git@semver:^0.6.1
bb plugin install tasks
```

Projects & Sections is pinned to 0.6.19, the last release that runs on standard bb. Later releases need VKirill's own build of bb. Why, and when the pin comes off: [MAINTAINERS.md](MAINTAINERS.md).

Then pick the look in bb: **Settings, Appearance**. Choose the NavAIgate theme and the NavAIgate rail as the thread list. (On bb 0.44 and 0.45 there is also a NavAIgate sidebar header; bb 0.46 removed that option.)

Not technical? Follow the step-by-step guide in [INSTALL.md](INSTALL.md).

## Set up (first run)

Open **Home**. Until you finish setting up, Home shows the Set up wizard. You can reopen it any time from **Set up** in the sidebar, or with **Workspace: set up** in the command palette.

1. **You:** your first name, used in greetings and by your agents.
2. **Your work:** two to five areas of your work and life, each with a one-line description. Jev uses them to tag email and route requests.
3. **Your tools:** your own API keys. Every one is optional, and each has a Test button:

   | Key | Powers | Get it |
   | --- | --- | --- |
   | Composio | Inbox, Calendar, Hand to agent. Connect Gmail and Google Calendar in Composio first | [platform.composio.dev](https://platform.composio.dev) |
   | Jev (TypeSafe) | Inbox sorting, Ask box routing | [typesafe.ai](https://typesafe.ai) |
   | ElevenLabs | Talk (voice agent) | [elevenlabs.io](https://elevenlabs.io/app/settings/api-keys) |
   | Calendly | Booking links on Calendar | [calendly.com](https://calendly.com/integrations/api_webhooks) |
   | Blotato | Social and Audience on Home | [blotato.com](https://my.blotato.com/settings) |

4. **Always-on machine** (optional): its SSH host, and optional storage at home.

Everything is saved on your computer only, in `~/.config/navaigate-workspace/` (`profile.json`, and `keys.env`, readable only by you). Nothing is sent to NavAIgate.

## The always-on machine

Any machine that stays on and that you can reach over SSH with a key: a Mac at home, a mini PC, or a VPS.

1. On that machine, install bb, sign in to the harnesses you use, and install these same plugins.
2. Run `bb connect` there once, so you get a `getbb.app` link to watch its chats from your laptop or phone.
3. Make sure `ssh <host> true` works from your laptop without a password prompt. Tailscale makes this easy from anywhere.
4. Enter the host in Set up and press **Test SSH**.

Then right-click any chat and choose **Send to my always-on machine**. The plugin writes a hand-off brief from the conversation, copies over any laptop-only files the chat mentions, and starts the chat there. Your agents can drive it too, through the bundled `always-on` skill: `always-on send`, `list`, `show`, `tell` and `pull`, plus `fetch`, `push` and `put` when you've set up storage at home.

**Run on it from this bb (optional).** In bb, open **Settings, Machines** and add the always-on machine with the same name you gave it in Set up. Two chips then appear under the chat box:

- **Run on** *your machine* on the new-chat screen: the next chat runs on that machine, in the project's folder there, but stays in your sidebar. If the project has no folder there yet, the chip offers to add one at the matching path (your home folder maps to its home folder; storage at home is the same path on both).
- **Move to** *your machine* in a chat: stops the chat here, pushes the current git branch (uncommitted changes only if you agree, on a separate `teleport/<chat>` branch, so your own branch and files don't move), starts the chat again there from a brief of the conversation, and archives this one so you can restore it. **Bring it back** does the reverse. bb cannot copy a chat between machines, so the new chat starts from the brief, not the full history.

This computer has to stay awake while you do this, because it is the bb server the other machine reports to.

## Requirements and costs

- bb 0.44 or later, including bb 0.46, on macOS. The always-on machine can be macOS or Linux. Linux as the main computer is not tested yet, but 1.1.0 removes the macOS-only assumptions we knew about.
- Your own subscriptions: Claude Code, Codex or Cursor for the harnesses, plus any of the services above you choose to connect. Each one bills you directly.

## Companion plugins

The installer adds two plugins made by other people. They are not part of BB Overlay and not ours: both are MIT-licensed, and they install from their own repositories, so they keep their own updates and their own licences.

| Plugin | Author | Licence | What it adds here |
| --- | --- | --- | --- |
| [Projects & Sections](https://github.com/VKirill/bb-plugin-project-folders) (`project-folders`) | VKirill | MIT | Real folders in the rail, folders inside folders, and "Move to folder" |
| [Agent Board](https://github.com/aaronphifer/bb-plugin-agent-board) (`agent-board`) | aaronphifer | MIT | A live board of every agent and sub-agent in a chat tree |

It also uses two plugins built into bb: **Tasks** (To-do and the Board; bb ships it but it's opt-in, so the installer adds it) and, if you use it, **Account Pooler** (per-account usage in the dock and the Claude account chip; add your accounts with `bb pool`).

If a companion is missing, the rest still works. Its feature shows greyed out with the line that installs it, for example "Move to folder" says "Install project-folders to use folders", and the last step of Set up lists every companion as installed or missing, with a Copy button for its install line.

## What's new in 1.4.0

- Each chat in the rail now has two lines: its title, then the model and effort it runs on ("Opus · High", or "Codex · GPT-6.1 Sol · High" for other harnesses), how many of its sub-agents have finished ("2/7") and its git branch as a small chip (hidden outside a git repo).
- The mark on the left says what a chat needs: a green tick when it finished and you have not read it, a gold question mark when it waits for an answer, a red mark on an error, a pause mark while a message is queued, and your come-back-later flag. A gold spinner on the right shows it is working.
- Each project has its own colour, a dot on its heading and a bar down its chats. Right-click the heading and choose **Colour** to change it. A **New chat** row sits at the top of the list.
- Prefer the old look? Right-click the rail or a project heading and choose **Compact rows** for one line per chat with the harness and time.
- The harness filter shows each harness as its logo and count, with the name in a tooltip, so nothing is cut short in a narrow sidebar.
- Works on bb 0.46.1: the Navigate row no longer needs a hook bb removed.

## What's new in 1.3.0

- The top of the sidebar takes far less room. bb's navigation (New thread, Search threads, Board, Automations, plugin pages, More) now sits under a **Navigate** row: click it, or press **⌘⇧B**, to fold the list to that one line, and the NOW card, filters and sections move up. It remembers your choice. Right-click the row for **Hide navigation entirely**, and right-click the rail for **Show navigation** to bring it back. The rows are still bb's own, so clicks, the "…" menus, More and reordering work as before.
- Tags are one **Tags** button beside Select, showing "Tags · 2" while a filter is on. It opens a dropdown with every tag, its colour and how many chats carry it. Tick several to see chats with any of them; **Clear**, **New tag…** and **Manage tags** (rename, recolour, delete) are in the same menu. While a filter is on, the active tags show as small chips you can remove.
- The harness filter (All, Claude, Codex, Cursor) is one compact row, with the active one in gold.

## What's new in 1.2.3

- The installer now checks the Projects & Sections you already have. If it's 0.6.20 or later, or it follows a version range (so bb keeps offering 0.6.20 and later as updates), it warns and offers to switch you to 0.6.19, pinned. Your folders are kept, because bb keeps a plugin's data when it is removed. Say yes when it asks, or run it with `--pin-folders` to switch without asking.
- `--help` now works when you run the script from a file, and the checklist lines up.
- [MAINTAINERS.md](MAINTAINERS.md) explains why Projects & Sections is pinned, when to lift the pin, and how to test the installer on a throwaway bb.

## What's new in 1.2.2

- Folders install on standard bb. From 0.6.20 on, Projects & Sections needs VKirill's own build of bb, so the old `^0.6.0` line found nothing it could install. The installer now installs 0.6.19, the last release that runs on standard bb, pinned, and never updates a copy you already have; the install line behind the greyed-out "Move to folder" and the Set up check is pinned to it.
- The installer now updates a workspace and Kanban you installed from the other NavAIgate edition (BB Overlay or the members' edition). Before, it kept them on their old version.
- Set up now has a Companions check on its last step: Projects & Sections, Agent Board, Kanban and Tasks, each shown as installed, turned off or missing, with the line that installs it and a Copy button, plus the one command that installs everything.

## What's new in 1.2.0

- One command now installs everything, including folders and the agent board. `install.sh` installs the workspace, Kanban, Projects & Sections, Agent Board and bb's Tasks, turns on the NavAIgate theme and rail, and prints a checklist. It's safe to run again and never removes anything.
- "Move to folder" no longer disappears when Projects & Sections isn't installed: it shows greyed out with "Install project-folders to use folders", and clicking it copies the install line.

## What's new in 1.1.1

- The licence now welcomes contributions: a public fork is allowed for sending pull requests back here, and [CONTRIBUTING.md](CONTRIBUTING.md) has the terms. It also covers your team: your employees and contractors can use your copy for your organisation's work. Nothing changes in the plugins themselves.

## What's new in 1.1.0

- Runs on bb 0.46. bb 0.46 removed the sidebar-header slot, which left the whole workspace blank on a fresh install of 1.0.1. The NavAIgate sidebar mark now only appears on bb versions that still have that slot.
- Set up saves with any number of keys, from none to all five. Before, entering fewer than five keys failed and lost your name and areas too.
- A tab strip of the chats you have open, with a hover preview (title, state, harness and last activity) and drag to reorder.
- Guide lines in the rail, folders inside folders, and groups that hold whole projects (and other groups), with drag and drop and right-click.
- "Send when sub-agents finish": a message waits until the chat's sub-agents are done, then sends itself. It survives a reload.
- The Claude account chip: which pooled account a chat runs on, the weekly and session use of each, and the failover order.
- Run on and Move to your always-on machine, when it is also a machine of this bb.
- Every chat the plugin starts (Home, Inbox, Calendar, Social, Agents) runs in Full access.
- Background jobs stop at once when the plugin reloads (also in 1.0.1).
- Linux fixes: the Audience cards find Chrome, Chromium, Brave or Edge on Linux (or the browser named in `NAVAIGATE_BROWSER`), the plugin keeps your own PATH so it can find `bb` and `ssh`, and the storage mount path no longer defaults to a macOS-only `/Volumes/`.

## Updating

Run the installer again; it updates everything it installed. Or one at a time:

```sh
bb plugin update navaigate-workspace
bb plugin update kanban
```

---

Made by [NavAIgate](https://navaigate.dev). "NavAIgate" and the NavAIgate logo are trademarks of NavAIgate GmbH & Co. KG and are not licensed for any other use. See [NOTICE](NOTICE).
