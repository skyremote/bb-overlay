import { memo, useEffect, useMemo, useRef, useState } from "react";
import type { MouseEvent } from "react";
import {
  definePluginApp,
  experimental_Icon as Icon,
  experimental_ThreadActionsContextMenu as ThreadContextMenu,
  experimental_ThreadActionsMenu as ThreadMenu,
  experimental_ThreadStatusGlyph as ThreadStatus,
  experimental_usePluginId as usePluginId,
  experimental_useProviders as useProviders,
  experimental_useSidebarThreads as useSidebarThreads,
  experimental_useSidebarThreadSplit as useThreadSplit,
  useBbNavigate, useSdk,
  type PluginSidebarThread, type PluginThreadListProps,
} from "@get-bb/plugin-sdk/app";
import { displayThreads, statusLabel, threadTarget, TOOLS, toolStatus, windowRange } from "./model";
import "./app.css";

export const SIMPLE_THREAD_LIST = "navaigate-simple/rail";
export const SIMPLE_THEME = "plugin:navaigate-simple:navaigate";

function BrandMark() {
  return <svg viewBox="0 0 40 40" fill="none" aria-hidden="true" className="nas-mark">
    <circle cx="20" cy="20" r="15" /><ellipse cx="20" cy="20" rx="7" ry="15" transform="rotate(37 20 20)" /><path d="M5 20h30" /><circle className="nas-mark-point" cx="30" cy="9" r="3" />
  </svg>;
}

export function openGuide(replay = false) {
  window.dispatchEvent(new CustomEvent(replay ? "bb-overlay-guide:replay" : "bb-overlay-guide:open"));
}

/** No RPC, service or polling: read the host's plugin catalogue only while this UI is open. */
export function FeatureSettings({ replay = false, onOpenGuide }: { replay?: boolean; onOpenGuide?(): void }) {
  const sdk = useSdk();
  const [plugins, setPlugins] = useState<{ id: string; status: string }[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setError(null);
    sdk.plugins.list({ signal: controller.signal }).then(result => {
      if (!controller.signal.aborted) setPlugins(result.plugins.map(plugin => ({ id: plugin.id, status: plugin.status })));
    }).catch(() => {
      if (!controller.signal.aborted) setError("Could not load tool status. Try again.");
    });
    return () => controller.abort();
  }, [sdk, revision]);

  async function toggleTool(id: string, enabled: boolean) {
    if (busy) return;
    setBusy(id); setError(null);
    try {
      const result = await (enabled ? sdk.plugins.disable({ pluginId: id }) : sdk.plugins.enable({ pluginId: id }));
      setPlugins(previous => previous?.map(plugin => plugin.id === id ? { id, status: result.status } : plugin) ?? null);
    } catch {
      setError("The tool could not be changed. Its previous setting has been kept. Open its settings to check.");
    } finally { setBusy(null); }
  }

  const guide = plugins?.find(plugin => plugin.id === "bb-overlay-guide");
  return <div className="nas-features-content">
    <p className="nas-intro">A few useful tools, close to the conversation. Each keeps its own settings and saved work.</p>
    {error && <div role="alert" className="nas-error"><p>{error}</p><button className="nas-button" type="button" onClick={() => setRevision(value => value + 1)}>Try again</button></div>}
    {!plugins && !error && <p role="status" className="nas-quiet">Loading tool status…</p>}
    {plugins && <div className="nas-tool-list">{TOOLS.map(tool => {
      const plugin = plugins.find(value => value.id === tool.id);
      const enabled = plugin?.status === "running" || plugin?.status === "starting";
      const switchable = plugin?.status === "running" || plugin?.status === "disabled";
      return <section className="nas-tool" key={tool.id} data-bb-overlay-tour={tool.id}>
        <div className="nas-tool-head"><Icon name={tool.icon} /><div className="nas-tool-title"><h3>{tool.name}</h3><span className="nas-quiet" aria-live="polite">{busy === tool.id ? "Changing…" : toolStatus(plugin?.status)}</span></div>
          {switchable && <button type="button" role="switch" aria-checked={enabled} aria-label={`${enabled ? "Turn off" : "Turn on"} ${tool.name}`} className="nas-switch" disabled={busy !== null} onClick={() => void toggleTool(tool.id, enabled)} />}
        </div><p>{tool.description}</p>
        {plugin && <a className="nas-text-link" href={`/settings/plugins/${encodeURIComponent(tool.id)}`}>Open {tool.name} settings<Icon name="ChevronRight" /></a>}
      </section>;
    })}</div>}
    <section className="nas-guide-section"><h3>Your workspace guide</h3><p>Walk through the real controls at your own pace. You can pause and return whenever you need.</p>
      {guide?.status === "running" ? <div className="nas-inline-actions"><button type="button" className="nas-button" onClick={() => { onOpenGuide?.(); window.setTimeout(() => openGuide(), 0); }}>Open BB Overlay guide<Icon name="ArrowRight" /></button>{replay && <button type="button" className="nas-text-button" onClick={() => openGuide(true)}>Replay guide</button>}</div>
        : plugins && <a className="nas-text-link" href="/settings/plugins/bb-overlay-guide">Open guide settings<Icon name="ChevronRight" /></a>}
    </section>
    <section className="nas-guide-section"><h3>Appearance</h3><p>Choose the NavAIgate Simple theme and BB’s light, dark or system mode.</p><a className="nas-button" href="/settings/appearance" data-bb-overlay-tour="appearance"><Icon name="Sun" />Open Appearance</a></section>
    <p className="nas-footnote">Files, terminal, model controls and Start Side Chat remain BB’s own tools. Folders and other plugins are optional; changing this sidebar does not remove their data.</p>
  </div>;
}

