// The NavMotion motion layer, v2: compositor-only.
//
// v1 redrew a full-window canvas 30 times a second on bb's main thread, so the motion
// stepped and competed with bb's own work. v2 builds the grounds once as layers (a dot grid,
// soft swells, silk textures drawn once, tunnel outlines, a halo ring) and moves them only
// with transform and opacity animations. The browser's compositor runs those at the
// screen's full rate (60 or 120 Hz) without touching the main thread. JavaScript only
// switches state (idle, working, done) and adds a short-lived element per click.
//
// The look follows NavAIgate's navmotion film engine: the same
// grounds, ripple and square-particle burst, at app scale. The active skin is read from the
// `--nm-skin` CSS variable each NavMotion palette sets, so the layer removes itself the
// moment another skin is chosen.

export type Skin = "dots" | "live" | "tunnel" | "";
type GroundState = "idle" | "working" | "done";
export type ThreadLike = { id: string; status: string };

const BUSY = new Set(["active", "starting", "pending", "stopping"]);
const TILE = 15; // dot grid spacing in px; every swell sits on a multiple of it
const CLICKABLE = 'button, a[href], [role="button"], [role="menuitem"], [role="menuitemradio"], [role="tab"], [role="option"], [role="switch"], summary, label';
const TYPING = '[contenteditable="true"], textarea, input:not([type="checkbox"]):not([type="radio"]):not([type="button"]):not([type="submit"])';

const mulberry32 = (seed: number) => {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

/**
 * Draw one silk texture: fine wavy lines whose shape repeats every `tile` px across, so the
 * canvas can slide left by exactly one tile forever without a seam. Drawn once per resize.
 */
function drawSilk(cv: HTMLCanvasElement, W: number, H: number, tile: number, seed: number, dark: boolean, alpha: number) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const width = W + tile;
  cv.width = Math.max(1, Math.round(width * dpr));
  cv.height = Math.max(1, Math.round(H * dpr));
  cv.style.width = `${width}px`;
  cv.style.height = `${H}px`;
  const c = cv.getContext("2d");
  if (!c) return;
  c.setTransform(dpr, 0, 0, dpr, 0, 0);
  c.clearRect(0, 0, width, H);
  const rnd = mulberry32(seed);
  const waves = [
    { k: 1, amp: 21, ph: rnd() * Math.PI * 2, drift: (rnd() - 0.5) * 0.32 },
    { k: 2, amp: 9, ph: rnd() * Math.PI * 2, drift: (rnd() - 0.5) * 0.5 },
    { k: 3, amp: 4, ph: rnd() * Math.PI * 2, drift: (rnd() - 0.5) * 0.7 },
  ];
  const gap = 14;
  const rows = Math.ceil(H / gap) + 6;
  c.beginPath();
  for (let i = 0; i < rows; i++) {
    const y0 = -3 * gap + i * gap;
    for (let x = 0; x <= width + 8; x += 8) {
      let y = y0;
      for (const w of waves) y += w.amp * Math.sin((2 * Math.PI * w.k * x) / tile + w.ph + i * w.drift);
      if (x === 0) c.moveTo(x, y);
      else c.lineTo(x, y);
    }
  }
  c.globalAlpha = alpha;
  c.strokeStyle = dark ? "#FFFFFF" : "#16171A";
  c.lineWidth = 1;
  c.stroke();
}

export class MotionEngine {
  private skin: Skin = "";
  private dark = false;
  private reduced: boolean;
  private main: HTMLElement | null = null;
  private root: HTMLDivElement | null = null;
  private fx: HTMLDivElement | null = null;
  private swells: HTMLDivElement[] = [];
  private silk: { cv: HTMLCanvasElement; tile: number; seed: number; alpha: number; dur: number; anim: Animation | null }[] = [];
  private ring: HTMLDivElement | null = null;
  private tunnel: HTMLDivElement | null = null;
  private ro: ResizeObserver | null = null;
  private colRo: ResizeObserver | null = null;
  private colEl: Element | null = null;
  private colKey = "";
  private mo: MutationObserver | null = null;
  private poll = 0;
  private syncQueued = 0;
  private resizeTimer = 0;
  private doneTimer = 0;
  private W = 0;
  private H = 0;
  private state: GroundState = "idle";
  private busy = false;
  private lastDoneWall = 0;
  private lastClickAt = 0;
  private seed = 11;
  private prevBusy = new Map<string, boolean>();
  private mq: MediaQueryList;
  private disposed = false;

