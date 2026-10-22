---
name: screen-share
description: Turn bb's screen-share mode on or off, or check it, with the `bb screen-share` CLI. Use when the user is about to share their screen, record a video or demo a chat on a call and wants names, emails, phone numbers and amounts hidden, or when they type "/screenshare".
---

# Screen-share mode

When on, every bb window and remote client (desktop, phone) paints a grey bar over
person names, email addresses, phone numbers, money amounts, IBANs and VAT or tax
numbers. The underlying text is not changed, and the agent still reads the real data.
Company names stay readable unless "Hide company names" is on in the plugin settings.

| Command | Effect |
| --- | --- |
| `bb screen-share on` | Turn the mode on everywhere. |
| `bb screen-share off` | Turn it off everywhere. |
| `bb screen-share status [--json]` | Report whether it is on. |

The user can also type `/screenshare` (or `/screenshare on|off`) as a message: bb toggles
the mode and does not send that message to the agent. Other switches: the banner's
Turn off button, the composer's + menu row "Screen-share mode", and the palette command
"Screen-share mode: turn on or off" (default shortcut Cmd+Alt+S).

Constraints: masking is visual only, so screenshots and screen shares are covered but
copy and paste still yields the real text. Text inside the composer and other editors is
never masked, so the user can still type. Extra people to always hide go in the plugin
setting "Always hide these people".
