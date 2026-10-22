// bb-plugin-screen-share backend. Owns the one shared on/off flag so every bb
// window and remote client (desktop, or a phone viewing bb remotely) masks together.
import { defineRpcContract, type BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";

export const stateSchema = z.object({
  enabled: z.boolean(),
  updatedAt: z.number(),
  source: z.string(),
});
export type ScreenShareState = z.infer<typeof stateSchema>;

export const rpcContract = defineRpcContract({
  state_get: { input: z.null(), output: stateSchema },
  state_set: {
    input: z.object({ enabled: z.boolean(), source: z.string().max(40).optional() }),
    output: stateSchema,
  },
});

/** Realtime channel every client listens on; payload is the full state. */
export const STATE_CHANNEL = "state";
const KEY = "state";

/** Parse "/screenshare", "/screen-share on", "/screen share off" typed into any composer. */
export function parseSlash(text: string): "toggle" | "on" | "off" | null {
  const m = /^\s*\/screen[\s-]?share(?:\s+(on|off))?\s*$/i.exec(text);
  if (!m) return null;
  const arg = m[1]?.toLowerCase();
  return arg === "on" ? "on" : arg === "off" ? "off" : "toggle";
}

export default async function plugin(bb: BbPluginApi) {
  bb.settings.define({
    knownNames: {
      type: "string",
      label: "Always hide these people",
      description: "One per line or comma separated. Full names or first names.",
      experimental_multiline: true,
      default: "",
    },
    companies: {
      type: "string",
      label: "Company names",
      description: "Never treated as people. Hidden only when 'Hide company names' is on.",
      experimental_multiline: true,
      default: "",
    },
    maskCompanies: {
      type: "boolean",
      label: "Hide company names",
      description: "Off by default: companies stay readable, people do not.",
      default: false,
    },
    aggressiveNames: {
      type: "boolean",
      label: "Hide any capitalised pair of words",
      description:
        "Catches names not in the first-name list. Headings and buttons are spared. Over-masking is safer than under-masking on a shared screen.",
      default: true,
    },
  });

  async function read(): Promise<ScreenShareState> {
    const stored = await bb.storage.kv.get<ScreenShareState>(KEY);
    const parsed = stateSchema.safeParse(stored);
    return parsed.success ? parsed.data : { enabled: false, updatedAt: 0, source: "default" };
  }
  async function write(enabled: boolean, source: string): Promise<ScreenShareState> {
    const next: ScreenShareState = { enabled, updatedAt: Date.now(), source };
    await bb.storage.kv.set(KEY, next);
    bb.realtime.publish(STATE_CHANNEL, next);
    bb.log.info(`screen-share mode ${enabled ? "on" : "off"} (${source})`);
    return next;
  }

  bb.rpc.register(rpcContract, {
    state_get: () => read(),
    state_set: ({ enabled, source }) => write(enabled, source ?? "app"),
  });

  // "/screenshare" typed as a message toggles the mode and never reaches the model.
  bb.experimental_hooks.on("message.dispatch", async (ctx) => {
    if (ctx.initiator !== "user") return { action: "proceed" };
    const command = parseSlash(ctx.input.text);
    if (command === null) return { action: "proceed" };
    const current = await read();
    const enabled = command === "toggle" ? !current.enabled : command === "on";
    await write(enabled, "slash");
    return {
      action: "reject",
      message: enabled
        ? "Screen-share mode is on. Names, emails, phone numbers and amounts are hidden on every screen. Nothing was sent to the agent."
        : "Screen-share mode is off. Nothing was sent to the agent.",
    };
  });

  const usage = ["Usage:", "  bb screen-share on", "  bb screen-share off", "  bb screen-share status [--json]"].join("\n");
  bb.cli.register({
    name: "screen-share",
    summary: "Hide names, emails, phone numbers and amounts on every bb screen",
    commands: [
      { name: "on", summary: "Turn screen-share mode on", usage: "bb screen-share on" },
      { name: "off", summary: "Turn screen-share mode off", usage: "bb screen-share off" },
      { name: "status", summary: "Show whether screen-share mode is on", usage: "bb screen-share status [--json]" },
    ],
    async run(argv) {
      const json = argv.includes("--json");
      const [command] = argv.filter((a) => a !== "--json");
      const say = (s: ScreenShareState) => ({
        exitCode: 0,
        stdout: json ? JSON.stringify(s) : `Screen-share mode is ${s.enabled ? "on" : "off"}.`,
      });
      switch (command) {
        case "on":
          return say(await write(true, "cli"));
        case "off":
          return say(await write(false, "cli"));
        case "status":
          return say(await read());
        case undefined:
        case "help":
        case "--help":
          return { exitCode: 0, stdout: usage };
      }
      return { exitCode: 1, stderr: usage };
    },
  });
}
