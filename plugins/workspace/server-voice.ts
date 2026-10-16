// Voice agent ("Savvy") for NavAIgate Workspace, on ElevenLabs Agents.
//
// Shape (the OpenAI realtime "delegate through a tool" pattern, on ElevenLabs):
//   - ElevenLabs runs listening, turn-taking, a small LLM and speech (Eleven v4 Turbo).
//   - The real work happens in the harness chat. Client tools in the bb window
//     send prompts to that chat and read its replies; when a chat finishes, the
//     window pushes the reply in so the agent speaks a short summary.
// This server keeps the ElevenLabs key off the page: it creates/updates the
// agent once and mints short-lived WebRTC conversation tokens.
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import crypto from "node:crypto";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { me, readKey } from "./server-profile";

const API = "https://api.elevenlabs.io";
/** A stock ElevenLabs voice (George, British English). Change it in the plugin settings. */
export const SAVVY_VOICE_ID = "JBFqnCBsd6RMkjVDRZzb";

const systemPrompt = () => `You are Savvy, ${me()}'s voice assistant inside bb. ${me()} runs coding and business agents (they call them harnesses: Claude Code, Codex and Cursor) in chats, and you sit in front of whichever chat they have open.

Your jobs:
1. When ${me()} asks for work, turn what they said into one clear written instruction and call send_to_harness. Keep their intent exactly and add nothing they did not ask for. Then tell them in one short sentence that it has gone, and to which harness.
2. A message that starts with [HARNESS DONE] is the harness's reply arriving, not ${me()} speaking. Summarise it for them in at most three short spoken sentences: what was done, what is left, and whether anything needs them. Never read code, file paths, IDs or long lists aloud; say "the details are in the chat" instead.
3. When they ask what is happening, call harness_status, and latest_reply if they want the last answer.
4. Call stop_harness only when they clearly ask you to stop the harness.
5. When they list things that need doing, call add_todo with one short item per thing.

Style: British English, plain, warm and brief, like a capable colleague. No filler, no metaphors. Never invent results: if you are not sure, check with latest_reply. If a tool says no chat is open, ask them to open one.`;

const tools = () => [
  {
    type: "client",
    name: "send_to_harness",
    description: `Send a written instruction to the harness in the chat ${me()} has open (Claude Code, Codex or Cursor). Returns which harness and chat received it.`,
    parameters: {
      type: "object",
      properties: { prompt: { type: "string", description: "The full instruction to send, written clearly in British English." } },
      required: ["prompt"],
    },
    expects_response: true,
    response_timeout_secs: 20,
  },
  {
    type: "client",
    name: "harness_status",
    description: `What the harness in the open chat is doing right now: working, waiting, finished, or needs ${me()}.`,
    parameters: { type: "object", properties: {}, required: [] },
    expects_response: true,
    response_timeout_secs: 10,
  },
  {
    type: "client",
    name: "latest_reply",
    description: "The harness's most recent reply in the open chat, trimmed, so you can summarise it.",
    parameters: { type: "object", properties: {}, required: [] },
    expects_response: true,
    response_timeout_secs: 15,
  },
  {
    type: "client",
    name: "stop_harness",
    description: `Stop the harness's current turn in the open chat. Only when ${me()} clearly asks.`,
    parameters: { type: "object", properties: {}, required: [] },
    expects_response: true,
    response_timeout_secs: 15,
  },
  {
    type: "client",
    name: "add_todo",
    description: `Add items to ${me()}'s to-do list, linked to the open chat.`,
    parameters: {
      type: "object",
      properties: { items: { type: "array", description: "One short imperative item per thing to do.", items: { type: "string", description: "A to-do item." } } },
      required: ["items"],
    },
    expects_response: true,
    response_timeout_secs: 15,
  },
];

function agentConfig(voiceId: string, llm: string) {
  return {
    name: "bb Voice · Savvy",
    conversation_config: {
      agent: {
        first_message: "I'm here. What do you want the harness to do?",
        language: "en",
        prompt: { prompt: systemPrompt(), llm, temperature: 0.3, tools: tools() },
      },
      tts: { model_id: "eleven_v4_turbo", voice_id: voiceId },
      turn: { turn_eagerness: "normal" },
      conversation: { max_duration_seconds: 7200 },
    },
  };
}

