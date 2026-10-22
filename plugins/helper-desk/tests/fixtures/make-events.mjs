// Generates tests/fixtures/events.json: a synthetic bb thread log (no real data).
// Six requests, 21 sub-agents, lead items, sub-agent steps, background completions.
// Run: node tests/fixtures/make-events.mjs
import { writeFileSync } from "node:fs";

const out = [];
let seq = 0;
let t = Date.UTC(2026, 0, 12, 9, 0, 0);
const push = (type, data, gapMs = 1000, seqGap = 37) => {
  seq += seqGap;
  t += gapMs;
  out.push({ seq, type, createdAt: t, data });
};
const lead = (type, extra) => {
  const id = `lead-${seq}`;
  push("item/started", { item: { type, id, ...extra } });
  push("item/completed", { item: { type, id, ...extra } });
};

const batches = [
  { request: "Research three competitors and draft a comparison table.", agents: ["Competitor A notes", "Competitor B notes", "Competitor C notes", "Comparison table"] },
  { request: "Plan the spring workshop agenda and the slides.", agents: ["Agenda planner", "Slide outline", "Speaker notes"] },
  { request: "Tidy the demo repository and write the README.", agents: ["Lint fixer", "Test runner", "README writer", "Draft the onboarding guide"] },
  { request: "Prepare the weekly newsletter.", agents: ["Story picker", "Headline writer", "Image prompts"] },
  { request: "Review the pricing page copy and suggest changes.", agents: ["Copy reviewer", "Tone checker", "Price table check", "Summary writer"] },
  { request: "Check the build and summarise what failed.", agents: ["Build checker", "Log reader", "Fix proposer"] },
];

let n = 0;
for (const [bi, b] of batches.entries()) {
  push("client/turn/requested", { initiator: "user", input: [{ type: "text", text: b.request }] }, 60_000, 400);
  lead("fileRead", { path: "/tmp/demo/notes.md" });
  const ids = [];
  for (const name of b.agents) {
    n += 1;
    const id = `demo-deleg-${n}`;
    ids.push([id, name]);
    const explore = n % 4 === 0;
    push("item/delegation/completed", {
      item: {
        type: "delegation", id, label: name, status: "completed", background: true,
        summary: `Async agent launched successfully.\noutput_file: /tmp/demo/tasks/task-${n}.output\n`,
        presentation: { title: name, detail: explore ? "Explore agent · model sonnet" : "general-purpose agent" },
      },
    });
  }
  for (const [id] of ids) {
    push("item/started", { item: { type: "fileRead", id: `${id}-r`, path: "/tmp/demo/brief.md", parentToolCallId: id } });
    push("item/started", { item: { type: "commandExecution", id: `${id}-c`, command: "ls /tmp/demo", parentToolCallId: id } });
  }
  if (bi === 1) push("client/turn/requested", { initiator: "system", input: [{ type: "text", text: "A background task finished." }] });
  for (const [i, [id, name]] of ids.entries()) {
    const special = name === "Draft the onboarding guide";
    const summary = special
      ? "Drafted the onboarding guide in /tmp/demo/ONBOARDING.md. " + "It covers setup, the first run, common errors and where to ask for help, with a short checklist at the end. ".repeat(5)
      : `${name}: done. Wrote the result to /tmp/demo/out-${i + 1}.md.`;
    push("item/backgroundTask/completed", {
      item: {
        type: "backgroundTask", id: `${id}-bg`, taskType: "local_agent", description: name, status: "completed", taskStatus: "completed",
        parentToolCallId: id,
        usage: special ? { totalTokens: 188565, toolUses: 58, durationMs: 519945 } : { totalTokens: 40_000 + i * 7_000, toolUses: 5 + i, durationMs: 60_000 + i * 15_000 },
        summary, outputFile: `/tmp/demo/tasks/task-${id.split("-").at(-1)}.output`,
      },
    }, 30_000);
  }
  lead("commandExecution", { command: "ls /tmp/demo" });
}
// A foreground delegation with a usage block, then the lead's closing reply.
push("item/started", { item: { type: "delegation", id: "demo-fg-1", label: "Final check", status: "pending", background: false } });
push("item/completed", { item: { type: "delegation", id: "demo-fg-1", label: "Final check", status: "completed", background: false, summary: "All good.\n<usage>total_tokens: 21000\ntool_uses: 3\nduration_ms: 42000</usage>" } });
lead("agentMessage", {});

writeFileSync(new URL("./events.json", import.meta.url), JSON.stringify(out));
console.log(`${out.length} events, last seq ${seq}`);
