# NavAIgate Simple

A lean BB sidebar with real projects, recent chats, filtering and native thread actions. It keeps BB's own conversation, composer, file preview, terminal, model controls, Start Side Chat and split layout.

- Plugin: `navaigate-simple` (installer selector: `--plugin simple`).
- Thread list: `navaigate-simple/rail`.
- Selectable theme: `plugin:navaigate-simple:navaigate`, with host-controlled light/dark/system mode.
- Navigation: BB's `navigation/rail`; this plugin does not register a navigation replacement or select itself.
- Requires BB 0.48 or later. Development types are pinned to SDK 0.6.94.

Features reads the actual state of Helper Desk, Cache Clock, Reflect and Screen Share through BB's public API. Installed, running or disabled states are distinct. Switches operate the real installed plugins; missing tools have no simulated controls. Guide/help opens the separate `bb-overlay-guide` plugin; Replay is deliberately separate in Settings.

No schedules, polling service, external connections, agent spawning, tabs overlay, machine integration or Pro-module imports. BB 0.48 requires a server entry, so the package includes an empty factory that registers no behaviour. The existing Workspace/private skin is unchanged. Switching the selected thread list does not delete chats, sections, folders, tasks or plugin data. Third-party nested folder layouts remain owned by their companion; this minimal list shows the real chats without requiring it.

The list windows long datasets, filters hidden/internal and archived chats and keeps native menus and drag-to-split. Phone drawer ownership remains with BB; successful project/chat/new-chat navigation calls the SDK's `onNavigate` callback.

## Develop

Install dev dependencies, run `npm run check`, `npm test`, then build in a local scratch copy with `bb plugin build`. Live integration acceptance belongs to the release process; unit fixtures cannot prove host routing, mobile drawer reconciliation or multi-plugin arbitration.

Tour targets: `[data-bb-overlay-tour="project"]`, `chats`, `new-chat`, `features`, `appearance`. Help dispatches `bb-overlay-guide:open`; explicit Replay dispatches `bb-overlay-guide:replay`.
