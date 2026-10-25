import { useBbNavigate } from "@get-bb/plugin-sdk/app";
import type { ProjectSummary } from "../../server";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { AwaitingBadge, Bar, Empty, PANEL_PATH, STATE_LABELS, StateDot, kindLabel, useProjects, when } from "./shared";

function ProjectCard({ p }: { p: ProjectSummary }) {
  const nav = useBbNavigate();
  const pct = p.progress ? (p.progress.frame / p.progress.of) * 100 : null;
  return (
    <button
      type="button"
      onClick={() => nav.toPluginPanel(PANEL_PATH, { subPath: `p/${p.slug}` })}
      className="group flex flex-col overflow-hidden rounded-xl border border-border bg-card text-left shadow-xs transition hover:-translate-y-px hover:border-foreground/20 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <div className="relative aspect-video w-full overflow-hidden bg-muted">
        {p.thumbUrl ? (
          <img src={p.thumbUrl} alt="" loading="lazy" className="size-full object-contain" />
        ) : (
          <div className="flex size-full items-center justify-center text-xs text-muted-foreground">No stills yet</div>
        )}
        {p.awaiting ? (
          <div className="absolute left-2 top-2">
            <AwaitingBadge what={p.awaiting} />
          </div>
        ) : null}
      </div>
      <div className="flex flex-1 flex-col gap-2 p-3.5">
        <div className="min-w-0">
          <div className="truncate text-[15px] font-semibold leading-snug text-foreground">{p.title}</div>
          <div className="mt-0.5 text-xs text-muted-foreground">{kindLabel(p.kind)}</div>
        </div>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 whitespace-nowrap text-xs text-foreground/80">
          <StateDot state={p.error ? "failed" : p.state} />
          <span className="font-medium capitalize">{p.stage ?? "not started"}</span>
          <span className="text-muted-foreground">{STATE_LABELS[p.state] ?? p.state}</span>
          <span className="ml-auto text-muted-foreground">{when(p.updated)}</span>
        </div>
        {pct !== null ? (
          <div className="space-y-1">
            <Bar value={pct} />
            <div className="flex justify-between gap-2 whitespace-nowrap text-[11px] text-muted-foreground">
              <span>
                {p.progress?.stage ?? "render"} {Math.round(pct)}%
              </span>
              {p.progress?.eta_s != null ? <span>about {Math.max(1, Math.round(p.progress.eta_s / 60))} min left</span> : null}
            </div>
          </div>
        ) : null}
        {p.error ? <div className="truncate text-xs text-destructive">{p.error}</div> : null}
      </div>
    </button>
  );
}

export function ProjectsView() {
  const { data, error } = useProjects();
  const nav = useBbNavigate();
  const waiting = data?.projects.filter((p) => p.awaiting).length ?? 0;
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Projects</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {data === null
              ? "Loading"
              : `${data.projects.length} project${data.projects.length === 1 ? "" : "s"}${waiting > 0 ? `, ${waiting} waiting for you` : ""}`}
          </p>
        </div>
        <Button onClick={() => nav.toPluginPanel(PANEL_PATH, { subPath: "new" })}>
          <Icon name="Plus" />
          New project
        </Button>
      </div>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      {data === null ? (
        <Empty>Loading projects</Empty>
      ) : !data.rootExists ? (
        <Empty>
          The projects folder <code className="font-mono text-xs">{data.root}</code> does not exist yet. Start a project and it will be made.
        </Empty>
      ) : data.projects.length === 0 ? (
        <Empty>
          No projects in <code className="font-mono text-xs">{data.root}</code> yet.
        </Empty>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {data.projects.map((p) => (
            <ProjectCard key={p.slug} p={p} />
          ))}
        </div>
      )}
    </div>
  );
}
