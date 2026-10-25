// The Skin button in the sidebar footer: every skin one click away, NavMotion first.
// The palette is server-side, so a pick changes bb on every device at once.
import { useCallback, useEffect, useState } from "react";
import { experimental_usePluginId, useSdk } from "@get-bb/plugin-sdk/app";

type Catalog = Awaited<ReturnType<ReturnType<typeof useSdk>["theme"]["catalog"]>>;
type Row = { id: string; name: string; note?: string };

const BUILT_IN: Row[] = [
  { id: "default", name: "Default", note: "bb, pure white" },
  { id: "nord", name: "Nord" },
  { id: "dracula", name: "Dracula" },
  { id: "solarized", name: "Solarized" },
  { id: "gruvbox", name: "Gruvbox" },
  { id: "catppuccin", name: "Catppuccin" },
];

const SWATCH: Record<string, string> = {
  dots: "radial-gradient(circle, rgb(22 23 26 / .5) 0 .8px, transparent 1.2px) 0 0 / 4px 4px, #F3F2EF",
  live: "repeating-linear-gradient(170deg, transparent 0 2.5px, rgb(22 23 26 / .38) 2.5px 3.3px), #F3F2EF",
  tunnel: "radial-gradient(circle at 50% 50%, transparent 0 3px, rgb(255 255 255 / .55) 3px 3.8px, transparent 3.8px 6px, rgb(255 255 255 / .3) 6px 6.8px, transparent 6.8px), #0D0E10",
  "plugin:navaigate-skin:navaigate": "radial-gradient(circle at 50% 50%, #D4A354 0 2.6px, transparent 3px), #FBFAF8",
  "plugin:navaigate-workspace:navaigate": "radial-gradient(circle at 50% 50%, #D4A354 0 2.6px, transparent 3px), #FBFAF8",
  "plugin:chatgpt-skin:chatgpt": "linear-gradient(90deg, #FFFFFF 50%, #F2F2F2 50%)",
  default: "linear-gradient(135deg, #FFFFFF 50%, #151515 50%)",
  nord: "linear-gradient(135deg, #ECEFF4 50%, #2E3440 50%)",
  dracula: "linear-gradient(135deg, #BD93F9 50%, #282A36 50%)",
  solarized: "linear-gradient(135deg, #FDF6E3 50%, #268BD2 50%)",
  gruvbox: "linear-gradient(135deg, #FABD2F 50%, #282828 50%)",
  catppuccin: "linear-gradient(135deg, #EFF1F5 50%, #8839EF 50%)",
};

function swatchFor(id: string, pluginId: string) {
  const ours = id.startsWith(`plugin:${pluginId}:`) ? id.slice(`plugin:${pluginId}:`.length) : null;
  return SWATCH[ours ?? id] ?? "linear-gradient(135deg, var(--muted) 50%, var(--muted-foreground) 50%)";
}

function openAppearance() {
  window.history.pushState({}, "", "/settings/appearance");
  window.dispatchEvent(new PopStateEvent("popstate", { state: {} }));
}

export function SkinMenu({ dismiss }: { dismiss: () => void }) {
  const sdk = useSdk();
  const pluginId = experimental_usePluginId();
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [more, setMore] = useState(false);

  const load = useCallback(() => {
    sdk.theme.catalog().then(
      (c) => {
        setCatalog(c);
        setError(null);
      },
      (e: unknown) => setError(e instanceof Error ? e.message : String(e)),
    );
  }, [sdk]);
  useEffect(() => load(), [load]);

  const pick = async (themeId: string) => {
    if (!catalog || pending) return;
    setPending(themeId);
    try {
      await sdk.theme.set({ themeId, faviconColor: catalog.active.faviconColor });
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPending(null);
    }
  };

  const active = catalog?.active.themeId ?? null;
  const ours: Row[] = (catalog?.plugins ?? []).filter((p) => p.pluginId === pluginId).map((p) => ({ id: p.id, name: p.name }));
  const yours: Row[] = [
    ...(catalog?.plugins ?? []).filter((p) => p.pluginId !== pluginId).map((p) => ({ id: p.id, name: p.name })),
    ...(catalog?.custom ?? []).map((id) => ({ id, name: id, note: "custom" })),
  ];
  const builtIns = more ? BUILT_IN : BUILT_IN.filter((b) => b.id === "default" || b.id === active);

  const row = (r: Row) => {
    const on = r.id === active;
    return (
      <button
        key={r.id}
        type="button"
        className="nm-skin-row"
        data-active={on || undefined}
        disabled={!!pending}
        onClick={() => void pick(r.id)}
        aria-pressed={on}
      >
        <span className="nm-skin-swatch" style={{ background: swatchFor(r.id, pluginId) }} />
        <span className="nm-skin-name">{r.name}</span>
        {r.note ? <span className="nm-skin-note">{r.note}</span> : null}
        <span className="nm-skin-state">{pending === r.id ? "…" : on ? "On" : ""}</span>
      </button>
    );
  };

  return (
    <div className="nm-skin-menu" role="group" aria-label="Skin">
      <div className="nm-skin-head">
        <span>Skin</span>
        <button type="button" className="nm-skin-close" onClick={dismiss} aria-label="Close">
          ×
        </button>
      </div>
      {error ? <div className="nm-skin-error">{error}</div> : null}
      {!catalog && !error ? <div className="nm-skin-empty">Loading skins…</div> : null}
      {ours.length ? (
        <div className="nm-skin-group">
          <div className="nm-skin-label">NavMotion</div>
          {ours.map(row)}
        </div>
      ) : null}
      {yours.length ? (
        <div className="nm-skin-group">
          <div className="nm-skin-label">Your skins</div>
          {yours.map(row)}
        </div>
      ) : null}
      {catalog ? (
        <div className="nm-skin-group">
          <div className="nm-skin-label">bb palettes</div>
          {builtIns.map(row)}
          {!more ? (
            <button type="button" className="nm-skin-more" onClick={() => setMore(true)}>
              Show all bb palettes
            </button>
          ) : null}
        </div>
      ) : null}
      <button type="button" className="nm-skin-foot" onClick={() => { dismiss(); openAppearance(); }}>
        Settings › Appearance
      </button>
    </div>
  );
}
