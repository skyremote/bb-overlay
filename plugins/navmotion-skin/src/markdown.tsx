// Markdown in the chat box: live formatting while you type, quick inserts in the + menu,
// and a Preview tab on the side that renders the draft the way the chat will show it.
//
// The live formatting is paint-only (bb's richText effects): the text you send stays plain
// Markdown, so bold, italics, tables and the rest render in the timeline once sent.
import type { ComposerPlusMenuItem } from "@get-bb/plugin-sdk/app";
import { Markdown, useBbNavigate, useComposer } from "@get-bb/plugin-sdk/app";

export const PREVIEW_TAB_ID = "md-preview";
export const PREVIEW_NEW_ID = "md-preview-new";

type Range = { from: number; to: number };

function scan(text: string, re: RegExp, pick: (m: RegExpExecArray) => Range[]): Range[] {
  const out: Range[] = [];
  const rx = new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g");
  let m: RegExpExecArray | null;
  while ((m = rx.exec(text))) {
    for (const r of pick(m)) if (r.to > r.from) out.push(r);
    if (m[0].length === 0) rx.lastIndex++;
  }
  return out;
}

/** Ranges inside fenced code blocks (``` ... ```), which take no other formatting. */
function fences(text: string): { body: Range[]; marks: Range[] } {
  const body: Range[] = [], marks: Range[] = [];
  let open = -1, pos = 0;
  for (const line of text.split("\n")) {
    const end = pos + line.length;
    if (/^\s*```/.test(line)) {
      marks.push({ from: pos, to: end });
      if (open < 0) open = end + 1;
      else {
        if (pos > open) body.push({ from: open, to: pos - 1 });
        open = -1;
      }
    }
    pos = end + 1;
  }
  if (open >= 0 && open < text.length) body.push({ from: open, to: text.length });
  return { body, marks };
}

const outside = (ranges: Range[], blocked: Range[]) =>
  ranges.filter((r) => !blocked.some((b) => r.from < b.to && r.to > b.from));

const effect = (id: string, className: string, match: (text: string) => Range[]) => ({
  id,
  className,
  match: (text: string) => {
    if (!text || text.length > 20000) return [];
    return outside(match(text), fences(text).body);
  },
});

export const MARKDOWN_EFFECTS = [
  effect("md-bold", "nm-md-bold", (t) => scan(t, /(\*\*|__)(?=\S)([^\n]*?\S)\1/g, (m) => [{ from: m.index + 2, to: m.index + m[0].length - 2 }])),
  effect("md-italic", "nm-md-italic", (t) => [
    ...scan(t, /(?<![*\w])\*(?![*\s])([^*\n]*?[^*\s])\*(?![*\w])/g, (m) => [{ from: m.index + 1, to: m.index + m[0].length - 1 }]),
    ...scan(t, /(?<![_\w])_(?![_\s])([^_\n]*?[^_\s])_(?![_\w])/g, (m) => [{ from: m.index + 1, to: m.index + m[0].length - 1 }]),
  ]),
  effect("md-strike", "nm-md-strike", (t) => scan(t, /~~(?=\S)([^~\n]*?\S)~~/g, (m) => [{ from: m.index + 2, to: m.index + m[0].length - 2 }])),
  effect("md-code", "nm-md-code", (t) => scan(t, /`[^`\n]+`/g, (m) => [{ from: m.index, to: m.index + m[0].length }])),
  effect("md-heading", "nm-md-heading", (t) => scan(t, /^(#{1,6})[ \t]+(\S.*)$/gm, (m) => [{ from: m.index + m[1].length + 1, to: m.index + m[0].length }])),
  effect("md-quote", "nm-md-quote", (t) => scan(t, /^>[ \t]?.*$/gm, (m) => [{ from: m.index, to: m.index + m[0].length }])),
  effect("md-list", "nm-md-list", (t) => scan(t, /^([ \t]*)([-*+]|\d+[.)])[ \t]+/gm, (m) => [{ from: m.index + m[1].length, to: m.index + m[1].length + m[2].length }])),
  effect("md-task", "nm-md-task", (t) => scan(t, /^([ \t]*[-*+][ \t]+)(\[[ xX]\])/gm, (m) => [{ from: m.index + m[1].length, to: m.index + m[1].length + m[2].length }])),
  effect("md-table", "nm-md-table", (t) => scan(t, /^[ \t]*\|.*\|[ \t]*$/gm, (m) => [{ from: m.index, to: m.index + m[0].length }])),
  effect("md-link", "nm-md-link", (t) => scan(t, /\[([^\]\n]+)\]\(([^)\s]+)\)/g, (m) => [{ from: m.index + 1, to: m.index + 1 + m[1].length }])),
  effect("md-mark", "nm-md-mark", (t) => [
    ...scan(t, /(\*\*|__)(?=\S)[^\n]*?\S\1/g, (m) => [{ from: m.index, to: m.index + 2 }, { from: m.index + m[0].length - 2, to: m.index + m[0].length }]),
    ...scan(t, /(?<![*\w])\*(?![*\s])[^*\n]*?[^*\s]\*(?![*\w])/g, (m) => [{ from: m.index, to: m.index + 1 }, { from: m.index + m[0].length - 1, to: m.index + m[0].length }]),
    ...scan(t, /(?<![_\w])_(?![_\s])[^_\n]*?[^_\s]_(?![_\w])/g, (m) => [{ from: m.index, to: m.index + 1 }, { from: m.index + m[0].length - 1, to: m.index + m[0].length }]),
    ...scan(t, /~~(?=\S)[^~\n]*?\S~~/g, (m) => [{ from: m.index, to: m.index + 2 }, { from: m.index + m[0].length - 2, to: m.index + m[0].length }]),
    ...scan(t, /^#{1,6}(?=[ \t]+\S)/gm, (m) => [{ from: m.index, to: m.index + m[0].length }]),
    ...scan(t, /^>/gm, (m) => [{ from: m.index, to: m.index + 1 }]),
    ...scan(t, /^[ \t]*\|?[ \t]*:?-{3,}:?[ \t]*(\|[ \t]*:?-{3,}:?[ \t]*)+\|?[ \t]*$/gm, (m) => [{ from: m.index, to: m.index + m[0].length }]),
    ...scan(t, /\|/g, (m) => [{ from: m.index, to: m.index + 1 }]),
    ...scan(t, /\[([^\]\n]+)\](\([^)\s]+\))/g, (m) => [
      { from: m.index, to: m.index + 1 },
      { from: m.index + 1 + m[1].length, to: m.index + m[0].length },
    ]),
  ]),
  {
    id: "md-fence",
    className: "nm-md-fence",
    match: (text: string) => {
      if (!text || text.length > 20000) return [];
      const f = fences(text);
      return [...f.marks, ...f.body];
    },
  },
];

