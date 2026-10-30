import type { PluginSidebarProject, PluginSidebarThread } from "@get-bb/plugin-sdk/app";
export const project: PluginSidebarProject = { id: "project-one", name: "Test project", isPersonal: false, href: "/projects/project-one", settingsHref: "/settings/projects/project-one" };
export function thread(overrides: Partial<PluginSidebarThread> = {}): PluginSidebarThread {
  return {
    id: "thread-one", projectId: project.id, title: "Review the interface", titleFallback: null, displayTitle: "Review the interface",
    parentThreadId: null, lifecycleOwnerThreadId: null, sourceThreadId: null, sectionId: null, originKind: null, originPluginId: null,
    providerId: "claude", status: "idle", runtimeStatus: "idle", queuedWork: "none", hasPendingInteraction: false,
    activity: { workflows: 0, backgroundAgents: 0, backgroundCommands: 0, planMode: 0, goals: 0 },
    indicator: "none", indicatorLabel: null, isUnread: false, isPinned: false, pinnedAt: null, pinSortKey: null,
    isArchived: false, archivedAt: null, href: "/projects/project-one/threads/thread-one", isHidden: false, environment: null, host: null,
    createdAt: 1, updatedAt: 2, lastReadAt: 2, latestAttentionAt: 2, ...overrides,
  };
}