  constructor() {
    this.mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    this.reduced = this.mq.matches;
    this.mq.addEventListener("change", this.onMotionPref);
    document.addEventListener("pointerdown", this.onPointer, { capture: true, passive: true });
    // A skin or light/dark change touches the theme <style> or the <html> class.
    this.mo = new MutationObserver(this.queueSync);
    this.mo.observe(document.head, { childList: true, subtree: true, characterData: true });
    this.mo.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    this.poll = window.setInterval(this.sync, 2000);
    this.sync();
  }

  dispose() {
    this.disposed = true;
    window.clearInterval(this.poll);
    window.clearTimeout(this.resizeTimer);
    window.clearTimeout(this.doneTimer);
    if (this.syncQueued) cancelAnimationFrame(this.syncQueued);
    this.mo?.disconnect();
    this.mq.removeEventListener("change", this.onMotionPref);
    document.removeEventListener("pointerdown", this.onPointer, { capture: true } as EventListenerOptions);
    this.detach();
  }

  /** Feed the thread list: the ground follows the agent in the chat on screen. */
  setThreads(threads: readonly ThreadLike[], threadId: string | null) {
    let current = false;
    let finishedHere = false;
    let finishedAnywhere = false;
    for (const th of threads) {
      const b = BUSY.has(th.status);
      const was = this.prevBusy.get(th.id);
      if (was && !b) {
        if (threadId && th.id === threadId) finishedHere = true;
        else finishedAnywhere = true;
      }
      this.prevBusy.set(th.id, b);
      if (threadId && th.id === threadId) current = b;
    }
    this.busy = current;
    this.updateColumn();
    const wall = performance.now();
    if (finishedHere || (!threadId && finishedAnywhere && wall - this.lastDoneWall > 8000)) {
      this.lastDoneWall = wall;
      this.setState("done");
    } else if (this.state !== "done") {
      this.setState(current ? "working" : "idle");
    }
  }

  // ---------- state ----------
  private setState(next: GroundState) {
    if (next === "done") {
      window.clearTimeout(this.doneTimer);
      this.doneTimer = window.setTimeout(() => {
        this.state = "idle";
        this.setState(this.busy ? "working" : "idle");
      }, 2200);
      if (this.ring && !this.reduced) {
        this.ring.classList.remove("nm-go");
        void this.ring.offsetWidth;
        this.ring.classList.add("nm-go");
      }
    }
    this.state = next;
    if (this.root) this.root.dataset.state = next;
    if (this.tunnel) {
      const rate = next === "working" ? 2.4 : 1;
      for (const a of this.tunnel.getAnimations({ subtree: true })) a.updatePlaybackRate(rate);
    }
  }

  // ---------- wiring ----------
  private onMotionPref = () => {
    this.reduced = this.mq.matches;
    this.startSilk();
  };

  private queueSync = () => {
    if (this.syncQueued || this.disposed) return;
    this.syncQueued = requestAnimationFrame(() => {
      this.syncQueued = 0;
      this.sync();
    });
  };

  private readSkin(): Skin {
    const v = getComputedStyle(document.documentElement).getPropertyValue("--nm-skin").trim();
    return v === "dots" || v === "live" || v === "tunnel" ? v : "";
  }

  private sync = () => {
    if (this.disposed) return;
    const skin = this.readSkin();
    const dark = document.documentElement.classList.contains("dark");
    const main = document.querySelector<HTMLElement>('main[data-sidebar="inset"]');
    const lost = !!this.root && !this.root.isConnected;
    if (skin !== this.skin || main !== this.main || lost) {
      this.skin = skin;
      this.dark = dark;
      this.attach(main);
    } else if (dark !== this.dark) {
      this.dark = dark;
      this.layout();
    }
    this.updateColumn();
  };

