# NavMotion Studio

The bb dashboard for the `navmotion` skill: motion films, Shorts, long-form inserts and deck graphics drawn frame by
frame in JavaScript canvas. Every project shows its stages, storyboard stills, layout check, live render progress,
covers and finished files, and Approve or Request changes goes straight to the agent working on it.

The Studio does no rendering itself. It needs the navmotion skill, which is not part of this repository: it is
NavAIgate's internal production skill. Without it the Studio installs and runs, but the Projects page is empty and
the Guide tab tells you the skill is missing.

## What you get
- **NavMotion** in the navigation rail:
  - **Projects:** a card per project with a thumbnail (its cover when it has one), the current stage, a progress bar
    while it renders and an "Awaiting you" badge.
  - **Project page:** the stages, stills with and without layout guides, the layout check, the metrics, the
    storyboard, covers at 9:16, 3:4 and 4:5, the finished video with a player that seeks, notes and the decision
    history, and Approve or Request changes when the agent is waiting for you.
  - **New:** pick a deck graphic, a Short, a Short with your footage, a long-form video or a landscape film, write a
    brief, and it starts an agent thread that stops at the storyboard for you.
  - **Guide:** how to choose, how long each takes and how to judge a storyboard (from the skill's `GUIDE.md`).
- **NavMotion** in a thread's right panel: the project that thread is working on.

## Settings (`bb plugin config navmotion`)
| key | default | use |
|---|---|---|
| `projectsRoot` | `~/NavMotion/projects` | where project folders live (local disk; renders write thousands of frames) |
| `skillPath` | `~/Documents/GitHub/navmotion/skills/navmotion` | the navmotion skill: the Studio runs `scripts/nm.py` and shows `references/GUIDE.md` |
| `bbProjectId` | none | the bb project new threads start in (required for New) |
| `reviewerName` | `The user` | how you are named in the messages sent to the agent |

## How it works
- The Studio and the skill talk only through files in each project folder (`navmotion.json`, `status.json`,
  `feedback.jsonl`). The skill's `nm.py` writes the status after every stage; the Studio checks each project once a
  second and updates open pages.
- Approve or Request changes appends one line to the project's `feedback.jsonl`, then sends a message starting
  "NavMotion Studio:" to the project's thread. The buttons lock until the agent has picked the decision up, so a
  double click never sends twice.
- Stills, covers and the storyboard load through bb's own file-preview links, limited to the project folder. Videos
  play from the plugin's local `/media` route, which supports seeking and never changes address, so a playing video
  never restarts. Every path is checked, with symlinks followed, and refused if it leaves the project folder.

## Develop
```
npm install
python3 fixtures/make_fixtures.py               # sample projects (gitignored output)
bb plugin config navmotion set projectsRoot "$PWD/fixtures"
bb plugin build && bb plugin reload navmotion
bb plugin config navmotion unset projectsRoot   # back to the default
npm test                                         # vitest: library, backend (fake host), panel harness
```
