// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { createMasker, HIGHLIGHT_NAME, type HighlightLike, type MaskerDeps } from "../masker";
import type { DetectOptions } from "../detect";

const opts: DetectOptions = { knownNames: ["Rowan Hale"], companies: ["Northwind"], maskCompanies: false, aggressiveNames: true };

function fakeDeps() {
  const store = new Map<string, HighlightLike>();
  const frames: (() => void)[] = [];
  const deps: MaskerDeps = {
    registry: { set: (n, h) => store.set(n, h), delete: (n) => store.delete(n) },
    createHighlight: () => {
      const set = new Set<Range>();
      return {
        add: (r: Range) => set.add(r),
        delete: (r: Range) => set.delete(r),
        clear: () => set.clear(),
        get size() {
          return set.size;
        },
        forEach: (cb: (r: AbstractRange) => void) => set.forEach(cb),
      };
    },
    requestFrame: (cb) => frames.push(cb),
    cancelFrame: () => undefined,
  };
  const painted = () => {
    const out: string[] = [];
    store.get(HIGHLIGHT_NAME)?.forEach((r) => out.push((r as Range).toString()));
    return out.sort();
  };
  const flush = async () => {
    await new Promise((r) => setTimeout(r, 0)); // let MutationObserver deliver
    while (frames.length) frames.shift()!();
  };
  return { deps, store, painted, flush };
}

const HTML = `<aside><div>Call Maya Lopez</div></aside>
<main><table><tr><td>Owen Whitford</td><td>owen@northvale.co</td><td>+44 7700 900123</td><td>Northvale</td><td>$48,000</td></tr></table>
<p>Northwind renewed for <b>€700</b>.</p><h2>Quarterly Business Review</h2>
<div contenteditable="true">Priya Shah typed $5 here</div><textarea>Tom Ellis</textarea></main>`;

describe("masker", () => {
  it("paints without touching the DOM and clears exactly on dispose", () => {
    document.body.innerHTML = HTML;
    const before = document.body.innerHTML;
    const { deps, store, painted } = fakeDeps();
    const m = createMasker(document.body, opts, deps)!;
    expect(painted()).toEqual(["$48,000", "+44 7700 900123", "Maya Lopez", "Owen Whitford", "owen@northvale.co", "€700"].sort());
    expect(document.body.innerHTML).toBe(before);
    m.dispose();
    expect(store.has(HIGHLIGHT_NAME)).toBe(false);
    expect(document.body.innerHTML).toBe(before);
  });

  it("follows streaming text and new rows", async () => {
    document.body.innerHTML = "<main><p id=p>Draft for </p></main>";
    const { deps, painted, flush } = fakeDeps();
    const m = createMasker(document.body, opts, deps)!;
    expect(painted()).toEqual([]);
    const text = document.getElementById("p")!.firstChild as Text;
    text.data = "Draft for Lena Fischer at lena@summitpeak.de";
    await flush();
    expect(painted()).toEqual(["Lena Fischer", "lena@summitpeak.de"]);
    const row = document.createElement("div");
    row.textContent = "Sam Carter owes £18,200";
    document.body.querySelector("main")!.appendChild(row);
    await flush();
    expect(painted()).toEqual(["Lena Fischer", "Sam Carter", "lena@summitpeak.de", "£18,200"]);
    row.remove();
    text.data = "Draft cleared";
    await flush();
    expect(painted()).toEqual([]);
    m.dispose();
  });

  it("re-applies when options change", () => {
    document.body.innerHTML = "<p>Northwind renewed</p>";
    const { deps, painted } = fakeDeps();
    const m = createMasker(document.body, opts, deps)!;
    expect(painted()).toEqual([]);
    m.setOptions({ ...opts, maskCompanies: true });
    expect(painted()).toEqual(["Northwind"]);
    m.dispose();
  });

  it("returns null when the browser has no highlight support", () => {
    expect(createMasker(document.body, opts, null)).toBeNull();
  });
});
