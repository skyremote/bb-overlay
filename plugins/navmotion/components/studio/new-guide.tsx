import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { Markdown, useBbNavigate, useRpc } from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import type { rpcContract } from "../../server";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { Empty, KIND_LABELS, PANEL_PATH, errorText } from "./shared";

const KIND_HINTS: Record<string, string> = {
  deck: "A still or short loop for a slide, 1920x1080",
  short: "Vertical Short, music and effects only, 1080x1920",
  "short-dan": "Split screen: animation on top, your footage below",
  longform: "10 to 20 minutes of you with full-screen inserts",
  film: "Standalone landscape promo or explainer, 1920x1080",
};
type Kind = "deck" | "short" | "short-dan" | "longform" | "film";
const KINDS: Kind[] = ["deck", "short", "short-dan", "longform", "film"];

export function NewProjectView() {
  const rpc = useRpc<typeof rpcContract>();
  const nav = useBbNavigate();
  const [kind, setKind] = useState<Kind>("short");
  const [title, setTitle] = useState("");
  const [brief, setBrief] = useState("");
  const [footage, setFootage] = useState("");
  const [dur, setDur] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const needsFootage = kind === "short-dan" || kind === "longform";
  const durNum = dur.trim() === "" ? undefined : Number(dur);
  const durBad = durNum !== undefined && (!Number.isFinite(durNum) || durNum <= 0);
  const ready = title.trim() !== "" && brief.trim() !== "" && !durBad && (!needsFootage || footage.trim() !== "");

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!ready || busy) return;
    setBusy(true);
    setError(null);
    try {
      const r = await rpc.call("create_project", {
        kind,
        title: title.trim(),
        brief: brief.trim(),
        ...(needsFootage && footage.trim() !== "" ? { footage: footage.trim() } : {}),
        ...(durNum !== undefined ? { duration: durNum } : {}),
      });
      if (r.warning) toast.warning(r.warning);
      else toast.success("Project started. The agent is reading the brief.");
      nav.toPluginPanel(PANEL_PATH, { subPath: `p/${r.slug}` });
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">New project</h1>
        <p className="mt-1 text-sm text-muted-foreground">The Studio makes the project folder, starts an agent thread with the navmotion skill, and stops at the storyboard for you.</p>
      </div>
      <fieldset className="space-y-2">
        <legend className="mb-2 text-sm font-medium text-foreground">What are we making?</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {KINDS.map((k) => (
            <label
              key={k}
              className={cn(
                "flex cursor-pointer flex-col gap-0.5 rounded-xl border p-3 transition",
                kind === k ? "border-foreground bg-card shadow-xs" : "border-border hover:border-foreground/30",
              )}
            >
              <span className="flex items-center gap-2">
                <input type="radio" name="kind" value={k} checked={kind === k} onChange={() => setKind(k)} className="accent-current" />
                <span className="text-sm font-semibold text-foreground">{KIND_LABELS[k]}</span>
              </span>
              <span className="pl-5 text-xs text-muted-foreground">{KIND_HINTS[k]}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <label className="block space-y-1.5">
        <span className="text-sm font-medium text-foreground">Title</span>
        <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="SOW to invoice in 30 seconds" maxLength={160} />
      </label>
      <label className="block space-y-1.5">
        <span className="text-sm font-medium text-foreground">Brief</span>
        <Textarea value={brief} onChange={(e) => setBrief(e.target.value)} rows={7} placeholder="Who it is for, the one idea, the numbers to show, the brand, and anything to avoid." />
      </label>
      {needsFootage ? (
        <label className="block space-y-1.5">
          <span className="text-sm font-medium text-foreground">Footage path</span>
          <Input value={footage} onChange={(e) => setFootage(e.target.value)} placeholder="~/Movies/take-3.mp4" className="font-mono text-xs" />
          <span className="text-xs text-muted-foreground">The full path to your clip on this Mac.</span>
        </label>
      ) : null}
      <label className="block max-w-xs space-y-1.5">
        <span className="text-sm font-medium text-foreground">Duration in seconds (optional)</span>
        <Input value={dur} onChange={(e) => setDur(e.target.value)} inputMode="decimal" placeholder="45" aria-invalid={durBad} />
      </label>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      <div className="flex gap-2">
        <Button type="submit" disabled={!ready || busy}>
          {busy ? "Starting" : "Start project"}
        </Button>
        <Button type="button" variant="ghost" onClick={() => nav.toPluginPanel(PANEL_PATH, { subPath: "" })}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

export function GuideView() {
  const rpc = useRpc<typeof rpcContract>();
  const [guide, setGuide] = useState<{ exists: boolean; path: string; content: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    rpc.call("guide_get").then(setGuide, (e) => setError(errorText(e)));
  }, [rpc]);
  if (error) return <p role="alert" className="text-sm text-destructive">{error}</p>;
  if (guide === null) return <Empty>Loading the guide</Empty>;
  if (!guide.exists)
    return (
      <Empty>
        The navmotion skill is not installed yet, so there is no guide to show. NavMotion Studio is the dashboard for that skill: install the skill, then set its folder in the Studio\'s settings. It looked for <code className="font-mono text-xs">{guide.path}</code>.
      </Empty>
    );
  return <Markdown content={guide.content} className="max-w-none" />;
}
