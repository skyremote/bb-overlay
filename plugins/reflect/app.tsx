// Reflect frontend: a card above the thread composer when the last message
// held a lasting rule: a red dot, "That sounds like a lasting rule. Save it?",
// the tidied rule in quotes, a small Reflect label, and the save buttons for
// each destination that is set up.
import { useCallback, useEffect, useRef, useState } from "react";
import { definePluginApp, useComposer, useRealtime, useRealtimeConnectionState, useRpc } from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import type { Candidate, rpcContract } from "./server";
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

export default definePluginApp((app) => {
  app.composer.customize({
    id: "reflect",
    scopes: ["thread"],
    banners: [{ id: "reflect-rule", chrome: "bare", component: ReflectBanner }],
  });
});