  private detach() {
    this.ro?.disconnect();
    this.ro = null;
    this.colRo?.disconnect();
    this.colRo = null;
    this.colEl = null;
    this.colKey = "";
    for (const s of this.silk) s.anim?.cancel();
    this.silk = [];
    this.root?.remove();
    this.root = null;
    this.fx?.remove();
    this.fx = null;
    this.swells = [];
    this.ring = null;
    this.tunnel = null;
  }

  private attach(main: HTMLElement | null) {
    this.detach();
    this.main = main;
    if (!this.skin || !main) return;

    const root = document.createElement("div");
    root.className = "nm-ground";
    root.setAttribute("aria-hidden", "true");
    root.dataset.state = this.state;

    // Dots: one drifting grid plus three soft swells on the same grid.
    const drift = document.createElement("div");
    drift.className = "nm-drift";
    const dots = document.createElement("div");
    dots.className = "nm-dots";
    drift.appendChild(dots);
    for (let i = 0; i < 3; i++) {
      const s = document.createElement("div");
      s.className = `nm-swell nm-s${i + 1}`;
      drift.appendChild(s);
      this.swells.push(s);
    }
    root.appendChild(drift);

    // Silk: two textures drawn once, sliding at different speeds.
    for (const spec of [
      { tile: 640, seed: 7, alpha: 0.1, dur: 30000 },
      { tile: 960, seed: 19, alpha: 0.055, dur: 52000 },
    ]) {
      const cv = document.createElement("canvas");
      cv.className = "nm-silk";
      root.appendChild(cv);
      this.silk.push({ cv, ...spec, anim: null });
    }

    // Halo: a ring of dots that swells out of the centre when an agent finishes.
    const ring = document.createElement("div");
    ring.className = "nm-ring";
    root.appendChild(ring);
    this.ring = ring;

    // Tunnel: eight outlines growing out of the centre (alternating tall and wide).
    const tunnel = document.createElement("div");
    tunnel.className = "nm-tunnel";
    for (let i = 0; i < 8; i++) {
      const o = document.createElement("i");
      o.className = i % 2 === 0 ? "nm-tall" : "nm-wide";
      o.style.animationDelay = `${(-i * 19.05) / 8}s`;
      tunnel.appendChild(o);
    }
    root.appendChild(tunnel);
    this.tunnel = tunnel;

    main.prepend(root);
    this.root = root;

    const fx = document.createElement("div");
    fx.className = "nm-fx";
    fx.setAttribute("aria-hidden", "true");
    document.body.appendChild(fx);
    this.fx = fx;

    this.ro = new ResizeObserver(() => {
      window.clearTimeout(this.resizeTimer);
      this.resizeTimer = window.setTimeout(() => this.layout(), 150);
    });
    this.ro.observe(main);
    this.layout();
    this.setState(this.state);
  }

  /** Size the silk textures and place the swells. Runs on attach, resize and light/dark change. */
  private layout() {
    if (!this.main || !this.root) return;
    const r = this.main.getBoundingClientRect();
    this.W = Math.max(1, Math.round(r.width));
    this.H = Math.max(1, Math.round(r.height));
    this.updateColumn();
    const snap = (v: number) => Math.round(v / TILE) * TILE;
    const spots = [
      [0.08, 0.12],
      [0.42, 0.5],
      [0.7, 0.16],
    ];
    this.swells.forEach((s, i) => {
      s.style.left = `${snap(this.W * spots[i][0])}px`;
      s.style.top = `${snap(this.H * spots[i][1])}px`;
    });
    if (this.skin === "live") {
      for (const s of this.silk) drawSilk(s.cv, this.W, this.H, s.tile, s.seed, this.dark, s.alpha);
      this.startSilk();
    } else {
      for (const s of this.silk) {
        s.anim?.cancel();
        s.anim = null;
        s.cv.width = s.cv.height = 1;
      }
    }
  }

