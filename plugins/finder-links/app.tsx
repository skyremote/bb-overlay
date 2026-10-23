// bb-plugin-finder-links frontend. One overlay per window watches chat replies
// for inline-code paths and bb's own file links, asks the server which really
// exist, and makes only those clickable:
//   - a path in `code`   -> shows it in Finder on this Mac
//   - a broken file link -> opens bb's preview on the file it actually meant
// Finder always opens on this Mac, including when bb is viewed remotely in a browser.
import { useEffect, useRef } from "react";
import { definePluginApp, useBbContext, useBbNavigate, useRpc } from "@get-bb/plugin-sdk/app";
import type { Resolved, rpcContract } from "./server";
import { classify } from "./lib/paths";
import "./styles.css";

type Rpc = ReturnType<typeof useRpc<typeof rpcContract>>;
type Nav = ReturnType<typeof useBbNavigate>;

// bb only accepts a preview request from inside a thread view, so each thread's
// composer mounts a hidden opener and registers its navigator here by thread id.
const threadNavs = new Map<string, Nav>();

const MESSAGE = "[data-markdown-preview]";
const ATTR = "data-fl";

interface Mark {
  kind: "code" | "link";
  text: string;
  href: string | null;
  resolved: Resolved | null;
}

interface Pending {
  el: Element;
  kind: "code" | "link";
  text: string;
  href: string | null;
  threadId: string | null;
  candidates: string[];
  bases: string[];
  cacheKey: string;
}


function threadIdOf(el: Element): string | null {
  const row = el.closest("[data-timeline-row-id]")?.getAttribute("data-timeline-row-id") ?? "";
  const id = row.split(":")[0] ?? "";
  return /^thr_[a-zA-Z0-9_-]+$/.test(id) ? id : null;
}

function filePathOf(href: string): string | null {
  if (!href.startsWith("file://")) return null;
  try {
    const u = new URL(href);
    return u.host === "" || u.host === "localhost" ? decodeURIComponent(u.pathname) : null;
  } catch {
    return null;
  }
}

/** A folder a later relative name could live in: the path itself, or a file's folder. */
function baseOf(text: string): string | null {
  const c = classify(text);
  if (!c || c.kind === "relative") return null;
  const v = c.value;
  if (v.endsWith("/")) return v;
  const last = v.split("/").pop() ?? "";
  return /\.[A-Za-z0-9]{1,8}$/.test(last) ? v.slice(0, v.length - last.length) : v;
}

