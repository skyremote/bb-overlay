// bb-plugin-navaigate-workspace — the NavAIgate platform look for bb.
//
//   Rail          experimental_threadList   run-sheet sidebar, real folders, harness marks, right-click
//   Control room  homepageSection           one strip across every harness
//   ::nav-chart   messageDirective          charts inside replies
//   Usage dock    experimental_appOverlay   context + plan limits under the chat box
//   Chips         experimental_appOverlay   hold for sub-agents, Run on / Move to your always-on machine, Claude account, under the chat box
//   Tabs          experimental_appOverlay   Chrome-style strip of open chats; dock via bb's split
//
// Styling follows the GPLS Slate system (NavAIgate-2.0 src/styles/gpls-*.css).
// Colours come only from host tokens; the bundled NavAIgate theme drives them.
import { definePluginApp } from "@get-bb/plugin-sdk/app";
import { Rail } from "./src/rail";
import { ControlRoom } from "./src/control-room";
import { NavChart } from "./src/chart";
import { UsageDock } from "./src/usage-dock";
import { ComposerChips } from "./src/composer-chips";
import { ComposerBridge } from "./src/composer-bridge";
import { TabStrip } from "./src/tabs";
import { NavLinks, NavPipeline } from "./src/directives";
import { AgentsPanel } from "./src/agents";
import { Boundary } from "./src/boundary";
import { CalendarPage } from "./src/calendar";
import { DashboardPage } from "./src/dashboard";
import { MachineHeaderButton, MachinePanel } from "./src/machine";
import { HomePage } from "./src/home";
import { SetupWizard } from "./src/onboarding";
import { NewThreadHero } from "./src/new-thread-hero";
import { InboxPage } from "./src/inbox-page";
import { HeaderMark } from "./src/header-mark";
import { toggleMode } from "./src/mode-toggle";
import { TodoBoard, TodoHeaderButton, TodoPanel } from "./src/todo";
import { VoiceEngine, VoiceHeaderButton, VoicePanel, voice } from "./src/voice";

const goTo = (path: string) => {
  window.history.pushState({}, "", path);
  window.dispatchEvent(new PopStateEvent("popstate", { state: {} }));
};