  /**
   * Keep the reading column clear: find where the messages (or the chat box) sit and pass
   * their edges to the ground's mask, so the texture fades out softly behind the text.
   */
  private updateColumn() {
    if (!this.root || !this.main) return;
    const el =
      this.main.querySelector("[data-timeline-items]") ??
      this.main.querySelector("form[data-promptbox]");
    if (el !== this.colEl) {
      this.colRo?.disconnect();
      this.colEl = el;
      if (el) {
        this.colRo = new ResizeObserver(() => this.updateColumn());
        this.colRo.observe(el);
      }
    }
    const m = this.main.getBoundingClientRect();
    let left = m.width / 2 - 400;
    let right = m.width / 2 + 400;
    if (el) {
      const r = el.getBoundingClientRect();
      if (r.width > 200) {
        left = r.left - m.left - 24;
        right = r.right - m.left + 24;
      }
    }
    const key = `${Math.round(left)}:${Math.round(right)}`;
    if (key === this.colKey) return;
    this.colKey = key;
    this.root.style.setProperty("--nm-col-left", `${Math.round(left)}px`);
    this.root.style.setProperty("--nm-col-right", `${Math.round(right)}px`);
  }

  private startSilk() {
    for (const s of this.silk) {
      s.anim?.cancel();
      s.anim = null;
      if (this.reduced || this.skin !== "live") continue;
      s.anim = s.cv.animate([{ transform: "translate3d(0, 0, 0)" }, { transform: `translate3d(${-s.tile}px, 0, 0)` }], {
        duration: s.dur,
        iterations: Infinity,
        easing: "linear",
      });
    }
  }

  // ---------- click impact: a ripple on the ground, square particles on top ----------
  private onPointer = (e: PointerEvent) => {
    if (!this.skin || this.reduced || e.button !== 0 || !this.root || !this.fx) return;
    const target = e.target instanceof Element ? e.target : null;
    if (!target || target.closest(TYPING) || !target.closest(CLICKABLE)) return;
    const now = performance.now();
    if (now - this.lastClickAt < 120) return;
    this.lastClickAt = now;

    if (this.main) {
      const r = this.main.getBoundingClientRect();
      if (e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom) {
        const rip = document.createElement("div");
        rip.className = "nm-ripple";
        rip.style.left = `${e.clientX - r.left}px`;
        rip.style.top = `${e.clientY - r.top}px`;
        this.root.appendChild(rip);
        window.setTimeout(() => rip.remove(), 1300);
      }
    }

    const cols = this.skin === "tunnel" ? (this.dark ? ["#FFFFFF", "#C9689A", "#9FB1C9"] : ["#8E1B4F", "#16171A", "#C9689A"]) : this.dark ? ["#FFFFFF", "#9FB1C9", "#3FCF85"] : ["#5D74A6", "#16171A", "#22B366"];
    const rnd = mulberry32(++this.seed);
    for (let i = 0; i < 12; i++) {
      const p = document.createElement("i");
      p.className = "nm-spark";
      const size = 2 + rnd() * 2.2;
      p.style.width = p.style.height = `${size.toFixed(1)}px`;
      p.style.left = `${e.clientX}px`;
      p.style.top = `${e.clientY}px`;
      p.style.background = cols[Math.floor(rnd() * cols.length)];
      this.fx.appendChild(p);
      const ang = rnd() * Math.PI * 2;
      const dist = 40 + rnd() * 70;
      const anim = p.animate(
        [
          { transform: "translate3d(-50%, -50%, 0)", opacity: 0.85 },
          { transform: `translate3d(calc(-50% + ${(Math.cos(ang) * dist).toFixed(1)}px), calc(-50% + ${(Math.sin(ang) * dist).toFixed(1)}px), 0)`, opacity: 0 },
        ],
        { duration: 650 + rnd() * 200, easing: "cubic-bezier(0.16, 1, 0.3, 1)" },
      );
      anim.onfinish = () => p.remove();
      window.setTimeout(() => p.remove(), 1200);
    }
  };
}
