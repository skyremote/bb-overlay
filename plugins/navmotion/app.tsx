// NavMotion Studio — frontend entry.
//
// One nav panel ("NavMotion", own rail entry) routed by subPath:
//   ""          Projects grid
//   "p/<slug>"  Project detail
//   "new"       New project form
//   "guide"     The skill's GUIDE.md
// Fixed tabs put the Guide and the New form in the host side panel too, so
// either can sit beside a project. A thread panel action opens
// the project linked to the current thread.
import type { ReactNode } from "react";
import { definePluginApp, useBbNavigate, useRpc } from "@get-bb/plugin-sdk/app";
import type { PluginNavPanelProps, PluginThreadPanelProps } from "@get-bb/plugin-sdk/app";
import { useEffect, useState } from "react";
import type { rpcContract } from "./server";
import { cn } from "@/lib/utils";
import { ProjectDetailView } from "@/components/studio/detail";
import { GuideView, NewProjectView } from "@/components/studio/new-guide";
import { ProjectsView } from "@/components/studio/projects";
import { Empty, FONT, PANEL_ID, PANEL_PATH, errorText } from "@/components/studio/shared";

type Route = { view: "projects" } | { view: "project"; slug: string } | { view: "new" } | { view: "guide" };

function parse(subPath: string): Route {
  const parts = subPath.split("/").filter(Boolean);
  if (parts[0] === "p" && parts[1]) return { view: "project", slug: decodeURIComponent(parts[1]) };
  if (parts[0] === "new") return { view: "new" };
  if (parts[0] === "guide") return { view: "guide" };
  return { view: "projects" };
}

function Page({ children }: { children: ReactNode }) {
  return (
    <div className="h-full min-h-0 flex-1 overflow-y-auto bg-background text-foreground antialiased" style={FONT}>
      <div className="mx-auto box-border w-full max-w-6xl px-4 pb-10 pt-4 md:px-6 md:pt-6">{children}</div>
    </div>
  );
}

function StudioPage({ subPath }: PluginNavPanelProps) {
  const route = parse(subPath);
  return (
    <Page>
      {route.view === "project" ? (
        <ProjectDetailView slug={route.slug} />
      ) : route.view === "new" ? (
        <div className="max-w-2xl">
          <NewProjectView />
        </div>
      ) : route.view === "guide" ? (
        <div className="max-w-3xl">
          <GuideView />
        </div>
      ) : (
        <ProjectsView />
      )}
    </Page>
  );
}

function HeaderNav({ subPath }: PluginNavPanelProps) {
  const nav = useBbNavigate();
  const route = parse(subPath);
  const item = (label: string, target: string, active: boolean) => (
    <button
      key={label}
      type="button"
      aria-pressed={active}
      onClick={() => nav.toPluginPanel(PANEL_PATH, { subPath: target })}
      className={cn(
        "rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
        active ? "bg-foreground text-background" : "text-muted-foreground hover:bg-state-hover hover:text-foreground",
      )}
    >
      {label}
    </button>
  );
  return (
    <div className="flex items-center gap-1" style={FONT}>
      {item("Projects", "", route.view === "projects" || route.view === "project")}
      {item("New", "new", route.view === "new")}
      {item("Guide", "guide", route.view === "guide")}
    </div>
  );
}

function SideFrame({ children }: { children: ReactNode }) {
  return (
    <div className="text-foreground" style={FONT}>
      {children}
    </div>
  );
}

function NewTab(_props: PluginNavPanelProps) {
  return (
    <SideFrame>
      <NewProjectView />
    </SideFrame>
  );
}
function GuideTab(_props: PluginNavPanelProps) {
  return (
    <SideFrame>
      <GuideView />
    </SideFrame>
  );
}

/** Thread right panel: the NavMotion project whose thread_id is this thread. */
function ThreadProjectPanel({ threadId, params }: PluginThreadPanelProps) {
  const rpc = useRpc<typeof rpcContract>();
  const fromParams =
    params !== null && typeof params === "object" && !Array.isArray(params) && typeof (params as { slug?: unknown }).slug === "string"
      ? ((params as { slug: string }).slug)
      : null;
  const [slug, setSlug] = useState<string | null | undefined>(fromParams ?? undefined);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (fromParams !== null) return;
    let live = true;
    rpc.call("project_by_thread", { threadId }).then(
      (r) => live && setSlug(r.slug),
      (e) => live && setError(errorText(e)),
    );
    return () => {
      live = false;
    };
  }, [rpc, threadId, fromParams]);
  return (
    <SideFrame>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : slug === undefined ? (
        <Empty>Looking for this thread's project</Empty>
      ) : slug === null ? (
        <Empty>This thread is not linked to a NavMotion project. Projects started from the Studio are linked automatically.</Empty>
      ) : (
        <ProjectDetailView slug={slug} embedded />
      )}
    </SideFrame>
  );
}

export default definePluginApp((app) => {
  app.slots.navPanel({
    id: PANEL_ID,
    title: "NavMotion",
    icon: "Video",
    path: PANEL_PATH,
    component: StudioPage,
    headerContent: HeaderNav,
    fixedTabs: [
      { id: "navmotion-guide", panelId: PANEL_ID, title: "Guide", icon: "Book", component: GuideTab },
      { id: "navmotion-new", panelId: PANEL_ID, title: "New", icon: "Plus", component: NewTab },
    ],
  });
  app.slots.threadPanelAction({
    id: "navmotion-project",
    title: "NavMotion",
    component: ThreadProjectPanel,
  });
});