function FeaturesDialog({ onClose }: { onClose(): void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    dialog.showModal();
    return () => { if (dialog.open) dialog.close(); };
  }, []);
  return <dialog className="nas-dialog" ref={ref} aria-labelledby="nas-features-title" onCancel={event => { event.preventDefault(); onClose(); }} onClose={onClose}
    onClick={event => {
      if (event.target !== event.currentTarget) return;
      const rect = event.currentTarget.getBoundingClientRect();
      if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) onClose();
    }}>
    <div className="nas-dialog-heading"><div><h2 id="nas-features-title">Your Simple workspace</h2><p>Keep what helps. Leave room for the work.</p></div><button type="button" className="nas-icon-button" onClick={onClose} aria-label="Close workspace features"><Icon name="X" /></button></div>
    <div className="nas-dialog-scroll"><FeatureSettings onOpenGuide={onClose} /></div>
  </dialog>;
}

const ChatRow = memo(function ChatRow({ thread, selected, provider, project, onNavigate }: {
  thread: PluginSidebarThread; selected: boolean; provider: string; project?: string; onNavigate(): void;
}) {
  const navigate = useBbNavigate();
  const split = useThreadSplit(thread.id);
  const target = threadTarget(thread);
  function open(event: MouseEvent<HTMLAnchorElement>) {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault(); navigate.toThread(thread.id); onNavigate();
  }
  const status = statusLabel(thread);
  return <ThreadContextMenu thread={target}><div className={`nas-chat${selected ? " nas-selected" : ""}`}>
    <a className="nas-chat-link" href={thread.href} data-simple-thread={thread.id} aria-current={selected ? "page" : undefined} aria-label={`${thread.displayTitle}, ${provider}, ${status}`} onClick={open} {...split.splitProps}>
      <span className="nas-status" aria-hidden="true"><ThreadStatus indicator={thread.indicator} size="compact" /></span>
      <span className="nas-chat-text"><span className="nas-chat-name" title={thread.displayTitle}>{thread.displayTitle}</span><span className="nas-chat-meta" title={`${provider} / ${status}${project ? ` / ${project}` : ""}`}>{provider}<span aria-hidden="true"> / </span>{status}{project && <span> / {project}</span>}</span></span>
      {thread.isPinned && <span className="nas-pinned" title="Pinned"><Icon name="Pin" /></span>}
    </a>
    <ThreadMenu thread={target} side="right" align="start" trigger={props => <button {...props} className={`nas-row-menu ${props.className ?? ""}`} aria-label={`Actions for ${thread.displayTitle}`}><Icon name="Ellipsis" /></button>} />
  </div></ThreadContextMenu>;
});

