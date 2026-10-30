import { useCallback, useEffect, useRef, useState } from "react";
import { definePluginApp, useRealtime, useRpc, useSettings } from "@get-bb/plugin-sdk/app";
import type { rpcContract } from "./server";
import { GuideView, type GuidePhase, type GuideSnapshot } from "./guide";
import { STEPS } from "./lib/steps";
import type { GuideAction } from "./lib/state";
export const OPEN_EVENT = "bb-overlay-guide:open";
export const REPLAY_EVENT = "bb-overlay-guide:replay";
const message = (cause: unknown) => cause instanceof Error ? cause.message : String(cause);
export function GuideController() {
  const rpc = useRpc<typeof rpcContract>(), rpcRef = useRef(rpc); rpcRef.current = rpc;
  const { values } = useSettings();
  const [snapshot, setSnapshot] = useState<GuideSnapshot | null>(null), snapshotRef = useRef<GuideSnapshot | null>(null);
  const [phase, setPhase] = useState<GuidePhase | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null), [notice, setNotice] = useState<string | null>(null);
  const alive = useRef(true), pending = useRef(false), autoAttempted = useRef(new Set<string>());
  // Visibility intent and data publication are independent: closing invalidates old
  // UI work, while a newer snapshot/config request supersedes an older response.
  const visibilityEpoch = useRef(0), dataEpoch = useRef(0);
  const pendingResult = useRef<Promise<GuideSnapshot | null> | null>(null), pendingClose = useRef<Promise<void> | null>(null);
  const accept = useCallback((next: GuideSnapshot) => { snapshotRef.current = next; setSnapshot(next); }, []);
  const mutate = useCallback(async (action: GuideAction) => {
    if (pending.current) return;
    const visibleAt = visibilityEpoch.current, publishAt = ++dataEpoch.current;
    let resolveResult!: (next: GuideSnapshot | null) => void;
    const result = new Promise<GuideSnapshot | null>(resolve => { resolveResult = resolve; });
    pendingResult.current = result; pending.current = true; setBusy(true); setError(null);
    try {
      const current = snapshotRef.current ?? await rpcRef.current.call("snapshot");
      const next = await rpcRef.current.call("update", { edition: current.edition, guideVersion: current.guideVersion, action });
      resolveResult(next); // A queued close needs the returned run id even when UI publication is stale.
      if (!alive.current || visibleAt !== visibilityEpoch.current || publishAt !== dataEpoch.current) return;
      accept(next);
      if (action.kind === "close") setPhase(null);
      else if (action.kind === "offer") { if (next.offered) setPhase("offer"); }
      else setPhase(next.progress.status === "completed" ? "completed" : "tour");
    } catch (cause) {
      resolveResult(null);
      if (alive.current && visibleAt === visibilityEpoch.current && publishAt === dataEpoch.current) setError(`Progress could not be saved. ${message(cause)} Try the same action again.`);
    } finally {
      if (pendingResult.current === result) pendingResult.current = null;
      pending.current = false; if (alive.current) setBusy(false);
    }
  }, [accept]);
  const load = useCallback(async () => {
    const publishAt = ++dataEpoch.current;
    try {
      const next = await rpcRef.current.call("snapshot");
      if (!alive.current || publishAt !== dataEpoch.current) return;
      const prior = snapshotRef.current; accept(next);
      if (prior && (prior.edition !== next.edition || prior.guideVersion !== next.guideVersion)) { visibilityEpoch.current += 1; setPhase(null); }
    } catch (cause) { if (alive.current && publishAt === dataEpoch.current) setError(`The guide could not load. ${message(cause)}`); }
  }, [accept]);
  useEffect(() => { alive.current = true; void load(); return () => { alive.current = false; dataEpoch.current += 1; }; }, [load, values?.edition, values?.autoStart, values?.guideVersion]);
  useRealtime("guide-configured", () => void load());
  useRealtime("guide-changed", () => { if (!pending.current) void load(); });
  useEffect(() => {
    if (!snapshot || busy || pending.current || pendingClose.current) return;
    const key = `${snapshot.edition}:${snapshot.guideVersion}`;
    if (snapshot.autoStart && snapshot.progress.status === "new" && snapshot.progress.offeredAt === null && !autoAttempted.current.has(key)) { autoAttempted.current.add(key); void mutate({ kind: "offer" }); }
  }, [snapshot, busy, mutate]);
  const requestOpen = useCallback(async (replay: boolean) => {
    const visibleAt = ++visibilityEpoch.current;
    // A deliberate reopen is ordered after a close, including a close waiting on Start.
    const closing = pendingClose.current, changing = pendingResult.current;
    if (closing) await closing; else if (changing) await changing;
    if (!alive.current || visibleAt !== visibilityEpoch.current) return;
    await mutate({ kind: replay ? "replay" : "start" });
  }, [mutate]);
  useEffect(() => {
    const open = (event: Event) => { const replay = event.type === REPLAY_EVENT || (event instanceof CustomEvent && event.detail?.replay === true); void requestOpen(replay); };
    window.addEventListener(OPEN_EVENT, open); window.addEventListener(REPLAY_EVENT, open);
    return () => { window.removeEventListener(OPEN_EVENT, open); window.removeEventListener(REPLAY_EVENT, open); };
  }, [requestOpen]);
  useEffect(() => { if (!notice) return; const timer = setTimeout(() => setNotice(null), 6500); return () => clearTimeout(timer); }, [notice]);
  const close = useCallback(() => {
    const visibleAt = ++visibilityEpoch.current, publishAt = ++dataEpoch.current;
    setPhase(null); setError(null);
    const before = snapshotRef.current, changing = pendingResult.current, closing = pendingClose.current;
    const work = (async () => {
      if (closing) await closing;
      // Start/replay may allocate a new run id. Pause that returned run, not the stale one.
      const returned = changing ? await changing : null, current = returned ?? before;
      if (!current || !before || current.edition !== before.edition || current.guideVersion !== before.guideVersion) return;
      const next = await rpcRef.current.call("update", { edition: current.edition, guideVersion: current.guideVersion, action: { kind: "close", runId: current.progress.runId } });
      if (alive.current && visibleAt === visibilityEpoch.current && publishAt === dataEpoch.current) { accept(next); setPhase(null); }
    })().catch(() => {
      if (alive.current && visibleAt === visibilityEpoch.current) setNotice("Guide closed. Your last saved step is kept; the close marker could not be saved while the connection was unavailable.");
    });
    pendingClose.current = work;
    void work.finally(() => { if (pendingClose.current === work) pendingClose.current = null; });
  }, [accept]);
  return <>{snapshot && phase && <GuideView snapshot={snapshot} phase={phase} busy={busy} error={error} onAction={action => { if (action.kind === "start" || action.kind === "replay") void requestOpen(action.kind === "replay"); else void mutate(action); }} onClose={close} />}{notice && <div className="bbog-notice" role="status">{notice}</div>}</>;
}
export function GuideSettings() {
  const rpc = useRpc<typeof rpcContract>(), rpcRef = useRef(rpc); rpcRef.current = rpc;
  const [snapshot, setSnapshot] = useState<GuideSnapshot | null>(null), [error, setError] = useState<string | null>(null);
  const read = useCallback(() => { rpcRef.current.call("snapshot").then(next => { setSnapshot(next); setError(null); }, cause => setError(message(cause))); }, []);
  useEffect(read, [read]); useRealtime("guide-changed", read); useRealtime("guide-configured", read);
  const p = snapshot?.progress;
  return <div className="bbog-settings"><p>A short guide anchored to your real workspace. Every step waits for your explicit read check.</p>{snapshot && p && <><p className="bbog-settings-meta">{snapshot.edition === "simple" ? "Simple" : "Pro"} · guide {snapshot.guideVersion} · {Object.keys(p.reviewed).length} of {STEPS[snapshot.edition].length} steps read{p.status === "completed" ? " · completed" : p.status === "paused" ? " · paused" : ""}</p>{p.history.lastCompletedAt && <p className="bbog-settings-meta">Last completed {new Date(p.history.lastCompletedAt).toLocaleDateString("en-GB")}. {p.history.completedRuns} completed {p.history.completedRuns === 1 ? "run" : "runs"} kept in history.</p>}</>}{error && <p className="bbog-error" role="alert">Could not load progress: {error}</p>}<div className="bbog-settings-actions"><button className="bbog-primary" onClick={() => window.dispatchEvent(new CustomEvent(OPEN_EVENT))}>Open or resume guide</button><button className="bbog-secondary" onClick={() => window.dispatchEvent(new CustomEvent(REPLAY_EVENT))}>Replay guide</button></div><p className="bbog-settings-meta" style={{ marginTop: 12 }}>Replay clears this run’s read checks and preserves completion history. Neither action changes your workspace or enables a feature.</p></div>;
}
export default definePluginApp(app => {
  app.slots.experimental_appOverlay({ id: "guide", component: GuideController });
  app.slots.settingsSection({ id: "guide", title: "BB Overlay guide", description: "Resume or replay the guide for your current edition.", component: GuideSettings });
  app.commands.register({ id: "open-guide", title: "BB Overlay guide: open or resume", run: () => { window.dispatchEvent(new CustomEvent(OPEN_EVENT)); } });
  app.commands.register({ id: "replay-guide", title: "BB Overlay guide: replay", run: () => { window.dispatchEvent(new CustomEvent(REPLAY_EVENT)); } });
});
