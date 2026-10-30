import type { PluginSidebarProject, PluginSidebarThread, PluginThreadActionTarget } from "@get-bb/plugin-sdk/app";

export function statusLabel(thread: PluginSidebarThread): string {
  if (thread.hasPendingInteraction || thread.indicator === "waiting-for-input") return "Needs your input";
  if (thread.runtimeStatus === "waiting-for-host") return "Waiting for machine";
  if (thread.runtimeStatus === "provisioning") return "Preparing workspace";
  if (thread.queuedWork === "failed" || thread.indicator === "unread-error") return "Needs attention";
  if (["starting", "active", "stopping"].includes(thread.status)) return thread.status === "stopping" ? "Stopping" : "Working";
  if (thread.queuedWork === "waiting") return "Message queued";
  if (thread.indicator === "unread-success") return "Finished";
  return thread.isUnread ? "Unread" : "Ready";
}

export function displayThreads(
  threads: readonly PluginSidebarThread[],
  projects: readonly PluginSidebarProject[],
  projectId: string | null,
  query: string,
): PluginSidebarThread[] {
  const needle = query.trim().toLocaleLowerCase();
  const projectNames = new Map(projects.map(project => [project.id, project.name]));
  return threads.filter(thread => !thread.isHidden && !thread.isArchived && (!projectId || thread.projectId === projectId))
    .filter(thread => !needle || `${thread.displayTitle} ${projectNames.get(thread.projectId) ?? ""} ${thread.providerId}`.toLocaleLowerCase().includes(needle))
    .sort((a, b) => Number(b.isPinned) - Number(a.isPinned) || b.updatedAt - a.updatedAt || a.id.localeCompare(b.id));
}

export function threadTarget(thread: PluginSidebarThread): PluginThreadActionTarget {
  return {
    id: thread.id, projectId: thread.projectId, parentThreadId: thread.parentThreadId,
    archivedAt: thread.archivedAt, pinnedAt: thread.pinnedAt, sectionId: thread.sectionId,
    isUnread: thread.isUnread, status: thread.status,
    environment: thread.environment?.id ? { id: thread.environment.id, path: thread.environment.path } : null,
  };
}

export function windowRange(length: number, scrollTop: number, height: number, rowHeight = 64) {
  const start = Math.min(Math.max(0, length - 1), Math.max(0, Math.floor(scrollTop / rowHeight) - 6));
  const end = Math.min(length, Math.ceil((scrollTop + height) / rowHeight) + 6);
  return { start, end };
}

export const TOOLS = [
  { id: "helper-desk", name: "Helper Desk", icon: "Bot" as const, description: "See the lead and its helpers beside the conversation." },
  { id: "cache-clock", name: "Cache Clock", icon: "Clock" as const, description: "A cache-time estimate and deliberate hand-off for Claude chats." },
  { id: "reflect", name: "Reflect", icon: "RotateCcw" as const, description: "Review a lasting rule before choosing where to save it." },
  { id: "screen-share", name: "Screen Share", icon: "Shield" as const, description: "Preview and mask matching fields before sharing your screen." },
] as const;

export function toolStatus(status: string | undefined): string {
  if (!status || status === "missing") return "Not installed";
  if (status === "running") return "Enabled";
  if (status === "disabled") return "Disabled";
  if (status === "needs-configuration") return "Needs setup";
  if (status === "starting") return "Starting";
  if (status === "incompatible") return "Needs a compatible version";
  return "Needs attention";
}
