// Paints sensitive text with the CSS Custom Highlight API. The DOM is never
// mutated: bb's React-owned text nodes are not split or wrapped, so streaming
// messages, copy/paste and React reconciliation are untouched, and turning the
// mode off is exact by construction (the highlight is simply removed).
import { detect, type DetectOptions } from "./detect";

export const HIGHLIGHT_NAME = "bb-screen-share";

/** The subset of the browser HighlightRegistry / Highlight we use (injectable for tests). */
export interface HighlightLike {
  add(range: Range): unknown;
  delete(range: Range): unknown;
  clear(): void;
  readonly size: number;
  forEach(cb: (range: AbstractRange) => void): void;
}
export interface RegistryLike {
  set(name: string, highlight: HighlightLike): unknown;
  delete(name: string): unknown;
}

/** Elements whose text is never masked: editors and the composer, so typing stays usable. */
export const SKIP_SELECTOR = [
  "input",
  "textarea",
  "select",
  "[contenteditable]",
  ".ProseMirror",
  ".tiptap",
  ".monaco-editor",
  ".cm-editor",
  ".xterm",
  "script",
  "style",
  "noscript",
  "[data-screen-share-skip]",
].join(",");

/** Headings and buttons are spared from the aggressive capitalised-pair rule only. */
const CHROME_SELECTOR = "h1,h2,h3,h4,h5,h6,button,[role=button],[role=tab],[role=menuitem],label";

export interface MaskerDeps {
  registry: RegistryLike;
  createHighlight(): HighlightLike;
  requestFrame(cb: () => void): number;
  cancelFrame(handle: number): void;
}

export interface Masker {
  /** Rescan everything now (also after options change). */
  refresh(): void;
  setOptions(options: DetectOptions): void;
  /** Number of painted ranges, for tests and status. */
  count(): number;
  dispose(): void;
}

function browserDeps(): MaskerDeps | null {
  const g = globalThis as unknown as {
    CSS?: { highlights?: RegistryLike };
    Highlight?: new () => HighlightLike;
  };
  if (!g.CSS?.highlights || typeof g.Highlight !== "function") return null;
  const HighlightCtor = g.Highlight;
  return {
    registry: g.CSS.highlights,
    createHighlight: () => new HighlightCtor(),
    requestFrame: (cb) => requestAnimationFrame(cb),
    cancelFrame: (h) => cancelAnimationFrame(h),
  };
}

export function highlightSupported(): boolean {
  return browserDeps() !== null;
}

export function createMasker(root: Node, initial: DetectOptions, deps: MaskerDeps | null = browserDeps()): Masker | null {
  if (!deps) return null;
  const doc = root.ownerDocument ?? (root as Document);
  const highlight = deps.createHighlight();
  deps.registry.set(HIGHLIGHT_NAME, highlight);
  let options = initial;
  // Ranges painted for each text node, plus the text they were computed from.
  let byNode = new Map<Text, { value: string; ranges: Range[] }>();
  const dirty = new Set<Node>();
  let frame: number | null = null;
  let disposed = false;

  function skipped(node: Node): boolean {
    const el = node.parentElement;
    if (!el) return true;
    return el.closest(SKIP_SELECTOR) !== null;
  }

  function dropNode(node: Text) {
    const entry = byNode.get(node);
    if (!entry) return;
    for (const r of entry.ranges) highlight.delete(r);
    byNode.delete(node);
  }

  function scanText(node: Text) {
    const value = node.data;
    const prior = byNode.get(node);
    if (prior && prior.value === value) return;
    if (prior) dropNode(node);
    if (!node.isConnected || skipped(node)) return;
    const inChrome = node.parentElement?.closest(CHROME_SELECTOR) !== null;
    const matches = detect(value, inChrome ? { ...options, aggressiveNames: false } : options);
    if (matches.length === 0) {
      byNode.set(node, { value, ranges: [] });
      return;
    }
    const ranges: Range[] = [];
    for (const m of matches) {
      const range = doc.createRange();
      range.setStart(node, m.start);
      range.setEnd(node, Math.min(m.end, value.length));
      highlight.add(range);
      ranges.push(range);
    }
    byNode.set(node, { value, ranges });
  }

  function scanTree(start: Node) {
    if (start.nodeType === 3) {
      scanText(start as Text);
      return;
    }
    if (start.nodeType !== 1 && start.nodeType !== 9 && start.nodeType !== 11) return;
    if (start.nodeType === 1 && (start as Element).matches(SKIP_SELECTOR)) return;
    const walker = doc.createTreeWalker(start, 4 /* NodeFilter.SHOW_TEXT */);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) scanText(n as Text);
  }

  function prune() {
    for (const node of [...byNode.keys()]) if (!node.isConnected) dropNode(node);
  }

  function flush() {
    frame = null;
    if (disposed) return;
    const roots = [...dirty];
    dirty.clear();
    prune();
    for (const n of roots) if (n.isConnected) scanTree(n);
  }

  function schedule(node: Node) {
    dirty.add(node);
    if (frame === null) frame = deps!.requestFrame(flush);
  }

  const MutationObserverCtor = (doc.defaultView as (Window & typeof globalThis) | null)?.MutationObserver;
  const observer = MutationObserverCtor
    ? new MutationObserverCtor((records) => {
        for (const r of records) {
          if (r.type === "characterData") schedule(r.target);
          else r.addedNodes.forEach((added) => schedule(added));
        }
      })
    : null;
  observer?.observe(root, { subtree: true, childList: true, characterData: true });
  scanTree(root);

  return {
    refresh() {
      for (const node of [...byNode.keys()]) dropNode(node);
      byNode = new Map();
      scanTree(root);
    },
    setOptions(next) {
      options = next;
      this.refresh();
    },
    count: () => highlight.size,
    dispose() {
      if (disposed) return;
      disposed = true;
      observer?.disconnect();
      if (frame !== null) deps!.cancelFrame(frame);
      highlight.clear();
      deps!.registry.delete(HIGHLIGHT_NAME);
      byNode.clear();
      dirty.clear();
    },
  };
}
