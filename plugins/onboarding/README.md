# BB Overlay guide

A separate BB plugin that points to real Simple or existing Pro controls. It does
not replace, rearrange or restyle Pro. BB 0.48 and Plugin SDK 0.6.94 or later.

Install from the multi-plugin repository with `--plugin onboarding`. Plugin ID:
`bb-overlay-guide`. Settings: `edition` (`simple` or `pro`, default `pro`),
`autoStart` (default `false`) and `guideVersion` (default `1`). Set edition first,
then autoStart at the end of installation. The offer is durable and once per
edition/version, even if autoStart remains true on later installer runs.

Open or replay in the plugin’s **BB Overlay guide** settings section or the matching
app commands. Frontend integrations may dispatch `bb-overlay-guide:open` and
`bb-overlay-guide:replay` window CustomEvents. An open event with
`detail: { replay: true }` is also supported.

Progress lives in the plugin’s namespaced BB storage, separately by edition and
guide version. Each step needs an explicit checked acknowledgement before Next.
Back retains checks; partial close resumes; replay resets current-run checks and
retains completion history. Missing controls are never replaced with a guessed
target, and their unavailable status is retained with the acknowledgement.

Targets are narrow current BB attributes and existing plugin controls. Simple adds
`data-bb-overlay-tour` markers. Native BB selectors were checked in BB 0.48 installed
source; public/private Pro controls were checked in the existing skin and mod
sources. No native/core/plugin source is modified. The guide measures, scrolls,
waits and tracks resize/scroll/layout changes; it never clicks a target or enables
an account, provider, plugin or feature.

`npm test`, `npm run check`, `bb plugin build` verify policy, UI and contracts.
`npm run fixture` builds an isolated static host fixture for browser testing.
That fixture uses the production guide UI and policy, anchored to explicitly
labelled fixture regions. It is not evidence of a real BB install. Production BB
acceptance must separately confirm the live selectors and both editions.
