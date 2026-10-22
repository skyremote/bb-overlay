# Screen Share

Part of [BB Overlay](../../README.md), by [NavAIgate](https://navaigate.dev).

Before you share your screen, record a video or demo a chat on a call, turn on screen-share mode. Every person name, email address, phone number, money amount, IBAN and VAT or tax number shown anywhere in bb turns into a grey bar: chats, tables, thread titles, tabs and panels. Company names stay readable unless you ask for them to be hidden too.

- **Turn it on:** type `/screenshare` as a message (it never reaches the agent), press Cmd+Alt+S, use the + menu row "Screen-share mode", or run `bb screen-share on`.
- **Turn it off:** the **Turn off** button on the strip above the chat box, `/screenshare off`, or `bb screen-share off`.
- **Every screen at once:** the switch lives on the bb server, so your laptop and your phone (through bb connect) mask together.

The text underneath never changes: the agent still reads the real data and copy and paste still gives the real text. The chat box and other editors are never masked, so you can keep typing. It errs on the side of hiding too much, for example any two capitalised words that look like a name.

Needs a browser with the CSS Custom Highlight API (current Chrome, Edge and Safari 17.2 or later). Older browsers show a warning on the strip.

## Settings

- `knownNames`: people to always hide, one per line (empty by default).
- `companies`: company names that are never treated as people (empty by default).
- `maskCompanies` (default `false`): hide company names too.
- `aggressiveNames` (default `true`): hide any capitalised word pair that looks like a name.

Example: `bb plugin config screen-share set knownNames "Maya Lopez, Sam Carter"`

Switch the whole mod off with `bb plugin disable screen-share`.
