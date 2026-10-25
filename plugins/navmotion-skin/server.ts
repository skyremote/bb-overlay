// bb-plugin-navmotion-skin: backend entry.
//
// Everything this plugin does runs in the app: three palettes (bb.themes in package.json),
// the motion layer, the Skin button and the Markdown chat box (app.tsx). The server only
// logs that the plugin loaded.
import type { BbPluginApi } from "@get-bb/plugin-sdk";

export default async function plugin(bb: BbPluginApi) {
  bb.log.info("loaded: NavMotion skins (Dots, Live, Tunnel), Skin button, Markdown chat box");
}
