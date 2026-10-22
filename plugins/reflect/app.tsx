// Reflect frontend: a card above the thread composer when the last message
// held a lasting rule: a red dot, "That sounds like a lasting rule. Save it?",
// the tidied rule in quotes, a small Reflect label, and the save buttons for
// each destination that is set up.
import { useCallback, useEffect, useRef, useState } from "react";
import { definePluginApp, useBbNavigate, useComposer, useRealtime, useRealtimeConnectionState, useRpc } from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import type { Candidate, rpcContract } from "./server";
import type { SavedEntry } from "./savedlog";
import "./reflect.css";

type Target = "voice" | "claude" | "brain";

const LABELS: Record<Target, string> = {
  voice: "Save to voice profile",
  claude: "Save to CLAUDE.md",
  brain: "Save to second brain",
};

function useCandidate(threadId: string | null) {
  const rpc = useRpc<typeof rpcContract>();
  const rpcRef = useRef(rpc);
  rpcRef.current = rpc;
  const [candidate, setCandidate] = useState<Candidate | null>(null);
  const [targets, setTargets] = useState<Record<Target, boolean>>({ voice: false, claude: true, brain: false });
  const refetch = useCallback(() => {
    if (!threadId) {
      setCandidate(null);
      return;
    }
    rpcRef.current.call("pending", { threadId }).then(
      (r) => {
        setCandidate(r.candidate);
        setTargets(r.targets);
      },
      () => undefined,
    );
  }, [threadId]);
  useEffect(() => {
    refetch();
  }, [refetch]);
  useRealtime("reflect-changed", (payload: unknown) => {
    const p = payload as { threadId?: string } | null;
    if (!p?.threadId || p.threadId === threadId) refetch();
  });
  const connection = useRealtimeConnectionState();
  const prev = useRef(connection);
  useEffect(() => {
    if (prev.current !== "connected" && connection === "connected") refetch();
    prev.current = connection;
  }, [connection, refetch]);
  return { candidate, setCandidate, targets, rpc };
}

function ReflectBanner() {
  const composer = useComposer();
  const threadId = composer.scope.kind === "thread" ? composer.scope.threadId : null;
  return <RuleCard threadId={threadId} />;
}