export function SimpleRail({ activeThreadId, activeProjectId, isCompactViewport, onNavigate }: PluginThreadListProps) {
  const { status, threads, projects } = useSidebarThreads();
  const { providers } = useProviders();
  const navigate = useBbNavigate();
  const pluginId = usePluginId();
  const [projectId, setProjectId] = useState<string | null>(activeProjectId);
  const [query, setQuery] = useState("");
  const [focusThreadId, setFocusThreadId] = useState<string | null>(null);
  const [featuresOpen, setFeaturesOpen] = useState(false);
  const [scroll, setScroll] = useState({ top: 0, height: 480 });
  const list = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const instanceId = useRef(`nas-${Math.random().toString(36).slice(2)}`).current;

  useEffect(() => { setProjectId(activeProjectId); }, [activeProjectId]);
  useEffect(() => {
    const element = list.current;
    if (!element) return;
    const measure = () => setScroll(previous => ({ ...previous, height: element.clientHeight || 480 }));
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure); observer.observe(element);
    return () => observer.disconnect();
  }, [status]);
  const filtered = useMemo(() => displayThreads(threads, projects, projectId, query), [threads, projects, projectId, query]);
  useEffect(() => { if (list.current) list.current.scrollTop = 0; setScroll(previous => ({ ...previous, top: 0 })); }, [query, projectId]);
  const providerNames = useMemo(() => new Map(providers.map(provider => [provider.id, provider.displayName])), [providers]);
  const projectNames = useMemo(() => new Map(projects.map(project => [project.id, project.name])), [projects]);
  const rowHeight = isCompactViewport ? 68 : 64;
  const visibleRange = windowRange(filtered.length, scroll.top, scroll.height, rowHeight);

  useEffect(() => {
    if (!focusThreadId || !list.current) return;
    const anchor = [...list.current.querySelectorAll<HTMLAnchorElement>("a[data-simple-thread]")].find(element => element.dataset.simpleThread === focusThreadId);
    if (anchor) { anchor.focus(); setFocusThreadId(null); }
  }, [focusThreadId, visibleRange.start, visibleRange.end]);

  function newChat() {
    navigate.toCompose({ ...(projectId ? { projectId } : {}), focusPrompt: true }); onNavigate();
  }
  return <section className="nas-rail" aria-label="NavAIgate Simple chats" data-bb-overlay-simple={pluginId}>
    <div className="nas-brand"><BrandMark /><div><strong>NavAIgate</strong><span>Simple workspace</span></div></div>
    <div className="nas-project" data-bb-overlay-tour="project"><Icon name="Folder" /><label className="nas-sr" htmlFor={`${instanceId}-project`}>Project</label><select id={`${instanceId}-project`} value={projectId ?? ""} onChange={event => {
      const id = event.target.value || null; setProjectId(id);
      if (id) { navigate.toProject(id); onNavigate(); }
    }}><option value="">All projects</option>{projects.map(project => <option value={project.id} key={project.id}>{project.name}</option>)}</select><Icon name="ChevronDown" /></div>
    <button type="button" className="nas-new-chat nas-button" onClick={newChat} data-bb-overlay-tour="new-chat"><Icon name="Plus" />New chat</button>
    <label className="nas-search"><Icon name="Search" /><span className="nas-sr">Filter chats</span><input ref={search} type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Filter chats" autoComplete="off" /></label>
    <div className="nas-list-heading"><h2>Recent chats</h2><span aria-live="polite">{status === "ready" ? filtered.length : ""}</span></div>
    <div className="nas-chat-list" ref={list} data-bb-overlay-tour="chats" role="list" tabIndex={0} aria-label="Recent chats; use arrow keys to move between chats" onKeyDown={event => {
      if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key) || !filtered.length) return;
      const target = event.target as HTMLElement;
      const currentId = target.closest<HTMLAnchorElement>("a[data-simple-thread]")?.dataset.simpleThread;
      if (target !== event.currentTarget && !currentId) return;
      const currentIndex = filtered.findIndex(thread => thread.id === currentId);
      const index = event.key === "Home" ? 0 : event.key === "End" ? filtered.length - 1 : Math.max(0, Math.min(filtered.length - 1, currentIndex + (event.key === "ArrowDown" ? 1 : -1)));
      event.preventDefault();
      const element = list.current;
      if (element) {
        const top = index * rowHeight;
        if (top < element.scrollTop || top + rowHeight > element.scrollTop + element.clientHeight) {
          element.scrollTop = top;
          setScroll(previous => ({ ...previous, top }));
        }
      }
      setFocusThreadId(filtered[index]!.id);
    }} aria-busy={status === "loading"} onScroll={event => setScroll(previous => ({ ...previous, top: event.currentTarget.scrollTop }))}>
      {status === "loading" && <div className="nas-loading" role="status"><span>Loading chats…</span>{[0, 1, 2, 3].map(value => <div className="nas-skeleton" key={value} aria-hidden="true" />)}</div>}
      {status === "error" && <div className="nas-empty" role="alert"><Icon name="CircleAlert" /><h3>Chats could not load.</h3><p>Check BB’s connection. Your chats have not been changed.</p></div>}
      {status === "ready" && !filtered.length && <div className="nas-empty"><Icon name={query ? "Search" : "MessageSquare"} /><h3>{query ? "No chats match." : "A clear place to start."}</h3><p>{query ? "Try another word, or clear the filter." : "Start a chat in this project. BB keeps your files and tools close to the conversation."}</p>{query ? <button type="button" className="nas-button" onClick={() => { setQuery(""); search.current?.focus(); }}>Clear filter</button> : <button type="button" className="nas-button" onClick={newChat}>Start a chat<Icon name="ArrowRight" /></button>}</div>}
      {status === "ready" && filtered.length > 0 && <div className="nas-list-height" style={{ height: filtered.length * rowHeight }}>
        {filtered.slice(visibleRange.start, visibleRange.end).map((thread, index) => <div className="nas-virtual-row" role="listitem" aria-setsize={filtered.length} aria-posinset={visibleRange.start + index + 1} key={thread.id} style={{ top: (visibleRange.start + index) * rowHeight, height: rowHeight }}><ChatRow thread={thread} selected={thread.id === activeThreadId} provider={providerNames.get(thread.providerId) ?? thread.providerId} project={projectId ? undefined : projectNames.get(thread.projectId)} onNavigate={onNavigate} /></div>)}
      </div>}
    </div>
    <footer className="nas-footer"><button type="button" className="nas-text-button" onClick={() => setFeaturesOpen(true)} data-bb-overlay-tour="features"><Icon name="SlidersHorizontal" />Features</button><a className="nas-text-link" href="/settings/appearance" data-bb-overlay-tour="appearance" onClick={() => onNavigate()}><Icon name="Sun" />Appearance</a></footer>
    {featuresOpen && <FeaturesDialog onClose={() => setFeaturesOpen(false)} />}
  </section>;
}

export default definePluginApp(app => {
  app.slots.experimental_threadList({ id: "rail", title: "NavAIgate Simple", description: "A quiet project picker and real BB chats, with BB's own navigation rail.", component: SimpleRail });
  app.slots.settingsSection({ id: "workspace", title: "Your Simple workspace", component: () => <FeatureSettings replay /> });
});