const TABLE = "| Column | Column | Column |\n| --- | --- | --- |\n|  |  |  |";

export const PLUS_MENU: ComposerPlusMenuItem[] = [
  {
    id: "md-table",
    label: "Insert table",
    icon: "GridView",
    description: "A three-column Markdown table",
    run: ({ composer }) => composer.insert(TABLE, { block: true }),
  },
  {
    id: "md-checklist",
    label: "Insert checklist",
    icon: "ListView",
    description: "Two Markdown to-do items",
    run: ({ composer }) => composer.insert("- [ ] First\n- [ ] Second", { block: true }),
  },
  {
    id: "md-heading",
    label: "Insert heading",
    icon: "AlignLeft",
    description: "A level-two Markdown heading",
    run: ({ composer }) => composer.insert("## Heading", { block: true }),
  },
];

const HAS_MARKDOWN = /(\*\*|__|~~|`|^#{1,6}\s|^>\s?|^\s*[-*+]\s|^\s*\d+[.)]\s|^\s*\|.*\||\[[^\]]+\]\()/m;

/** The eye button in the chat box: opens the Preview tab on the side. */
export function PreviewAction() {
  const composer = useComposer();
  const nav = useBbNavigate();
  const isNew = composer.scope.kind === "new-thread";
  const active = HAS_MARKDOWN.test(composer.text);
  const open = () => {
    nav.openThreadPanel({ actionId: isNew ? PREVIEW_NEW_ID : PREVIEW_TAB_ID, title: "Preview" });
  };
  return (
    <button
      type="button"
      className="nm-md-preview-btn"
      data-active={active || undefined}
      onClick={open}
      aria-label="Preview formatting on the side"
      title="Preview formatting on the side"
    >
      <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
        <path d="M1.5 8s2.4-4.5 6.5-4.5S14.5 8 14.5 8 12.1 12.5 8 12.5 1.5 8 1.5 8Z" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
        <circle cx="8" cy="8" r="2" fill="none" stroke="currentColor" strokeWidth="1.3" />
      </svg>
      <span>Md</span>
    </button>
  );
}

function Preview() {
  const composer = useComposer();
  const text = composer.text;
  return (
    <div className="nm-md-preview">
      <div className="nm-md-preview-head">
        <span>Preview</span>
        <span className="nm-md-preview-hint">Live from your chat box</span>
      </div>
      {text.trim() ? (
        <div className="nm-md-preview-body">
          <Markdown content={text} />
        </div>
      ) : (
        <div className="nm-md-preview-empty">
          <p>Type in the chat box and the formatted message shows here.</p>
          <p className="nm-md-preview-tips">
            <code>**bold**</code> <code>*italic*</code> <code>~~strike~~</code> <code>`code`</code> <code># heading</code> <code>- list</code> <code>| table |</code>
          </p>
        </div>
      )}
    </div>
  );
}

export function PreviewPanel() {
  return <Preview />;
}

export function NewThreadPreviewPanel() {
  return <Preview />;
}
