import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { useRealtime, useRealtimeConnectionState, useRpc } from "@get-bb/plugin-sdk/app";
import type { ProjectDetail, ProjectSummary, rpcContract } from "../../server";
import { cn } from "@/lib/utils";

export const PANEL_PATH = "studio";
export const PANEL_ID = "navmotion";
export const CHANNEL = "projects-changed";
export const FONT = { fontFamily: "Inter, ui-sans-serif, system-ui, -apple-system, sans-serif" } as const;

export const KIND_LABELS: Record<string, string> = {
  deck: "Deck graphic",
  short: "Short, graphics only",
  "short-dan": "Short with my footage",
  longform: "Long form with my footage",
  film: "Landscape film",
};
export const kindLabel = (k: string) => KIND_LABELS[k] ?? k;

export const STATE_LABELS: Record<string, string> = {
  todo: "To do",
  running: "Running",
  waiting: "Waiting",
  done: "Done",
  failed: "Failed",
};

export function errorText(cause: unknown): string {
  if (cause instanceof Error) return cause.message;
  if (cause && typeof cause === "object" && "message" in cause) return String((cause as { message: unknown }).message);
  return String(cause);
}

/** Refetch on mount, on every server signal, and when the realtime socket reconnects. */
function useLive(load: () => void, match: (slugs: string[]) => boolean) {
  const conn = useRealtimeConnectionState();
  const first = useRef(true);
  useEffect(() => {
    load();
    // Media URLs are one-hour BB preview links; refresh them well before expiry.
    const t = setInterval(load, 5 * 60 * 1000);
    return () => clearInterval(t);
  }, [load]);
  useEffect(() => {
    if (conn !== "connected") return;
    if (first.current) {
      first.current = false;
      return;
    }
    load();
  }, [conn, load]);
  useRealtime(CHANNEL, (payload: unknown) => {
    const slugs =
      payload && typeof payload === "object" && Array.isArray((payload as { slugs?: unknown }).slugs)
        ? ((payload as { slugs: unknown[] }).slugs.filter((s) => typeof s === "string") as string[])
        : [];
    if (slugs.length === 0 || match(slugs)) load();
  });
}

export function useProjects() {
  const rpc = useRpc<typeof rpcContract>();
  const [data, setData] = useState<{ root: string; rootExists: boolean; projects: ProjectSummary[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => {
    rpc.call("projects_list").then(
      (r) => {
        setData(r);
        setError(null);
      },
      (e) => setError(errorText(e)),
    );
  }, [rpc]);
  useLive(load, () => true);
  return { data, error, reload: load };
}

export function useProject(slug: string | null) {
  const rpc = useRpc<typeof rpcContract>();
  const [project, setProject] = useState<ProjectDetail | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => {
    if (slug === null) {
      setProject(null);
      return;
    }
    rpc.call("project_get", { slug }).then(
      (r) => {
        setProject(r.project);
        setError(null);
      },
      (e) => setError(errorText(e)),
    );
  }, [rpc, slug]);
  useLive(load, (slugs) => slug !== null && slugs.includes(slug));
  return { project, error, reload: load };
}

export function StateDot({ state, className }: { state: string; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "inline-block size-2 shrink-0 rounded-full",
        state === "done" && "bg-foreground/70",
        state === "running" && "animate-pulse bg-primary",
        state === "waiting" && "bg-primary ring-2 ring-primary/25",
        state === "failed" && "bg-destructive",
        state === "todo" && "border border-muted-foreground/50 bg-transparent",
        className,
      )}
    />
  );
}

export function AwaitingBadge({ what }: { what: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-primary px-2 py-0.5 text-[11px] font-semibold text-primary-foreground">
      Awaiting you: {what === "final" ? "final" : what === "covers" ? "covers" : "storyboard"}
    </span>
  );
}

export function Bar({ value }: { value: number }) {
  const pct = Math.max(0, Math.min(100, value));
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}>
      <div className="h-full rounded-full bg-primary transition-[width] duration-500" style={{ width: `${pct}%` }} />
    </div>
  );
}

export function duration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  if (h > 0) return `${h} h ${m} min`;
  if (m > 0) return `${m} min ${r} s`;
  return `${r} s`;
}

export function bytes(n: number | null): string {
  if (n === null) return "";
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)} GB`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)} MB`;
  if (n >= 1e3) return `${Math.round(n / 1e3)} KB`;
  return `${n} B`;
}

export function when(iso: string | null): string {
  if (iso === null) return "";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return iso;
  const diff = (Date.now() - t) / 1000;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)} min ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} h ago`;
  return new Date(t).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

export function Section({ title, children, aside }: { title: string; children: ReactNode; aside?: ReactNode }) {
  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-[13px] font-semibold uppercase tracking-wide text-muted-foreground">{title}</h2>
        {aside}
      </div>
      {children}
    </section>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return (
    <div role="status" className="rounded-xl border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
      {children}
    </div>
  );
}