function createScanner(getRpc: () => Rpc) {
  const marks = new WeakMap<Element, Mark>();
  const cache = new Map<string, Resolved | null>();
  const marked = new Set<Element>();
  let seq = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let inFlight = false;
  let again = false;
  let disposed = false;

  function apply(el: Element, mark: Mark) {
    marks.set(el, mark);
    const r = mark.resolved;
    let state: "yes" | "fix" | null = null;
    if (r?.path) {
      if (mark.kind === "code") state = "yes";
      else if (filePathOf(mark.href ?? "") !== r.path) state = "fix"; // bb's own link already works: leave it
    }
    if (state) {
      el.setAttribute(ATTR, state);
      el.setAttribute(
        "title",
        state === "fix" ? `Opens ${r!.path}` : `Show in Finder: ${r!.path}`,
      );
      marked.add(el);
    } else if (el.hasAttribute(ATTR)) {
      el.removeAttribute(ATTR);
      el.removeAttribute("title");
      marked.delete(el);
    }
  }

  function collect(): Pending[] {
    const out: Pending[] = [];
    for (const msg of document.querySelectorAll(MESSAGE)) {
      const threadId = threadIdOf(msg);
      const bases: string[] = [];
      for (const el of msg.querySelectorAll("code, a[href^='file:']")) {
        const isLink = el.tagName === "A";
        if (!isLink && (el.closest("pre") || el.closest("a") || el.querySelector("a"))) continue;
        const text = (el.textContent ?? "").trim();
        const href = isLink ? el.getAttribute("href") : null;
        const hrefPath = href ? filePathOf(href) : null;
        if (isLink && !hrefPath) continue;
        const candidates = isLink ? [hrefPath!, text].filter((t) => classify(t)) : classify(text) ? [text] : [];
        const prior = bases.slice(-12);
        if (!isLink) {
          const base = baseOf(text);
          if (base && !bases.includes(base)) bases.push(base);
        }
        if (candidates.length === 0) continue;
        const existing = marks.get(el);
        if (existing && existing.text === text && existing.href === href) continue;
        const cacheKey = JSON.stringify([threadId, candidates, prior]);
        if (cache.has(cacheKey)) {
          apply(el, { kind: isLink ? "link" : "code", text, href, resolved: cache.get(cacheKey)! });
          continue;
        }
        marks.set(el, { kind: isLink ? "link" : "code", text, href, resolved: null }); // pending
        out.push({ el, kind: isLink ? "link" : "code", text, href, threadId, candidates, bases: prior, cacheKey });
      }
    }
    return out;
  }

  async function scan() {
    if (disposed) return;
    if (inFlight) {
      again = true;
      return;
    }
    inFlight = true;
    try {
      const pending = collect();
      const byThread = new Map<string | null, Pending[]>();
      for (const p of pending) byThread.set(p.threadId, [...(byThread.get(p.threadId) ?? []), p]);
      for (const [threadId, group] of byThread) {
        for (let i = 0; i < group.length; i += 60) {
          const chunk = group.slice(i, i + 60);
          const keyed = new Map(chunk.map((p) => [`k${++seq}`, p]));
          let results: Resolved[] = [];
          try {
            ({ results } = await getRpc().call("resolve", {
              threadId,
              items: [...keyed].map(([key, p]) => ({ key, candidates: p.candidates, bases: p.bases })),
            }));
          } catch {
            for (const p of chunk) marks.delete(p.el); // retry on the next scan
            continue;
          }
          if (disposed) return;
          for (const r of results) {
            const p = keyed.get(r.key);
            if (!p) continue;
            cache.set(p.cacheKey, r.path ? r : null);
            if (cache.size > 3000) cache.delete(cache.keys().next().value!);
            if (p.el.isConnected) apply(p.el, { kind: p.kind, text: p.text, href: p.href, resolved: r.path ? r : null });
          }
        }
      }
    } finally {
      inFlight = false;
      if (again && !disposed) {
        again = false;
        schedule();
      }
    }
  }

  function schedule() {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => void scan(), 200);
  }

  function flash(el: Element, error?: string) {
    el.classList.add(error ? "fl-error" : "fl-flash");
    if (error) el.setAttribute("title", error);
    setTimeout(() => el.classList.remove("fl-flash", "fl-error"), 900);
  }

  async function reveal(el: Element, path: string) {
    try {
      const res = await getRpc().call("reveal", { path });
      flash(el, res.ok ? undefined : res.error);
    } catch {
      flash(el, "Finder could not be reached.");
    }
  }

  function preview(el: Element, r: Resolved): boolean {
    if (!r.hostId || r.isDir) return false;
    const threadId = threadIdOf(el);
    const nav = threadId ? threadNavs.get(threadId) : undefined;
    if (!nav) return false;
    return nav.experimental_openFilePreview({ target: { kind: "host", hostId: r.hostId, path: r.path! }, location: null });
  }

  function onClick(e: MouseEvent) {
    if (e.button !== 0 || e.defaultPrevented) return;
    const el = (e.target as Element | null)?.closest?.(`[${ATTR}="yes"], [${ATTR}="fix"]`);
    if (!el) return;
    const sel = window.getSelection();
    if (sel && !sel.isCollapsed && el.contains(sel.anchorNode)) return; // let drag-select copy the path
    const mark = marks.get(el);
    const r = mark?.resolved;
    if (!r?.path) return;
    e.preventDefault();
    e.stopPropagation();
    if (mark!.kind === "link") {
      if (!preview(el, r)) void reveal(el, r.path);
      else flash(el);
      return;
    }
    void reveal(el, r.path);
  }

  const observer = new MutationObserver(schedule);
  observer.observe(document.body, { childList: true, subtree: true, characterData: true });
  document.addEventListener("click", onClick, true);
  schedule();

  return {
    rescan: schedule,
    dispose() {
      disposed = true;
      if (timer) clearTimeout(timer);
      observer.disconnect();
      document.removeEventListener("click", onClick, true);
      for (const el of marked) {
        el.removeAttribute(ATTR);
        el.removeAttribute("title");
        el.classList.remove("fl-flash", "fl-error");
      }
      marked.clear();
    },
  };
}

function FinderLinksController() {
  const rpc = useRpc<typeof rpcContract>();
  const rpcRef = useRef(rpc);
  rpcRef.current = rpc;
  useEffect(() => {
    const scanner = createScanner(() => rpcRef.current);
    return () => scanner.dispose();
  }, []);
  return null;
}

/** Hidden, one per thread composer: lends the scanner this thread's navigator. */
function ThreadPreviewOpener() {
  const { threadId } = useBbContext();
  const nav = useBbNavigate();
  useEffect(() => {
    if (!threadId) return;
    threadNavs.set(threadId, nav);
    return () => {
      if (threadNavs.get(threadId) === nav) threadNavs.delete(threadId);
    };
  }, [threadId, nav]);
  return null;
}

export default definePluginApp((app) => {
  app.slots.experimental_appOverlay({ id: "controller", component: FinderLinksController });
  app.composer.customize({
    id: "finder-links",
    banners: [{ id: "preview-opener", chrome: "bare", component: ThreadPreviewOpener }],
  });
});

