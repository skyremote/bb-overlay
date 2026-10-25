// bb-plugin-navmotion-skin: the NavMotion look for bb, plus Markdown in the chat box.
//
//   Skins          bb.themes (package.json)          NavMotion Dots, Live and Tunnel palettes
//   Motion layer   experimental_appOverlay           moving grounds, click ripples, focus pull
//   Skin button    experimental_sidebarFooter        every skin one click away
//   Markdown       composer.customize + tabs         live formatting in the chat box, a side preview
//
// The motion layer only runs while a NavMotion skin is chosen. Pick any other skin and the
// layer removes everything it added.
import "./app.css";
import { definePluginApp } from "@get-bb/plugin-sdk/app";
import { MotionLayer } from "./src/motion-layer";
import { SkinMenu } from "./src/skin-menu";
import { MARKDOWN_EFFECTS, PLUS_MENU, PreviewAction, PreviewPanel, NewThreadPreviewPanel, PREVIEW_TAB_ID, PREVIEW_NEW_ID } from "./src/markdown";

export default definePluginApp((app) => {
  app.slots.experimental_appOverlay({ id: "motion-layer", component: MotionLayer });

  app.experimental_sidebarFooter.register({
    kind: "disclosure",
    id: "skin",
    label: "Skin",
    icon: "Palette",
    component: SkinMenu,
  });

  app.composer.customize({
    id: "markdown",
    actions: [{ id: "preview", component: PreviewAction }],
    plusMenu: PLUS_MENU,
    richText: { effects: MARKDOWN_EFFECTS },
  });

  app.slots.experimental_tab({
    context: { kind: "thread" },
    availability: "action",
    id: PREVIEW_TAB_ID,
    title: "Preview",
    icon: "Eye",
    layout: "flush",
    component: PreviewPanel,
  });

  app.slots.experimental_newThreadPanelAction({
    id: PREVIEW_NEW_ID,
    title: "Preview",
    icon: "Eye",
    layout: "flush",
    component: NewThreadPreviewPanel,
  });
});