export function createVoice(bb: BbPluginApi) {
  const settings = bb.settings.define({
    elevenlabsApiKey: {
      type: "string",
      secret: true,
      label: "ElevenLabs API key",
      description: "Used only on the bb server to set up the voice agent and issue short-lived session tokens. If empty, the key from Set up workspace is used.",
      default: "",
    },
    voiceId: { type: "string", label: "Voice ID", description: "ElevenLabs voice for the agent. Default: George, a stock British voice.", default: SAVVY_VOICE_ID },
    dashboards: {
      type: "string",
      label: "Dashboards",
      description: "Local web apps to show on the Dashboard page, one per line as Name|URL, for example: My OS|http://localhost:8081. Only http(s) URLs.",
      default: "",
    },
    planTiers: {
      type: "string",
      label: "Plan tiers",
      description: "Correct a plan the provider reports wrongly, one per line as account|plan, e.g. name@example.com|Max 20x. Used by plan advice.",
      default: "",
    },
    audienceProfiles: {
      type: "string",
      label: "Audience profiles",
      description: "Public profile links for the Audience cards, one per line as platform|URL (youtube, instagram, x, linkedin). The Home page's Link profile button writes this.",
      default: "",
    },
    voiceLlm: {
      type: "string",
      label: "Voice agent model",
      description: "The small model inside the ElevenLabs agent that routes and summarises. The real work stays in your harness.",
      default: "gemini-2.5-flash",
    },
    // Rail preferences live here too: bb takes one settings definition per plugin.
    keepOrder: {
      type: "boolean",
      label: "Keep my order in the rail",
      description: "Chats and projects stay where you put them instead of re-sorting by activity. Drag a chat or a folder to reorder it. A chat waiting on you stays in its place instead of moving to Needs you, and a new chat joins the top of its list.",
      default: false,
    },
  });

  async function key(): Promise<string | null> {
    const s = await settings.get();
    const fromSetting = (s.elevenlabsApiKey ?? "").trim();
    if (fromSetting) return fromSetting;
    const fromKeys = readKey("ELEVENLABS_API_KEY");
    if (fromKeys) return fromKeys;
    try {
      const f = path.join(os.homedir(), ".elevenlabs", "api_key");
      if (fs.existsSync(f)) return fs.readFileSync(f, "utf8").trim() || null;
    } catch {
      /* fall through */
    }
    return null;
  }

  async function el(method: string, p: string, k: string, body?: unknown) {
    const r = await fetch(API + p, {
      method,
      headers: { "xi-api-key": k, ...(body ? { "content-type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await r.text();
    if (!r.ok) throw new Error(`ElevenLabs ${method} ${p.split("?")[0]} -> ${r.status}: ${text.slice(0, 300)}`);
    return text ? (JSON.parse(text) as Record<string, unknown>) : {};
  }

  /** Create the agent on first use, or update it when our config changes. */
  async function ensureAgent(k: string): Promise<string> {
    const s = await settings.get();
    const cfg = agentConfig(String(s.voiceId || SAVVY_VOICE_ID), String(s.voiceLlm || "gemini-2.5-flash"));
    const hash = crypto.createHash("sha256").update(JSON.stringify(cfg)).digest("hex").slice(0, 16);
    const saved = (await bb.storage.kv.get<{ agentId: string; hash: string }>("voice-agent")) ?? null;
    if (saved?.agentId && saved.hash === hash) return saved.agentId;
    if (saved?.agentId) {
      try {
        await el("PATCH", `/v1/convai/agents/${encodeURIComponent(saved.agentId)}`, k, cfg);
        await bb.storage.kv.set("voice-agent", { agentId: saved.agentId, hash });
        return saved.agentId;
      } catch (e) {
        bb.log.warn(`voice agent update failed, recreating: ${String(e)}`);
      }
    }
    const created = await el("POST", "/v1/convai/agents/create", k, cfg);
    const agentId = String(created.agent_id ?? "");
    if (!agentId) throw new Error("ElevenLabs did not return an agent id.");
    await bb.storage.kv.set("voice-agent", { agentId, hash });
    bb.log.info(`voice agent ready: ${agentId}`);
    return agentId;
  }

  return {
    settings,
    async status() {
      const k = await key();
      const saved = (await bb.storage.kv.get<{ agentId: string }>("voice-agent")) ?? null;
      return { configured: !!k, agentId: saved?.agentId ?? null };
    },
    /** A short-lived WebRTC conversation token for the bb window. */
    async token() {
      const k = await key();
      if (!k) throw new Error("No ElevenLabs API key. Add it in Set up workspace.");
      const agentId = await ensureAgent(k);
      const r = await el("GET", `/v1/convai/conversation/token?agent_id=${encodeURIComponent(agentId)}`, k);
      const token = String(r.token ?? "");
      if (!token) throw new Error("ElevenLabs did not return a conversation token.");
      return { token, agentId };
    },
  };
}
