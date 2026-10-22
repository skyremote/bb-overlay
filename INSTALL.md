# Install BB Overlay, step by step

About 15 minutes. No coding needed: bb's agent does the technical part for you.

## Before you start

- A Mac or a Linux computer with **bb** 0.45 or later installed ([getbb.app](https://getbb.app)).
- At least one AI harness signed in inside bb: Claude Code, Codex or Cursor.
- Optional, for the full experience: accounts with **Composio** (email and calendar), **TypeSafe** (Jev, the inbox sorter), **ElevenLabs** (voice), **Calendly** and **Blotato**. You can add these later.

## 1. Install everything with one command

1. Open bb and leave it open.
2. Open a terminal (on a Mac: press Cmd-Space, type **Terminal**, press Return).
3. Paste this line and press Return:

   ```sh
   curl -fsSL https://raw.githubusercontent.com/skyremote/bb-overlay/main/install.sh | bash
   ```

4. Wait for the checklist at the end. It installs the workspace, the Kanban board, the four mods (Helper Desk, Cache Clock, Reflect and Screen Share, on bb 0.46 or later), folders (Projects & Sections), the Agent Board and bb's Tasks, and turns on the NavAIgate theme and rail. Don't want the mods? Add `-s -- --no-mods` after `bash`, or switch any one off later with `bb plugin disable <id>`.
5. Reload bb with **Cmd-R** (Ctrl-R on Linux).

**Read it first.** You can read the script before running it: [install.sh](install.sh). To see what it would do without changing anything, add `-s -- --dry-run` after `bash`. It's safe to run again any time to update everything, and it never removes anything.

**Rather not use a terminal?** Open a chat in bb and send: "Run the BB Overlay installer: `curl -fsSL https://raw.githubusercontent.com/skyremote/bb-overlay/main/install.sh | bash`. Then open Home and walk me through Set up." Approve the command when bb asks.

### Install by hand

If you'd rather install one plugin at a time, run these in a terminal or a bb chat, approving each one:

```sh
bb plugin install git:https://github.com/skyremote/bb-overlay.git@main --plugin workspace
bb plugin install git:https://github.com/skyremote/bb-overlay.git@main --plugin kanban
bb plugin install git:https://github.com/skyremote/bb-overlay.git@main --plugin helper-desk
bb plugin install git:https://github.com/skyremote/bb-overlay.git@main --plugin cache-clock
bb plugin install git:https://github.com/skyremote/bb-overlay.git@main --plugin reflect
bb plugin install git:https://github.com/skyremote/bb-overlay.git@main --plugin screen-share
bb plugin install git:https://github.com/VKirill/bb-plugin-project-folders.git@v0.6.19
bb plugin install git:https://github.com/aaronphifer/bb-plugin-agent-board.git@semver:^0.6.1
bb plugin install tasks
```

Projects & Sections (by VKirill) and Agent Board (by aaronphifer) are free MIT plugins made by other people, not part of BB Overlay. Skip Projects & Sections and "Move to folder" shows greyed out until you install it. Its line is pinned to 0.6.19, the last release that runs on standard bb. Later releases need VKirill's own build of bb.

**Got the zip instead?** Unzip it somewhere permanent (for example your Documents folder; bb runs the plugins from there, so don't delete it). Then in a bb chat say: "In the folder `<drag the unzipped folder here>`, run `npm ci` inside `plugins/workspace` and `plugins/kanban`, then install both with `bb plugin install path:<that folder> --plugin workspace` and `--plugin kanban`." Then install the companions with the last three lines above.

## 2. Check the look

The installer turns these on for you. If it said "by hand", or you skipped it, open **Settings, then Appearance** in bb:

- **Theme:** NavAIgate
- **Thread list:** NavAIgate rail
- **Sidebar header:** NavAIgate (only on bb 0.44 and 0.45; bb 0.46 removed this option, so skip it there)

## 3. Set up your workspace

Click **Home** in the sidebar. The Set up wizard opens.

1. **You:** type your first name.
2. **Your work:** name two to five areas of your work and life, and describe each in a line. For example, "Agency: client projects, proposals and invoices" or "Community: my Skool group, members and events".
3. **Your tools:** for each service you use, click **Get a key**, copy your key, paste it in, and press **Test**. Skip any you don't use; that part of Home just stays empty.
   - **Composio:** after creating your account, connect **Gmail** and **Google Calendar** inside Composio first, then copy the API key.
4. **Always-on machine:** skip this for now unless you already have a home Mac or VPS you can reach over SSH. See the README when you're ready, including how to add it to bb so you can start and move chats there.
5. Press **Save and open Home**.

Your name and keys are saved only on your Mac, in a hidden folder called `.config/navaigate-workspace` in your home folder. Nothing is sent to NavAIgate.

## 4. Try it

- **Home:** type a request in the Ask box. Leave it on **Auto** and Jev picks the best harness.
- **Inbox:** press **Sort with Jev**, then open an email and press **Hand to agent** for a draft reply. It never sends without you.
- **Any chat:** right-click it in the sidebar to tag it, move it to a folder, or mark it "Come back later".
- **Talk:** press **Talk** at the top of a chat and speak.
- **Kanban:** open **Kanban** in the sidebar to see every chat as a card.
- **Tabs:** every chat you open gets a tab at the top. Hover for a preview, drag to reorder.
- **Sub-agents:** while a chat has sub-agents working, type a message and press **Send when sub-agents finish** under the chat box.

## If something isn't working

- **A Home card says to add a key:** open **Set up** in the sidebar and add or test that key.
- **The inbox is empty:** check that Gmail is connected in Composio, then press **Test** next to Composio in Set up. It tells you how many Gmail accounts it found.
- **Home is blank on bb 0.46:** run the installer again to update, then reload with Cmd-R.
- **"Move to folder" is greyed out:** Projects & Sections isn't installed. Click it to copy the install line, or run the installer again.
- **Projects & Sections says "no release matching ^0.6.0 runs on this bb":** that's the old install line. Use the 0.6.19 line above, or run the installer again.
- **Folders stopped working after bb updated Projects & Sections, or bb offers it an update past 0.6.19:** run the installer again and say yes when it offers to switch you to 0.6.19. Your folders are kept.
- **Anything else:** ask in a bb chat: "NavAIgate Workspace isn't showing X, can you check the plugin?" The agent can read the plugin's logs.

## The rules, in plain words

Free for you and your own business, and your employees and contractors can use your copy for your work too. Change it for yourself. Don't sell it, share copies of it, or put it in a course or community. Keep the NavAIgate name and logo. Want to help? Fork it only to send a pull request back; the terms are in [CONTRIBUTING.md](CONTRIBUTING.md). The full terms are in [LICENSE](LICENSE) and [NOTICE](NOTICE).