function RuleCard({ threadId }: { threadId: string | null }) {
  const { candidate, setCandidate, targets, rpc } = useCandidate(threadId);
  const [busy, setBusy] = useState<Target | "skip" | null>(null);

  if (!candidate || !threadId) return null;

  const order: Target[] = (candidate.topic === "writing" ? (["voice", "claude", "brain"] as Target[]) : (["claude", "brain", "voice"] as Target[])).filter((t) => targets[t]);

  async function save(target: Target) {
    if (!candidate || !threadId) return;
    setBusy(target);
    try {
      const result = await rpc.call("save", { threadId, id: candidate.id, target });
      setCandidate(null);
      const title = result.status === "exists" ? "Already saved" : `Saved to ${target === "voice" ? "voice profile" : target === "claude" ? "CLAUDE.md" : "second brain"}`;
      toast.success(title, { description: [result.where, result.note].filter(Boolean).join(". ") });
    } catch (error) {
      toast.error("Reflect could not save that rule", { description: error instanceof Error ? error.message : String(error) });
    } finally {
      setBusy(null);
    }
  }

  async function skip() {
    if (!candidate || !threadId) return;
    setBusy("skip");
    try {
      await rpc.call("dismiss", { threadId, id: candidate.id });
      setCandidate(null);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="rf-card" role="region" aria-label="Reflect: save a lasting rule">
      <div className="rf-head">
        <span className="rf-dot" aria-hidden="true" />
        <strong className="rf-title">That sounds like a lasting rule. Save it?</strong>
        <span className="rf-tag">Reflect</span>
      </div>
      <p className="rf-rule">“{candidate.rule}”</p>
      <div className="rf-actions">
        {order.map((target, i) => (
          <button
            key={target}
            type="button"
            className={i === 0 ? "rf-btn rf-primary" : "rf-btn"}
            disabled={busy !== null}
            onClick={() => void save(target)}
          >
            {busy === target ? "Saving…" : LABELS[target]}
          </button>
        ))}
        <button type="button" className="rf-btn rf-ghost" disabled={busy !== null} onClick={() => void skip()}>
          Skip
        </button>
      </div>
    </div>
  );
}

const TARGET_NAMES: Record<Target, string> = { voice: "Voice profile", claude: "CLAUDE.md", brain: "Second brain" };

function when(at: number): string {
  const d = new Date(at);
  const today = new Date();
  const time = d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  if (d.toDateString() === today.toDateString()) return `Today ${time}`;
  const y = new Date(today.getTime() - 86_400_000);
  if (d.toDateString() === y.toDateString()) return `Yesterday ${time}`;
  return `${d.toLocaleDateString("en-GB", { day: "numeric", month: "short" })} ${time}`;
}

function ReflectPanel({ threadId }: { threadId: string }) {
  const rpc = useRpc<typeof rpcContract>();
  const nav = useBbNavigate();
  const [saved, setSaved] = useState<{ entries: SavedEntry[]; today: number; total: number } | null>(null);
  const [paths, setPaths] = useState<Awaited<ReturnType<typeof rpc.call<"paths">>> | null>(null);
  const [text, setText] = useState("");
  const [result, setResult] = useState<{ rule: string | null; topic: string | null } | null>(null);
  const load = useCallback(() => {
    rpc.call("saved", { limit: 50 }).then(setSaved, () => undefined);
    rpc.call("paths", null).then(setPaths, () => undefined);
  }, [rpc]);
  useEffect(() => {
    load();
  }, [load]);
  useRealtime("reflect-changed", () => load());
  const runTest = async () => {
    if (!text.trim()) return;
    setResult(await rpc.call("test", { text }));
  };
  return (
    <div className="rf-panel">
      <RuleCard threadId={threadId} />

      <section className="rf-pcard">
        <div className="rf-prow">
          <strong className="rf-h">Saved rules</strong>
          <span className="rf-muted">{saved ? `${saved.today} today · ${saved.total} in total` : ""}</span>
        </div>
        {!saved ? (
          <p className="rf-muted">Loading…</p>
        ) : saved.entries.length === 0 ? (
          <p className="rf-muted">Nothing saved yet. Rules you save from a card appear here, newest first.</p>
        ) : (
          <ol className="rf-list">
            {saved.entries.map((e) => (
              <li key={`${e.at}-${e.rule}`} className="rf-item">
                <p className="rf-item-rule">“{e.rule}”</p>
                <p className="rf-item-meta">
                  {e.status === "exists" ? "Already in" : "Saved to"} {TARGET_NAMES[e.target]} · {when(e.at)} ·{" "}
                  <button type="button" className="rf-link" onClick={() => nav.toThread(e.threadId)}>
                    open thread
                  </button>
                </p>
              </li>
            ))}
          </ol>
        )}
      </section>

      <section className="rf-pcard">
        <strong className="rf-h">Test a sentence</strong>
        <textarea
          className="rf-input"
          rows={3}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setResult(null);
          }}
          placeholder="From now on never use the word synergy in my posts"
        />
        <div className="rf-prow">
          <button type="button" className="rf-btn rf-primary" disabled={!text.trim()} onClick={() => void runTest()}>
            Test
          </button>
          {result &&
            (result.rule ? (
              <span className="rf-ok">
                Would show a card: “{result.rule}” ({result.topic === "writing" ? "writing rule" : "general rule"})
              </span>
            ) : (
              <span className="rf-muted">No lasting rule found. Reflect would stay quiet.</span>
            ))}
        </div>
      </section>

      <section className="rf-pcard">
        <strong className="rf-h">Where saves go</strong>
        {!paths ? (
          <p className="rf-muted">Loading…</p>
        ) : (
          <dl className="rf-paths">
            <dt>Watching messages</dt>
            <dd>{paths.enabled ? "On" : "Off"}</dd>
            <dt>Voice profile</dt>
            <dd>
              <code>{paths.voice || "not set"}</code>
              {paths.voice ? ` · section "${paths.voiceSection}" · ${paths.commitVoice ? (paths.pushVoice ? "commit and push" : "commit only") : "no commit"}` : ""}
            </dd>
            <dt>CLAUDE.md</dt>
            <dd>
              <code>{paths.claude || "not set"}</code>
            </dd>
            <dt>Second brain</dt>
            <dd>
              <code>{paths.brain || "not set"}</code>
            </dd>
          </dl>
        )}
        <p className="rf-muted">Change these in Settings, Plugins, Reflect.</p>
      </section>
    </div>
  );
}

/** Opens this plugin's right-panel tab when the Mods hub asks, in the asking window only. */
function windowId(): string {
  const w = window as unknown as { __nbmWindowId?: string };
  if (!w.__nbmWindowId) w.__nbmWindowId = Math.random().toString(36).slice(2) + Date.now().toString(36);
  return w.__nbmWindowId;
}
function PanelOpener() {
  const nav = useBbNavigate();
  const composer = useComposer();
  const threadId = composer.scope.kind === "thread" ? composer.scope.threadId : null;
  useRealtime("open-panel", (payload: unknown) => {
    const p = payload as { threadId?: string; windowId?: string } | null;
    if (!p || p.windowId !== windowId() || !threadId || p.threadId !== threadId) return;
    nav.openThreadPanel({ actionId: "panel", title: "Reflect" });
  });
  return null;
}

export default definePluginApp((app) => {
  app.composer.customize({
    id: "reflect",
    scopes: ["thread"],
    banners: [{ id: "reflect-rule", chrome: "bare", component: ReflectBanner }, { id: "panel-opener", chrome: "bare", component: PanelOpener }],
  });
  app.slots.threadPanelAction({
    id: "panel",
    title: "Reflect",
    icon: "BookmarkCheck",
    layout: "padded",
    component: ({ threadId }) => <ReflectPanel threadId={threadId} />,
  });
});
