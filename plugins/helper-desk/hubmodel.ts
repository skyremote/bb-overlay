// Status lines for the Mods hub tab: one short line per mod, from whatever
// each mod's own RPC returned (or null when it is missing or switched off).

export interface ScreenShareStatus { enabled: boolean }
export interface CacheClockStatus {
  supported: boolean;
  running: boolean;
  lastReplyAt: number | null;
  expiresAt: number | null;
  now: number;
  keepWarm: { enabled: boolean } | null;
}
export interface ReflectStatus { today: number; total: number }

export type HubTone = "on" | "off" | "warm" | "cold" | "idle" | "missing";
export interface HubLine { text: string; tone: HubTone }

export function deskLine(running: number, leadWorking: boolean): HubLine {
  if (running > 0) return { text: `${running} running`, tone: "on" };
  return { text: leadWorking ? "Lead working, no sub-agents" : "No agents running", tone: "idle" };
}

export function screenShareLine(s: ScreenShareStatus | null): HubLine {
  if (!s) return { text: "Not installed or switched off", tone: "missing" };
  return s.enabled ? { text: "On for every screen", tone: "on" } : { text: "Off", tone: "off" };
}

export function countdown(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function cacheClockLine(s: CacheClockStatus | null, clientNow: number, offset = 0): HubLine {
  if (!s) return { text: "Not installed or switched off", tone: "missing" };
  if (!s.supported) return { text: "Claude Code threads only", tone: "idle" };
  if (s.running) return { text: "Turn running", tone: "idle" };
  if (s.lastReplyAt === null || s.expiresAt === null) return { text: "No reply yet", tone: "idle" };
  const left = s.expiresAt - (clientNow + offset);
  const kw = s.keepWarm?.enabled ? " · keeping warm" : "";
  return left > 0 ? { text: `Warm ${countdown(left)}${kw}`, tone: "warm" } : { text: `Cold${kw}`, tone: "cold" };
}

export function reflectLine(s: ReflectStatus | null): HubLine {
  if (!s) return { text: "Not installed or switched off", tone: "missing" };
  if (s.today > 0) return { text: `${s.today} ${s.today === 1 ? "rule" : "rules"} saved today`, tone: "on" };
  return { text: s.total > 0 ? `${s.total} saved in total` : "No rules saved yet", tone: "idle" };
}
