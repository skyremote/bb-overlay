import { useEffect, useState } from "react";
import { UrlLink, useBbNavigate, useRpc } from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import type { ProjectDetail, rpcContract } from "../../server";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
  AwaitingBadge,
  Bar,
  Empty,
  PANEL_PATH,
  STATE_LABELS,
  Section,
  StateDot,
  bytes,
  duration,
  errorText,
  kindLabel,
  useProject,
  when,
} from "./shared";

function StageRail({ p }: { p: ProjectDetail }) {
  if (p.stages.length === 0) return null;
  return (
    <ol className="flex flex-wrap gap-1.5">
      {p.stages.map((s) => (
        <li
          key={s.name}
          title={[s.summary, s.finished ? `finished ${when(s.finished)}` : s.started ? `started ${when(s.started)}` : null].filter(Boolean).join(" · ")}
          className={cn(
            "flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs",
            s.name === p.stage ? "border-foreground/30 bg-card font-semibold text-foreground shadow-xs" : "border-border text-muted-foreground",
            s.state === "failed" && "border-destructive/50 text-destructive",
          )}
        >
          <StateDot state={s.state} />
          <span className="capitalize">{s.name}</span>
        </li>
      ))}
    </ol>
  );
}

function RenderProgress({ p }: { p: ProjectDetail }) {
  const pr = p.progress;
  // Tick once a second so the ETA counts down between status.json writes.
  const [, setNow] = useState(0);
  useEffect(() => {
    if (!pr) return;
    const t = setInterval(() => setNow((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [pr]);
  if (!pr) return null;
  const pct = (pr.frame / pr.of) * 100;
  let eta = pr.eta_s;
  if (eta !== null && p.updated) {
    const since = (Date.now() - Date.parse(p.updated)) / 1000;
    if (Number.isFinite(since) && since > 0) eta = Math.max(0, eta - since);
  }
  return (
    <div className="space-y-2 rounded-xl border border-border bg-card p-4">
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <span className="font-medium text-foreground">
          Rendering {pr.film ? `film ${pr.film}` : ""} <span className="text-muted-foreground">({pr.stage ?? "render"})</span>
        </span>
        <span className="tabular-nums text-foreground">{Math.round(pct)}%</span>
      </div>
      <Bar value={pct} />
      <div className="flex justify-between text-xs tabular-nums text-muted-foreground">
        <span>
          Frame {pr.frame.toLocaleString("en-GB")} of {pr.of.toLocaleString("en-GB")}
        </span>
        <span>{eta !== null ? `about ${duration(eta)} left` : "working out the time left"}</span>
      </div>
    </div>
  );
}

function Decision({ p }: { p: ProjectDetail }) {
  const rpc = useRpc<typeof rpcContract>();
  const [note, setNote] = useState("");
  const [mode, setMode] = useState<"idle" | "changes">("idle");
  const [busy, setBusy] = useState(false);
  const last = p.feedback[p.feedback.length - 1];
  if (!p.awaiting) return null;
  const locked = p.decisionPending || busy;
  const send = async (decision: "approve" | "changes") => {
    if (locked) return;
    setBusy(true);
    try {
      const r = await rpc.call("decide", { slug: p.slug, decision, note });
      if (r.warning) toast.warning(r.warning);
      else toast.success(decision === "approve" ? "Approved. The agent has been told." : "Changes sent to the agent.");
      setNote("");
      setMode("idle");
    } catch (e) {
      toast.error(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="space-y-3 rounded-xl border border-primary/40 bg-primary/5 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <AwaitingBadge what={p.awaiting} />
        <span className="text-sm text-foreground">
          {p.awaiting === "storyboard"
            ? "The storyboard is ready for your decision."
            : p.awaiting === "covers"
              ? "The covers are ready for your decision."
              : "The final cut is ready for your decision."}
        </span>
      </div>
      {p.decisionPending && last ? (
        <div className="rounded-lg bg-card px-3 py-2 text-sm text-foreground">
          You {last.decision === "approve" ? "approved" : "asked for changes"} {when(last.at)}
          {last.note ? <>: <span className="italic">{last.note}</span></> : null}. Waiting for the agent to pick it up.
        </div>
      ) : null}
      {mode === "changes" ? (
        <div className="space-y-2">
          <Textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="What should change? For example: logo too small at 4 s"
            rows={3}
            disabled={locked}
            aria-label="Changes to make"
          />
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => void send("changes")} disabled={locked || note.trim() === ""}>
              Send changes
            </Button>
            <Button variant="ghost" onClick={() => setMode("idle")} disabled={busy}>
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          <Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional note with your approval" rows={2} disabled={locked} aria-label="Note" />
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => void send("approve")} disabled={locked}>
              <Icon name="Check" />
              Approve
            </Button>
            <Button variant="outline" onClick={() => setMode("changes")} disabled={locked}>
              Request changes
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function Stills({ film }: { film: ProjectDetail["films"][number] }) {
  const [guides, setGuides] = useState(false);
  const [zoom, setZoom] = useState<string | null>(null);
  const list = guides && film.stillsGuides.length > 0 ? film.stillsGuides : film.stills;
  const portrait = (() => {
    const m = film.size ? /^(\d+)x(\d+)$/.exec(film.size) : null;
    return m ? Number(m[2]) > Number(m[1]) : false;
  })();
  if (film.stills.length === 0) return <p className="text-sm text-muted-foreground">No stills yet.</p>;
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1 text-xs" role="group" aria-label="Stills view">
        {(["clean", "guides"] as const).map((v) => (
          <button
            key={v}
            type="button"
            aria-pressed={(v === "guides") === guides}
            disabled={v === "guides" && film.stillsGuides.length === 0}
            onClick={() => setGuides(v === "guides")}
            className={cn(
              "rounded-md px-2.5 py-1 font-medium transition-colors disabled:opacity-40",
              (v === "guides") === guides ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {v === "clean" ? "Clean" : "With guides"}
          </button>
        ))}
      </div>
      <div className={cn("grid gap-3", portrait ? "grid-cols-3 sm:grid-cols-4 lg:grid-cols-6" : "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3")}>
        {list.map((s) => (
          <figure key={s.path} className="space-y-1">
            <button type="button" onClick={() => setZoom(s.url)} className="block w-full overflow-hidden rounded-lg border border-border bg-muted">
              <img src={s.url} alt={`Still ${s.path.split("/").pop()}`} loading="lazy" className="w-full object-contain" />
            </button>
            <figcaption className="text-[11px] tabular-nums text-muted-foreground">{s.path.split("/").pop()?.replace(/\.png$|\.jpg$/, "")}</figcaption>
          </figure>
        ))}
      </div>
      {zoom ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/90 p-6" onClick={() => setZoom(null)} role="dialog" aria-label="Still">
          <img src={zoom} alt="" className="max-h-full max-w-full rounded-lg shadow-2xl" />
        </div>
      ) : null}
    </div>
  );
}

function FilmBlock({ film }: { film: ProjectDetail["films"][number] }) {
  const [board, setBoard] = useState(false);
  const g = film.gate;
  return (
    <div className="space-y-4 rounded-xl border border-border bg-card p-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <h3 className="text-sm font-semibold text-foreground">Film: {film.name}</h3>
        <span className="text-xs text-muted-foreground">
          {[film.size, film.duration !== null ? `${film.duration} s` : null].filter(Boolean).join(" · ")}
        </span>
        <div className="ml-auto flex items-center gap-2">
          {film.storyboardUrl ? (
            <>
              <Button size="sm" variant="outline" onClick={() => setBoard((b) => !b)}>
                {board ? "Hide storyboard" : "Show storyboard"}
              </Button>
              <UrlLink href={film.storyboardUrl} target="_blank" className="text-xs text-muted-foreground underline-offset-4 hover:underline">
                Open in a tab
              </UrlLink>
            </>
          ) : null}
        </div>
      </div>
      {board && film.storyboardUrl ? (
        <iframe title={`Storyboard ${film.name}`} src={film.storyboardUrl} sandbox="allow-scripts" className="h-[70vh] w-full rounded-lg border border-border bg-background" />
      ) : null}
      <Stills film={film} />
      <div className="flex flex-wrap gap-6 text-sm">
        <div>
          <div className="text-xs text-muted-foreground">Layout gate</div>
          {g === null ? (
            <div className="text-muted-foreground">Not run</div>
          ) : (
            <div className="flex items-center gap-2">
              <span className={cn("font-semibold", g.pass === false ? "text-destructive" : "text-foreground")}>
                {g.pass === null ? "Unknown" : g.pass ? "Pass" : "Blocked"}
              </span>
              <span className="text-muted-foreground">
                {g.errors ?? 0} error{g.errors === 1 ? "" : "s"}, {g.warnings ?? 0} warning{g.warnings === 1 ? "" : "s"}
              </span>
              {g.reportUrl ? (
                <UrlLink href={g.reportUrl} target="_blank" className="text-xs text-muted-foreground underline underline-offset-4">
                  report
                </UrlLink>
              ) : null}
            </div>
          )}
        </div>
        {film.metrics ? (
          <div>
            <div className="text-xs text-muted-foreground">Metrics</div>
            <div className="flex flex-wrap gap-3 tabular-nums text-foreground">
              {Object.entries(film.metrics).map(([k, v]) => (
                <span key={k}>
                  <span className="text-muted-foreground">{k.replace(/_/g, " ")}</span> {String(v)}
                </span>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

const ASPECT_CLASS: Record<string, string> = { "9:16": "aspect-[9/16]", "3:4": "aspect-[3/4]", "4:5": "aspect-[4/5]" };

function CoverSetRow({ set }: { set: ProjectDetail["coverSets"][number] }) {
  return (
    <div className="grid max-w-xl grid-cols-3 items-end gap-3">
      {set.items.map((c) => (
        <figure key={c.path} className="min-w-0 space-y-1.5" data-aspect={c.aspect ?? "other"}>
          <a href={c.url} target="_blank" rel="noreferrer" className="block overflow-hidden rounded-lg border border-border bg-muted">
            <img src={c.url} alt={c.label} loading="lazy" className={cn("w-full object-cover", c.aspect ? ASPECT_CLASS[c.aspect] : "")} />
          </a>
          <figcaption className="flex flex-wrap items-baseline justify-between gap-x-2 text-xs">
            <span className="font-medium text-foreground">{c.aspect ?? c.label}</span>
            <span className="flex items-center gap-2 text-muted-foreground">
              {bytes(c.bytes)}
              <a href={c.url} download={c.path.split("/").pop()} className="underline-offset-4 hover:underline">
                Download
              </a>
            </span>
          </figcaption>
        </figure>
      ))}
    </div>
  );
}

function Covers({ p }: { p: ProjectDetail }) {
  const [showOlder, setShowOlder] = useState(false);
  if (p.coverSets.length === 0) return null;
  const [newest, ...older] = p.coverSets;
  return (
    <Section
      title="Covers"
      aside={
        older.length > 0 ? (
          <button type="button" onClick={() => setShowOlder((v) => !v)} className="text-xs text-muted-foreground hover:text-foreground">
            {showOlder ? "Hide older versions" : `Show ${older.length} older version${older.length === 1 ? "" : "s"}`}
          </button>
        ) : null
      }
    >
      <div className="space-y-4 rounded-xl border border-border bg-card p-4">
        <div className="text-xs font-semibold text-foreground">Version {newest.version || 1}{older.length > 0 ? " (newest)" : ""}</div>
        <CoverSetRow set={newest} />
        {showOlder
          ? older.map((set) => (
              <div key={set.version} className="space-y-2 border-t border-border pt-4">
                <div className="text-xs font-semibold text-muted-foreground">Version {set.version}</div>
                <CoverSetRow set={set} />
              </div>
            ))
          : null}
      </div>
    </Section>
  );
}

function Outputs({ p }: { p: ProjectDetail }) {
  if (p.outputs.length === 0) return null;
  return (
    <Section title="Outputs">
      <div className="grid gap-4 lg:grid-cols-2">
        {p.outputs.map((o) => (
          <div key={o.path} className="space-y-2 rounded-xl border border-border bg-card p-3">
            {o.kind === "video" ? (
              <video src={o.url} controls preload="metadata" playsInline className="w-full rounded-lg bg-black" />
            ) : o.kind === "image" ? (
              <img src={o.url} alt={o.label} className="w-full rounded-lg bg-muted object-contain" />
            ) : null}
            <div className="flex items-center justify-between gap-2 text-sm">
              <span className="font-medium text-foreground">{o.label}</span>
              <span className="flex items-center gap-3 text-xs text-muted-foreground">
                {bytes(o.bytes)}
                <UrlLink href={o.url} target="_blank" className="underline-offset-4 hover:underline">
                  Open
                </UrlLink>
              </span>
            </div>
            <div className="truncate font-mono text-[11px] text-muted-foreground">{o.path}</div>
          </div>
        ))}
      </div>
    </Section>
  );
}

export function ProjectDetailView({ slug, embedded = false }: { slug: string; embedded?: boolean }) {
  const { project: p, error } = useProject(slug);
  const nav = useBbNavigate();
  if (error) return <p role="alert" className="text-sm text-destructive">{error}</p>;
  if (p === undefined) return <Empty>Loading project</Empty>;
  if (p === null) return <Empty>No project called {slug} in the projects folder.</Empty>;
  return (
    <div className="space-y-6">
      <div className="space-y-3">
        {embedded ? null : (
          <button type="button" onClick={() => nav.toPluginPanel(PANEL_PATH, { subPath: "" })} className="text-xs text-muted-foreground hover:text-foreground">
            &larr; All projects
          </button>
        )}
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className={cn("font-semibold tracking-tight text-foreground", embedded ? "text-lg" : "text-2xl")}>{p.title}</h1>
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
              <span>{kindLabel(p.kind)}</span>
              <span className="flex items-center gap-1.5">
                <StateDot state={p.error ? "failed" : p.state} />
                <span className="capitalize text-foreground">{p.stage ?? "not started"}</span> {STATE_LABELS[p.state] ?? p.state}
              </span>
              <span>updated {when(p.updated)}</span>
            </div>
          </div>
          <div className="flex gap-2">
            {p.threadId ? (
              <Button variant="outline" size="sm" onClick={() => nav.toThread(p.threadId as string)}>
                <Icon name="MessageSquare" />
                Open thread
              </Button>
            ) : (
              <span className="text-xs text-muted-foreground">No thread linked</span>
            )}
            {embedded ? (
              <Button variant="ghost" size="sm" onClick={() => nav.toPluginPanel(PANEL_PATH, { subPath: `p/${p.slug}` })}>
                Open in Studio
              </Button>
            ) : null}
          </div>
        </div>
        <StageRail p={p} />
      </div>

      <Decision p={p} />
      <RenderProgress p={p} />

      {p.error ? (
        <div role="alert" className="rounded-xl border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
          {p.error}
        </div>
      ) : null}
      {p.notes.length > 0 ? (
        <Section title="Notes">
          <ul className="list-disc space-y-1 pl-5 text-sm text-foreground">
            {p.notes.map((n, i) => (
              <li key={i}>{n}</li>
            ))}
          </ul>
        </Section>
      ) : null}
      {p.rejected.length > 0 ? (
        <p className="text-xs text-muted-foreground">
          Not shown (outside the project folder or missing): {p.rejected.join(", ")}
        </p>
      ) : null}
      {p.statusMissing ? <p className="text-sm text-muted-foreground">No status.json yet; the agent has not started.</p> : null}

      <Covers p={p} />
      <Outputs p={p} />

      {p.films.length > 0 ? (
        <Section title={p.films.length === 1 ? "Film" : "Films"}>
          <div className="space-y-4">
            {p.films.map((f) => (
              <FilmBlock key={f.name} film={f} />
            ))}
          </div>
        </Section>
      ) : null}

      <Section title="Brief">
        <div className="space-y-2 rounded-xl border border-border bg-card p-4 text-sm">
          <p className="whitespace-pre-wrap text-foreground">{p.brief ?? "No brief recorded."}</p>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs text-muted-foreground">
            {p.footage ? (
              <>
                <dt>Footage</dt>
                <dd className="truncate font-mono">{p.footage}</dd>
              </>
            ) : null}
            {p.duration !== null ? (
              <>
                <dt>Duration</dt>
                <dd>{p.duration} s</dd>
              </>
            ) : null}
            {p.deliverTo ? (
              <>
                <dt>Delivers to</dt>
                <dd className="truncate font-mono">{p.deliverTo}</dd>
              </>
            ) : null}
            <dt>Folder</dt>
            <dd className="truncate font-mono">{p.folder}</dd>
          </dl>
        </div>
      </Section>

      {p.feedback.length > 0 ? (
        <Section title="Your decisions">
          <ul className="space-y-1 text-sm">
            {[...p.feedback].reverse().map((f, i) => (
              <li key={`${f.at}-${i}`} className="flex gap-3">
                <span className="w-24 shrink-0 text-xs text-muted-foreground">{when(f.at)}</span>
                <span className="text-foreground">
                  {f.decision === "approve" ? "Approved" : "Changes"} {f.about ?? ""}
                  {f.note ? <span className="text-muted-foreground">: {f.note}</span> : null}
                  {f.via ? <span className="text-xs text-muted-foreground"> (via {f.via})</span> : null}
                </span>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}
    </div>
  );
}
