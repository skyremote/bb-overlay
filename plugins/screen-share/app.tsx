// bb-plugin-screen-share frontend. One app overlay per window owns the masker
// and the live on/off state; the composer banner, + menu row and palette
// command read and flip that same state through the server, so every bb
// window and remote client changes together.
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import {
  definePluginApp,
  useRealtime,
  useRealtimeConnectionState,
  useRpc,
  useSdk,
  useSettings,
  experimental_usePluginId,
  useBbNavigate,
  useComposer,
} from "@get-bb/plugin-sdk/app";
import type { rpcContract, ScreenShareState } from "./server";
import { DEFAULT_COMPANIES, DEFAULT_KNOWN_NAMES, detect, mergeMatches, parseList, type DetectOptions } from "./detect";
import { createMasker, highlightSupported, type Masker } from "./masker";
import "./styles.css";

type Rpc = ReturnType<typeof useRpc<typeof rpcContract>>;

// ---- shared per-window store -------------------------------------------------
let current: ScreenShareState | null = null;
let rpcRef: Rpc | null = null;
const listeners = new Set<() => void>();
function setState(next: ScreenShareState) {
  if (current && current.updatedAt > next.updatedAt) return;
  current = next;
  for (const l of listeners) l();
}
function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}
function useScreenShare(): ScreenShareState | null {
  return useSyncExternalStore(subscribe, () => current, () => current);
}
async function setEnabled(enabled: boolean, source: string) {
  if (!rpcRef) return;
  setState(await rpcRef.call("state_set", { enabled, source }));
}
async function toggle(source: string) {
  await setEnabled(!(current?.enabled ?? false), source);
}

// ---- masker lifetime -----------------------------------------------------------
let masker: Masker | null = null;
function stopMasker() {
  masker?.dispose();
  masker = null;
  document.documentElement.removeAttribute("data-screen-share");
}
function applyMasker(enabled: boolean, options: DetectOptions) {
  if (!enabled) {
    stopMasker();
    return;
  }
  document.documentElement.setAttribute("data-screen-share", "on");
  if (masker) {
    masker.setOptions(options);
    return;
  }
  masker = createMasker(document.body, options);
}

function optionsFrom(values: Record<string, unknown> | undefined): DetectOptions {
  const known = parseList(values?.knownNames);
  const companies = parseList(values?.companies);
  return {
    knownNames: known.length > 0 ? known : DEFAULT_KNOWN_NAMES,
    companies: companies.length > 0 ? companies : DEFAULT_COMPANIES,
    maskCompanies: values?.maskCompanies === true,
    aggressiveNames: values?.aggressiveNames !== false,
  };
}

/** Mounted once per window: syncs state from the server and drives the masker. */
function ScreenShareController() {
  const rpc = useRpc<typeof rpcContract>();
  const connection = useRealtimeConnectionState();
  const { values } = useSettings();
  const state = useScreenShare();
  const seenConnected = useRef(false);
  rpcRef = rpc;

  const options = useMemo(() => optionsFrom(values as Record<string, unknown> | undefined), [values]);

  useEffect(() => {
    rpc.call("state_get").then(setState, () => undefined);
  }, [rpc]);

  // Signals are not replayed: reconcile after every reconnect (phone waking up, laptop lid).
  useEffect(() => {
    if (connection !== "connected") return;
    if (seenConnected.current) rpc.call("state_get").then(setState, () => undefined);
    seenConnected.current = true;
  }, [connection, rpc]);

  useRealtime("state", (payload) => {
    const p = payload as Partial<ScreenShareState> | null;
    if (p && typeof p.enabled === "boolean" && typeof p.updatedAt === "number") {
      setState({ enabled: p.enabled, updatedAt: p.updatedAt, source: String(p.source ?? "") });
    }
  });

  useEffect(() => {
    applyMasker(state?.enabled === true, options);
  }, [state?.enabled, options]);

  useEffect(() => () => stopMasker(), []);
  return null;
}

/** The strip above the composer: dot, label, explanation, Turn off. */
function ScreenShareBanner() {
  const state = useScreenShare();
  if (!state?.enabled) return null;
  return (
    <div className="ssm-banner" data-screen-share-skip="">
      <span className="ssm-dot" aria-hidden="true" />
      <span className="ssm-label">Screen-share mode:</span>
      <span className="ssm-detail">
        emails, phones, amounts and names hidden on screen
        {highlightSupported() ? "" : " (this browser cannot paint the masks; update it before sharing)"}
      </span>
      <button type="button" className="ssm-off" onClick={() => void setEnabled(false, "banner")}>
        Turn off
      </button>
    </div>
  );
}

const PREVIEW_TEXT =
  "Maya Lopez (maya@northwind.example, +44 20 7946 0958) asked for a call back about the $48,000 renewal. Invoice to IBAN GB33 BUKB 2020 1555 5555 55.";

/** The sample sentence with each detected span drawn as a grey bar. */
function Preview({ options, on }: { options: DetectOptions; on: boolean }) {
  const parts = useMemo(() => {
    const matches = mergeMatches(detect(PREVIEW_TEXT, options));
    const out: { text: string; masked: boolean }[] = [];
    let at = 0;
    for (const m of matches) {
      if (m.start > at) out.push({ text: PREVIEW_TEXT.slice(at, m.start), masked: false });
      out.push({ text: PREVIEW_TEXT.slice(m.start, m.end), masked: true });
      at = m.end;
    }
    if (at < PREVIEW_TEXT.length) out.push({ text: PREVIEW_TEXT.slice(at), masked: false });
    return out;
  }, [options]);
  return (
    <p className="ssm-preview">
      {parts.map((p, i) =>
        p.masked && on ? (
          <span key={i} className="ssm-bar" aria-label="hidden">
            {p.text}
          </span>
        ) : (
          <span key={i} className={p.masked ? "ssm-would" : undefined}>
            {p.text}
          </span>
        ),
      )}
    </p>
  );
}