export default definePluginApp((app) => {
  app.slots.experimental_threadList({
    id: "rail",
    title: "NavAIgate rail",
    description: "Run-sheet sidebar: NOW card, harness filter, real folders from project-folders, right-click on everything.",
    component: Rail,
  });
  app.slots.homepageSection({ id: "control-room", title: "Control room", component: ControlRoom });
  app.slots.messageDirective({ id: "nav-chart", component: NavChart });
  app.slots.messageDirective({ id: "nav-links", component: (p) => <Boundary label="Link cards" compact><NavLinks {...p} /></Boundary> });
  app.slots.messageDirective({ id: "nav-pipeline", component: (p) => <Boundary label="Pipeline" compact><NavPipeline {...p} /></Boundary> });
  app.slots.experimental_appOverlay({ id: "usage-dock", component: UsageDock });
  // Chips in the row under the chat box: hold for sub-agents, your always-on machine, the Claude account.
  app.slots.experimental_appOverlay({ id: "composer-chips", component: () => <Boundary label="Composer chips" compact><ComposerChips /></Boundary> });
  // Invisible: hands each composer's API to the chips (draft text, machine picker).
  app.composer.customize({ id: "chips-bridge", scopes: ["new-thread", "thread"], actions: [{ id: "bridge", component: ComposerBridge }] });
  // Chrome-style tab strip across the top; docking rides on bb's own split.
  app.slots.experimental_appOverlay({ id: "tabs", component: () => <Boundary label="Tabs" compact><TabStrip /></Boundary> });
  app.slots.experimental_appOverlay({ id: "new-thread-hero", component: NewThreadHero });
  // Agents: the orchestration space on the right — family map, log, spin up.
  app.slots.threadPanelAction({
    id: "agents",
    title: "Agents",
    icon: "navaigate-workspace/agents",
    layout: "flush",
    component: ({ threadId }) => (
      <Boundary label="Agents panel">
        <AgentsPanel threadId={threadId} />
      </Boundary>
    ),
  });
  app.commands.register({
    id: "open-agents",
    title: "Workspace: open agents",
    defaultShortcut: { key: "a", mod: true, shift: true },
    run: (ctx) => {
      if (!ctx.threadId) return;
      try {
        ctx.openPanel({ actionId: "agents", title: "Agents" });
      } catch (e) {
        console.error("[navaigate-workspace] open agents failed", e);
      }
    },
  });
  // To-do: right-hand panel in any chat, a Board page, a header button and ⌘⇧D.
  app.slots.threadPanelAction({
    id: "todo",
    title: "To-do",
    icon: "navaigate-workspace/todo",
    layout: "flush",
    component: ({ threadId }) => <TodoPanel threadId={threadId} />,
  });
  app.slots.experimental_threadHeaderAction({ id: "todo-button", title: "To-do", component: ({ threadId }) => <TodoHeaderButton threadId={threadId} /> });
  // On your machine: a chat handed to the always-on machine shows its live progress here.
  app.slots.threadPanelAction({
    id: "machine",
    title: "On your machine",
    icon: "navaigate-workspace/workspace",
    layout: "flush",
    component: ({ threadId }) => (
      <Boundary label="On your machine">
        <MachinePanel threadId={threadId} />
      </Boundary>
    ),
  });
  app.slots.experimental_threadHeaderAction({ id: "machine-button", title: "On your machine", component: ({ threadId }) => <MachineHeaderButton threadId={threadId} /> });
  app.slots.navPanel({ id: "board", title: "Board", icon: "navaigate-workspace/board", path: "board", component: () => <TodoBoard /> });
  // Home: the NavAIgate front page (logo orb, brief, Jev, inbox, subscriptions). Shows Set up until it is done.
  app.slots.navPanel({
    id: "home",
    title: "Home",
    icon: "Home",
    path: "home",
    component: () => (
      <Boundary label="Home">
        <HomePage />
      </Boundary>
    ),
  });
  // Set up: name, areas of work, your own keys, an optional always-on machine.
  app.slots.navPanel({
    id: "setup",
    title: "Set up",
    icon: "Settings",
    path: "setup",
    component: () => (
      <Boundary label="Set up">
        <SetupWizard onDone={() => goTo("/plugins/navaigate-workspace/home")} />
      </Boundary>
    ),
  });
  app.commands.register({ id: "open-setup", title: "Workspace: set up", run: () => goTo("/plugins/navaigate-workspace/setup") });
  // Calendar: month view of your Google Calendars, day panel, ask box, booking links.
  app.slots.navPanel({
    id: "calendar",
    title: "Calendar",
    icon: "Calendar",
    path: "calendar",
    component: () => (
      <Boundary label="Calendar">
        <CalendarPage />
      </Boundary>
    ),
  });
  // Inbox: all mail from your Gmail accounts, read-only; Sort with Jev puts every email in a pile.
  app.slots.navPanel({
    id: "inbox",
    title: "Inbox",
    icon: "Mail",
    path: "inbox",
    component: () => (
      <Boundary label="Inbox">
        <InboxPage />
      </Boundary>
    ),
  });
  // NavAIgate mark in bb's sidebar header (choose it in Settings, Appearance, on bb 0.44 and 0.45).
  // bb 0.46 removed the sidebar-header slot (get-bb/bb#5229). Register it only where it
  // still exists, so newer bb versions don't fail the whole plugin.
  const slots = app.slots as unknown as Record<string, unknown>;
  if (typeof slots.experimental_sidebarHeader === "function") {
    try {
      app.slots.experimental_sidebarHeader({ id: "navaigate-header", title: "NavAIgate", description: "The NavAIgate orb and name at the top of the sidebar.", component: HeaderMark });
    } catch {
      /* slot gone in this bb version */
    }
  }
  // Keep navigation with bb's bundled Navigation plugin. Registering a list here
  // makes Automatic choose it instead of bb's left icon rail on a fresh install.
  // The NavAIgate thread list above remains independent of navigation placement.
  // Dashboard: any local web app you run, framed as a page in bb (setting: Dashboards).
  app.slots.navPanel({
    id: "dashboard",
    title: "Dashboard",
    icon: "AppWindow",
    path: "dashboard",
    component: () => (
      <Boundary label="Dashboard">
        <DashboardPage />
      </Boundary>
    ),
  });
  app.commands.register({
    id: "open-todo",
    title: "Workspace: open to-do",
    defaultShortcut: { key: "d", mod: true, shift: true },
    run: (ctx) => {
      if (ctx.threadId && ctx.openPanel({ actionId: "todo", title: "To-do" })) return;
      window.history.pushState({}, "", "/plugins/navaigate-workspace/board");
      window.dispatchEvent(new PopStateEvent("popstate", { state: {} }));
    },
  });
  // Voice agent (Savvy on ElevenLabs): one engine for the whole window, a Talk
  // button in each chat header, a Voice tab with the transcript, and ⌘⇧E.
  app.slots.experimental_appOverlay({ id: "voice-engine", component: VoiceEngine });
  app.slots.threadPanelAction({ id: "voice", title: "Voice", icon: "Mic", layout: "flush", component: () => <VoicePanel /> });
  app.slots.experimental_threadHeaderAction({ id: "voice-button", title: "Talk to Savvy", component: () => <VoiceHeaderButton /> });
  app.commands.register({
    id: "voice-toggle",
    title: "Workspace: talk to Savvy",
    defaultShortcut: { key: "e", mod: true, shift: true },
    run: (ctx) => {
      if (ctx.threadId) ctx.openPanel({ actionId: "voice", title: "Voice" });
      voice.toggle();
    },
  });
  app.experimental_sidebarFooter.register({
    kind: "action",
    id: "light-dark",
    label: "Switch light / dark mode",
    icon: "navaigate-workspace/contrast",
    onActivate: () => toggleMode(),
  });
});
