export type Edition = "simple" | "pro";
export interface GuideStep {
  id: string;
  title: string;
  body: string;
  tip: string;
  selectors: readonly string[];
  unavailable: string;
  side: "right" | "left" | "top" | "bottom";
}
const mark = (name: string) => `[data-bb-overlay-tour="${name}"]`;
const rail: GuideStep = {
  id: "navigation", title: "Find your way around",
  body: "The thin navigation rail opens BB’s main destinations. Your chat list sits beside it. More keeps the other pages within reach.",
  tip: "This guide points things out. It never clicks a control or changes your workspace for you.",
  selectors: [mark("navigation"), '[data-testid="app-nav-rail"]', '[data-testid="sidebar-navigation-list"]'],
  unavailable: "Navigation is not visible in this layout. On a small screen it may sit inside the sidebar. Close the guide, open the sidebar and resume when you want to see it.", side: "right",
};
const chats: GuideStep = {
  id: "chats", title: "Continue the right conversation",
  body: "Choose a chat from this list to continue its work. Titles and status help you spot a finished result or an agent that needs your answer.",
  tip: "Opening a different chat does not remove the one you are working in.",
  selectors: [mark("chats"), '[data-testid="nav-rail-sidebar-body"]', '[data-testid="app-sidebar-body"]'],
  unavailable: "The chat list is hidden here. Open the sidebar or return from Settings to your workspace, then use Try again. Your position in the guide is saved.", side: "right",
};
const newChat: GuideStep = {
  id: "new-chat", title: "Start a separate piece of work",
  body: "New chat starts another conversation. Check its project and model before sending, so the agent begins in the right place.",
  tip: "You decide when to create a chat and when to send its first message.",
  selectors: [mark("new-chat"), '[data-sidebar="sidebar"] button[title^="New chat"]', '[data-sidebar-navigation-item="__bb__/new-thread"]', '[data-testid="app-nav-rail"] button[aria-label^="New thread"]', '[data-testid="sidebar-header-slot"] button[aria-label^="New thread"]'],
  unavailable: "New chat is not visible on this screen. Return to your normal workspace or open the sidebar, then try again. No chat has been created.", side: "right",
};
const composer: GuideStep = {
  id: "composer", title: "Give the agent a clear next step",
  body: "Write your request in the composer. The controls here choose the model and available reasoning settings, and let you attach relevant context.",
  tip: "Nothing in this tour sends a message, changes a model or connects an account.",
  selectors: [mark("composer"), '[data-promptbox]', '[data-composer-box]'],
  unavailable: "A composer is not currently visible. Open an existing chat or a new-chat screen to see it. You can read this explanation and return to the control later.", side: "top",
};
const helper: GuideStep = {
  id: "helper-desk", title: "Check what your agents are doing",
  body: "Helper Desk shows the lead agent and delegated work. Its details and history help you see what finished, what is still running and what needs you.",
  tip: "A quiet chat may have no active helpers. The guide does not start an agent or open a panel automatically.",
  selectors: [mark("helper-desk"), 'button.hd-header-button', 'button[aria-label^="Open Helper Desk"]', '.hd-taskbar', '[data-nav-rail-item="helper-desk/agents"]', '[data-sidebar-navigation-item="helper-desk/agents"]'],
  unavailable: "Helper Desk is not visible. It may be disabled, absent, or tucked into the thread menu on a narrow screen. Open a chat and its menu to find it; this guide will not enable it for you.", side: "bottom",
};
const cache: GuideStep = {
  id: "cache-clock", title: "Understand the cache estimate",
  body: "Cache Clock estimates when a recent Claude conversation’s cache may expire. Keep warm is an explicit choice; Hand off lets you review a brief before continuing in another chat.",
  tip: "This estimate is not a provider guarantee. No keep-warm ping or hand-off is started by this guide.",
  selectors: [mark("cache-clock"), 'section.cc-bar[aria-label="Cache clock"]', '[data-nav-rail-item="cache-clock/cache"]', '[data-sidebar-navigation-item="cache-clock/cache"]'],
  unavailable: "Cache Clock only appears where the plugin and the current Claude chat support it. It may be absent in another model’s chat, before a reply, or when the bar is hidden. Nothing needs enabling to finish reading this step.", side: "top",
};
const reflect: GuideStep = {
  id: "reflect", title: "Keep a lasting correction",
  body: "When you give a lasting instruction, Reflect can offer to save it as a rule. Read the exact wording and destination before you choose Save; you can skip it instead.",
  tip: "The tour never invents a correction or saves a rule on your behalf.",
  selectors: [mark("reflect"), '.rf-card[aria-label="Reflect: save a lasting rule"]', '.rf-panel'],
  unavailable: "Reflect stays quiet until a lasting correction is detected, so there may be no card in this chat. Its panel shows saved rules and destinations. No example message or rule has been created to force a target.", side: "top",
};
const sideChat: GuideStep = {
  id: "side-chat", title: "Ask a related question alongside the work",
  body: "BB’s native Side Chat opens a related conversation beside the main one. Use Start side chat from the panel actions, or Reply in side chat on a message you want to discuss.",
  tip: "A side chat is a BB capability in both editions. The guide never creates one or sends its first message.",
  selectors: [mark("side-chat"), 'button[aria-label="Start side chat"]', 'button[title="Start side chat"]', 'button[aria-label="Reply in side chat"]', 'button[title="Reply in side chat"]', 'button[aria-label="Start Side Chat"]'],
  unavailable: "Side Chat is contextual. Its action may be inside a message menu or the panel’s add menu, and an empty chat has no message to reply to. Open the relevant menu yourself when you need it; the guide does not generate a message or create a side chat.", side: "left",
};
const share: GuideStep = {
  id: "screen-share", title: "Check before sharing your screen",
  body: "Screen Share can mask supported names, email addresses, phone numbers and amounts in BB. Check its preview and on-screen status before a call or recording.",
  tip: "It does not protect another application or guarantee that every secret is hidden. You choose when to switch it on.",
  selectors: [mark("screen-share"), '.ssm-banner', '.ssm-switch', '[data-nav-rail-item="screen-share/screen-share"]', '[data-sidebar-navigation-item="screen-share/screen-share"]', 'button[aria-label="Screen-share mode"]', '[role="menuitem"][data-screen-share-action]'],
  unavailable: "Screen Share is not visible. Its controls can live in the composer’s + menu, a panel, a rail page or the command palette. The guide does not turn masking on; look for ‘Screen-share mode’ when you need it.", side: "bottom",
};
const settings: GuideStep = {
  id: "settings", title: "Make a change, or replay this guide",
  body: "BB’s Settings keeps appearance and installed-plugin controls together. The BB Overlay guide section lets you resume or replay this tour at any time.",
  tip: "Replay starts a fresh set of read checks. It keeps your previous completion history and does not reset your workspace.",
  selectors: [mark("features"), '[data-testid="sidebar-footer-body"] a[href="/settings"]', '[data-testid="sidebar-footer-body"] button[aria-label^="Settings"]', '[data-sidebar="sidebar"] a[href="/settings"]', 'button[aria-label^="Settings"]', 'a[href="/settings"]'],
  unavailable: "Settings is not visible on this screen. Close the guide and use BB’s normal Settings control or command palette. Search for ‘BB Overlay guide: open or resume’ to return.", side: "right",
};
const project: GuideStep = {
  id: "project", title: "Keep work in the right project",
  body: "This project control narrows the chats you see and gives new work its context. Choose the project that owns the files and the task.",
  tip: "The guide never switches projects or moves a chat.", selectors: [mark("project")],
  unavailable: "The Simple project control is not visible. Open the sidebar or return to your workspace, then try again.", side: "right",
};
const appearance: GuideStep = {
  id: "appearance", title: "Choose a comfortable appearance",
  body: "Appearance opens the host’s theme choices. You can choose the available light, dark and system options without changing your conversations.",
  tip: "The guide leaves your current theme exactly as it is.", selectors: [mark("appearance")],
  unavailable: "Appearance is not visible here. It is available through the Simple sidebar or BB’s Settings. Your current theme has not changed.", side: "right",
};
const tabs: GuideStep = {
  id: "tabs", title: "Move between your open chats",
  body: "Your existing Pro tab strip keeps open conversations close by. Selecting a tab returns to that chat; the chat list remains the place to find your other work.",
  tip: "This tour preserves your current Pro skin and every module. It does not rearrange or add tabs.",
  selectors: [mark("tabs"), '[data-nav-tabs] [aria-label="Open chats"]', '[data-nav-tabs]'],
  unavailable: "The Pro tab strip is not present on this screen. It may be hidden in your current skin or layout. The guide will not change that preference.", side: "bottom",
};
export const STEPS: Readonly<Record<Edition, readonly GuideStep[]>> = {
  simple: [project, chats, newChat, composer, helper, cache, reflect, sideChat, share, appearance, settings],
  pro: [rail, chats, newChat, tabs, composer, helper, cache, reflect, sideChat, share, settings],
};
export function stepIds(edition: Edition): string[] { return STEPS[edition].map(step => step.id); }