function ScreenSharePanel() {
  const rpc = useRpc<typeof rpcContract>();
  const sdk = useSdk();
  const pluginId = experimental_usePluginId();
  const { values } = useSettings();
  const state = useScreenShare();
  const v = (values ?? {}) as Record<string, unknown>;
  const [names, setNames] = useState<string | null>(null);
  const [companies, setCompanies] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const options = useMemo(() => optionsFrom(v), [values]);
  const on = state?.enabled === true;

  useEffect(() => {
    if (!state) rpc.call("state_get").then(setState, () => undefined);
  }, [rpc, state]);

  const flip = async (enabled: boolean) => setState(await rpc.call("state_set", { enabled, source: "panel" }));
  const save = async (patch: Record<string, string | boolean>) => {
    setSaving(true);
    try {
      await sdk.plugins.updateSettings({ pluginId, values: patch });
      setSaved(true);
      setTimeout(() => setSaved(false), 1800);
    } finally {
      setSaving(false);
    }
  };
  return (
    <div className="ssm-panel">
      <div className={"ssm-card ssm-hero" + (on ? " ssm-on" : "")}>
        <button
          type="button"
          role="switch"
          aria-checked={on}
          className={"ssm-switch" + (on ? " ssm-switch-on" : "")}
          onClick={() => void flip(!on)}
        >
          <span className="ssm-knob" />
        </button>
        <div className="ssm-hero-text">
          <strong>{on ? "Screen-share mode is on" : "Screen-share mode is off"}</strong>
          <span>
            {on
              ? "On for every screen · masks names, emails, phones, amounts, IBANs, VAT numbers"
              : "Turn it on before you share your screen, record or demo a chat"}
          </span>
          <span className="ssm-hint">Shortcut Cmd+Alt+S, or send /screenshare in any chat</span>
        </div>
      </div>

      <div className="ssm-card">
        <strong className="ssm-h">Preview</strong>
        <Preview options={options} on />
        <span className="ssm-hint">Copy and paste still gives the real text. The chat box is never masked.</span>
      </div>

      <div className="ssm-card">
        <strong className="ssm-h">Always hide these people</strong>
        <textarea
          className="ssm-input"
          rows={4}
          value={names ?? String(v.knownNames ?? "")}
          onChange={(e) => setNames(e.target.value)}
          placeholder="One per line"
        />
        <strong className="ssm-h">Company names</strong>
        <textarea
          className="ssm-input"
          rows={3}
          value={companies ?? String(v.companies ?? "")}
          onChange={(e) => setCompanies(e.target.value)}
          placeholder="One per line"
        />
        <label className="ssm-check">
          <input type="checkbox" checked={v.maskCompanies === true} onChange={(e) => void save({ maskCompanies: e.target.checked })} />
          Hide company names too
        </label>
        <label className="ssm-check">
          <input type="checkbox" checked={v.aggressiveNames !== false} onChange={(e) => void save({ aggressiveNames: e.target.checked })} />
          Hide any capitalised pair of words (safer, hides a little more than needed)
        </label>
        <div className="ssm-row">
          <button
            type="button"
            className="ssm-btn ssm-primary"
            disabled={saving || (names === null && companies === null)}
            onClick={() =>
              void save({
                ...(names !== null ? { knownNames: names } : {}),
                ...(companies !== null ? { companies } : {}),
              }).then(() => {
                setNames(null);
                setCompanies(null);
              })
            }
          >
            Save lists
          </button>
          {saved && <span className="ssm-hint">Saved</span>}
        </div>
      </div>
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
    nav.openThreadPanel({ actionId: "panel", title: "Screen share" });
  });
  return null;
}

export default definePluginApp((app) => {
  app.slots.experimental_appOverlay({ id: "controller", component: ScreenShareController });

  // Belt and braces: when the frontend generation is torn down, nothing stays painted.
  app.contentScripts.register({
    id: "masker-cleanup",
    mount: ({ signal }) => {
      signal.addEventListener("abort", stopMasker, { once: true });
      return () => stopMasker();
    },
  });

  app.composer.customize({
    id: "screen-share",
    banners: [{ id: "status", chrome: "bare", component: ScreenShareBanner }, { id: "panel-opener", chrome: "bare", component: PanelOpener }],
    plusMenu: [
      {
        id: "toggle",
        label: "Screen-share mode",
        icon: "EyeOff",
        description: "Hide names, emails, phone numbers and amounts on every screen, or show them again",
        run: () => toggle("plus-menu"),
      },
    ],
  });

  app.slots.threadPanelAction({
    id: "panel",
    title: "Screen share",
    icon: "EyeOff",
    layout: "padded",
    component: () => <ScreenSharePanel />,
  });

  app.commands.register({
    id: "toggle",
    title: "Screen-share mode: turn on or off",
    defaultShortcut: { key: "s", mod: true, alt: true },
    run: () => toggle("palette"),
  });
});
