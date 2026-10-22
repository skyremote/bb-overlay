// Cache Clock — frontend. A banner above the thread composer with the cache
// countdown, Keep warm and Hand off; a composer popup and a plus-menu row for
// the manual handoff; a palette command that opens the same popup.
import { useCallback, useEffect, useRef, useState } from "react";
import {
  definePluginApp,
  experimental_copyToClipboard,
  useBbNavigate,
  useComposer,
  useRealtime,
  useRpc,
} from "@get-bb/plugin-sdk/app";
import type { rpcContract } from "./server";
import {
  formatCountdown,
  formatTokens,
  fractionLeft,
  handoffPrompt,
  nextPingAt,
  remainingMs,
  ttlLabel,
  type ClockStatus,
} from "./model";
import "./clock.css";

const CHANGED = "clock-changed";
const POPUP_ID = "handoff";

function useThreadId(): string | null {
  const composer = useComposer();
  return composer.scope.kind === "thread" ? composer.scope.threadId : null;
}

/** Server status for one thread, refreshed on realtime signals and every 30 s. */
function useClock(threadId: string | null) {
  const rpc = useRpc<typeof rpcContract>();
  const rpcRef = useRef(rpc);
  rpcRef.current = rpc;
  const [data, setData] = useState<ClockStatus | null>(null);
  const [offset, setOffset] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const apply = useCallback((next: ClockStatus) => {
    setData(next);
    setOffset(next.now - Date.now());
    setError(null);
  }, []);
  const refresh = useCallback(() => {
    if (!threadId) return;
    rpcRef.current.call("status", { threadId }).then(apply, (e: unknown) =>
      setError(e instanceof Error ? e.message : String(e)),
    );
  }, [threadId, apply]);
  useEffect(() => {
    setData(null);
    refresh();
    const timer = setInterval(refresh, 30_000);
    return () => clearInterval(timer);
  }, [refresh]);
  useRealtime(CHANGED, (payload: unknown) => {
    const id = (payload as { threadId?: string } | null)?.threadId;
    if (!id || id === threadId) refresh();
  });
  const call = useCallback(
    async (method: "setKeepWarm" | "requestHandoff" | "clearHandoff", extra: { on?: boolean } = {}) => {
      if (!threadId) return;
      try {
        const input = method === "setKeepWarm" ? { threadId, on: Boolean(extra.on) } : { threadId };
        apply(await rpcRef.current.call(method, input as never));
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    },
    [threadId, apply],
  );
  return { data, offset, error, refresh, call };
}

function useNow(offset: number, active: boolean): number {
  const [now, setNow] = useState(() => Date.now() + offset);
  useEffect(() => {
    setNow(Date.now() + offset);
    if (!active) return;
    const timer = setInterval(() => setNow(Date.now() + offset), 1000);
    return () => clearInterval(timer);
  }, [offset, active]);
  return now;
}

function ClockIcon() {
  return (
    <svg className="cc-icon" viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="8" cy="8" r="6.25" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <path d="M8 4.6V8l2.3 1.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

/** The handoff states, shared by the banner and the popup. */
function HandoffBody({
  threadId,
  data,
  call,
  onClose,
  compact,
}: {
  threadId: string;
  data: ClockStatus;
  call: ReturnType<typeof useClock>["call"];
  onClose?: () => void;
  compact?: boolean;
}) {
  const nav = useBbNavigate();
  const [copied, setCopied] = useState(false);
  const handoff = data.handoff;
  if (!handoff) {
    return (
      <div className="cc-handoff">
        <p className="cc-line">
          This thread's own agent writes a full brief: the goal, decisions, every file with its path, the skills
          and links used, where things stand and the exact next steps. You then open a new thread with it and
          press send yourself.
        </p>
        <div className="cc-actions">
          <button className="cc-btn cc-primary" onClick={() => void call("requestHandoff")}>
            Write the handoff brief
          </button>
          {onClose && (
            <button className="cc-btn" onClick={onClose}>
              Cancel
            </button>
          )}
        </div>
      </div>
    );
  }
  if (handoff.status === "requested") {
    return (
      <div className="cc-handoff">
        <p className="cc-line">
          <span className="cc-spinner" aria-hidden="true" /> Writing the handoff brief in this thread. It appears here
          when the reply finishes.
        </p>
        <div className="cc-actions">
          <button className="cc-btn" onClick={() => void call("clearHandoff")}>
            Dismiss
          </button>
        </div>
      </div>
    );
  }
  if (handoff.status === "failed") {
    return (
      <div className="cc-handoff">
        <p className="cc-line cc-warn">{handoff.error ?? "The handoff brief could not be collected."}</p>
        <div className="cc-actions">
          <button className="cc-btn cc-primary" onClick={() => void call("requestHandoff")}>
            Try again
          </button>
          <button className="cc-btn" onClick={() => void call("clearHandoff")}>
            Dismiss
          </button>
        </div>
      </div>
    );
  }
  const brief = handoff.brief ?? "";
  return (
    <div className="cc-handoff">
      <p className="cc-line">
        <strong>Handoff brief ready</strong> · {brief.split(/\s+/).filter(Boolean).length} words. Review it in the new
        thread before you send.
      </p>
      {!compact && <pre className="cc-brief">{brief}</pre>}
      <div className="cc-actions">
        <button
          className="cc-btn cc-primary"
          onClick={() => {
            nav.toCompose({ initialPrompt: handoffPrompt(threadId, brief), focusPrompt: true });
            onClose?.();
          }}
        >
          Open new thread with this brief
        </button>
        <button
          className="cc-btn"
          onClick={() => {
            void experimental_copyToClipboard({ text: handoffPrompt(threadId, brief) }).then((ok) => {
              setCopied(ok);
              setTimeout(() => setCopied(false), 2000);
            });
          }}
        >
          {copied ? "Copied" : "Copy brief"}
        </button>
        <button className="cc-btn" onClick={() => void call("clearHandoff")}>
          Dismiss
        </button>
      </div>
    </div>
  );
}

function hiddenKey(threadId: string) {
  return `cache-clock:hidden:${threadId}`;
}

function CacheBanner() {
  const threadId = useThreadId();
  const composer = useComposer();
  const { data, offset, call, refresh } = useClock(threadId);
  const running = composer.isRunning || Boolean(data?.running);
  const live = Boolean(data && data.supported && !running && data.lastReplyAt !== null);
  const now = useNow(offset, live);
  const [hiddenFor, setHiddenFor] = useState<string | null>(null);
  const [showHandoff, setShowHandoff] = useState(false);

  // Refetch when a turn starts or ends in this composer.
  const wasRunning = useRef(composer.isRunning);
  useEffect(() => {
    if (wasRunning.current !== composer.isRunning) refresh();
    wasRunning.current = composer.isRunning;
  }, [composer.isRunning, refresh]);

  useEffect(() => {
    if (!threadId) return;
    try {
      setHiddenFor(localStorage.getItem(hiddenKey(threadId)));
    } catch {
      setHiddenFor(null);
    }
  }, [threadId]);

  if (!threadId || !data || !data.supported) return null;
  const handoffActive = data.handoff !== null || showHandoff;
  if (!live && !handoffActive) return null;
  const replyKey = String(data.lastReplyAt ?? "none");
  if (hiddenFor === replyKey && !handoffActive) return null;

  const left = remainingMs(data.expiresAt, now);
  const warm = left > 0;
  const fraction = fractionLeft(data.expiresAt, data.ttlMinutes, now);
  const tokens = formatTokens(data.usedTokens);
  const kw = data.keepWarm;
  const keeping = Boolean(kw?.enabled);
  const next = nextPingAt(data.lastReplyAt, data.ttlMinutes);

  const hide = () => {
    try {
      localStorage.setItem(hiddenKey(threadId), replyKey);
    } catch {
      /* private mode: hide for this session only */
    }
    setHiddenFor(replyKey);
    setShowHandoff(false);
  };

  return (
    <section className={"cc-bar " + (warm ? "cc-is-warm" : "cc-is-cold")} aria-label="Cache clock">
      {live && (
        <>
          <div className="cc-row">
            <span className={"cc-state " + (warm ? "cc-green" : "cc-amber")}>
              <ClockIcon />
              {warm ? "Cache warm" : "Cache cold"}
              {warm && <strong className="cc-time">{formatCountdown(left)}</strong>}
            </span>
            {warm && (
              <span className="cc-track" aria-hidden="true">
                <span className="cc-fill" style={{ width: `${Math.round(fraction * 100)}%` }} />
              </span>
            )}
            <span className="cc-spacer" />
            <button className="cc-btn" onClick={() => setShowHandoff((v) => !v)} aria-expanded={showHandoff}>
              Hand off
            </button>
            <button className="cc-btn" onClick={() => void call("setKeepWarm", { on: !keeping })}>
              {keeping ? "Stop keeping warm" : "Keep warm"}
            </button>
            <button className="cc-btn cc-quiet" onClick={hide}>
              Hide
            </button>
          </div>
          <p className="cc-line">
            {warm
              ? `${ttlLabel(data.ttlMinutes)} cache, counted from the last reply. Reply now and ${tokens} tokens cost about a tenth of the full price.`
              : `The cache has most likely expired. The next message re-reads all ${tokens} tokens at full price.`}
          </p>
          {keeping && kw && (
            <p className="cc-line cc-blue">
              Keeping warm · {kw.pings === 0 ? "first ping" : `ping ${kw.pings}`} ·{" "}
              {next !== null && next > now ? `next in ${formatCountdown(next - now)}` : "due now"}
              {kw.lastPingCachedTokens !== null && ` · last ping read ${formatTokens(kw.lastPingCachedTokens)} cached tokens`}
            </p>
          )}
          {!keeping && kw && kw.stoppedReason && kw.stoppedReason !== "manual" && (
            <p className="cc-line cc-muted">
              Keep warm stopped {kw.stoppedReason === "user-message" ? "when you sent a message" : kw.stoppedReason === "time-limit" ? `after ${data.keepWarmMaxHours} hours` : "because the thread closed"}.
            </p>
          )}
          <p className="cc-line cc-small">
            Keep warm sends a short ping message, visible in the chat, about two minutes before expiry. It re-reads the
            chat from cache for a small part of the price and restarts the clock. It stops on your next message or after{" "}
            {data.keepWarmMaxHours} hours.
          </p>
        </>
      )}
      {handoffActive && (
        <div className={live ? "cc-divider" : ""}>
          <HandoffBody
            threadId={threadId}
            data={data}
            call={call}
            compact
            onClose={data.handoff ? undefined : () => setShowHandoff(false)}
          />
        </div>
      )}
    </section>
  );
}

function HandoffPopup() {
  const threadId = useThreadId();
  const composer = useComposer();
  const { data, call, error } = useClock(threadId);
  const close = () => composer.experimental_closePopup();
  if (!threadId) return <div className="cc-popup"><p className="cc-line">Open a thread to hand it off.</p></div>;
  return (
    <div className="cc-popup">
      <h3 className="cc-title">Hand off to a new thread</h3>
      {error && <p className="cc-line cc-warn">{error}</p>}
      {!data ? (
        <p className="cc-line">Loading…</p>
      ) : (
        <HandoffBody threadId={threadId} data={data} call={call} onClose={close} />
      )}
    </div>
  );
}

export default definePluginApp((app) => {
  app.composer.customize({
    id: "cache-clock",
    scopes: ["thread"],
    banners: [{ id: "clock", chrome: "bare", component: CacheBanner }],
    plusMenu: [
      {
        id: "handoff",
        label: "Hand off to a new thread",
        icon: "ArrowRightLeft",
        description: "Have this thread write a full brief, then open a new thread with it",
        run: ({ composer }) => {
          composer.experimental_openPopup(POPUP_ID);
        },
      },
    ],
    experimental_popups: [{ id: POPUP_ID, label: "Hand off to a new thread", component: HandoffPopup }],
  });
  app.composer.experimental_registerCommand({
    id: "handoff",
    title: "Hand off to a new thread",
    run: ({ composer }) => {
      composer.experimental_openPopup(POPUP_ID);
    },
  });
});
