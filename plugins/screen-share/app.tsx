// bb-plugin-screen-share frontend. One app overlay per window owns the masker
// and the live on/off state; the composer banner, + menu row and palette
// command read and flip that same state through the server, so every bb
// window and remote client changes together.
import { useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import {
  definePluginApp,
  useRealtime,
  useRealtimeConnectionState,
  useRpc,
  useSettings,
} from "@get-bb/plugin-sdk/app";
import type { rpcContract, ScreenShareState } from "./server";
import { DEFAULT_COMPANIES, DEFAULT_KNOWN_NAMES, parseList, type DetectOptions } from "./detect";
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
    banners: [{ id: "status", chrome: "bare", component: ScreenShareBanner }],
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

  app.commands.register({
    id: "toggle",
    title: "Screen-share mode: turn on or off",
    defaultShortcut: { key: "s", mod: true, alt: true },
    run: () => toggle("palette"),
  });
});
