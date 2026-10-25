# NavMotion Skin: overview

- `package.json` `bb.themes`: three palettes, generated from `themes/src/`.
- `app.tsx`: registers the motion layer (app overlay), the Skin button (sidebar footer
  disclosure), the Markdown composer customisation and the Preview tabs.
- `src/engine.ts`: grounds, ripples, blooms and particles; reads `--nm-skin` to know when to run.
- `server.ts`: logs that the plugin loaded. No storage, no settings, no network.
