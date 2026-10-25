---
name: navmotion-studio
description: How NavMotion Studio, the bb dashboard for the navmotion motion-film skill, shows projects and passes the user's decisions to the agent. Use when the user asks where a NavMotion project is, why the Studio is empty, how Approve and Request changes reach a thread, or how to set the Studio up.
---

# NavMotion Studio

NavMotion Studio is the dashboard for the `navmotion` skill (motion films, Shorts, long-form inserts and deck
graphics drawn in JavaScript canvas). The Studio does no rendering itself: it shows the project folders the skill
writes and sends the user's decisions back to the agent working on them.

## Setup
- The navmotion skill must be installed. Without it the Projects page is empty and the Guide tab says so.
- Settings (`bb plugin config navmotion`):
  - `projectsRoot`: where project folders live, default `~/NavMotion/projects`;
  - `skillPath`: the navmotion skill folder (the Studio runs `scripts/nm.py` and shows `references/GUIDE.md`);
  - `bbProjectId`: the bb project that new threads start in (required for New);
  - `reviewerName`: how the user is named in messages to the agent, default "The user".

## For agents working on a NavMotion project
- Run every stage through the skill's `nm.py`, so `status.json` stays current and the Studio shows it.
- At an approval, run `nm.py await <slug> storyboard|covers|final`, tell the user, and end the turn.
- A Studio decision arrives in the thread as a message starting "NavMotion Studio:". Run `nm.py feedback <slug>`
  before carrying on. Request changes means make them, rebuild, and await again.
