/** Isolated test fixture. Not a BB install, provider, account or integration. */
import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { GuideView, type GuidePhase, type GuideSnapshot } from "../guide";
import { freshProgress, transition, type GuideAction } from "../lib/state";
import type { Edition } from "../lib/steps";
import "./fixture.css";
const edition: Edition = new URLSearchParams(location.search).get("edition") === "simple" ? "simple" : "pro";
function Fixture() {
  const key = `isolated-guide-fixture:${edition}`;
  const [snapshot, setSnapshot] = useState<GuideSnapshot>(() => {
    let raw; try { raw = JSON.parse(localStorage.getItem(key) ?? "null"); } catch { raw = null; }
    return { edition, guideVersion: "1", autoStart: true, progress: raw ?? freshProgress(edition, "1") };
  });
  const [phase, setPhase] = useState<GuidePhase | null>(null), [targetClicks, setTargetClicks] = useState(0);
  function action(a: GuideAction) {
    setSnapshot(old => {
      const next = transition(old.progress, a, Date.now(), () => crypto.randomUUID());
      localStorage.setItem(key, JSON.stringify(next.progress));
      setPhase(a.kind === "close" ? null : a.kind === "offer" ? next.offered ? "offer" : null : next.progress.status === "completed" ? "completed" : "tour");
      return { ...old, progress: next.progress };
    });
  }
  useEffect(() => { if (snapshot.progress.status === "new") action({ kind: "offer" }); }, []);
  function close() { action({ kind: "close", runId: snapshot.progress.runId }); }
  return <><div className="fx-notice">Isolated host fixture · fictional regions · not a real BB integration <strong>{edition === "simple" ? "Simple" : "Existing Pro"} targets</strong></div><div className="fx-shell">
    <nav className="fx-rail" data-testid="app-nav-rail" aria-label="Fixture navigation"><button onClick={() => setTargetClicks(v => v + 1)}>Chats</button><button>More</button><a href="#fixture-settings">Settings</a></nav>
    <aside className="fx-sidebar" data-sidebar="sidebar"><button className="fx-project" data-bb-overlay-tour={edition === "simple" ? "project" : undefined} onClick={() => setTargetClicks(v => v + 1)}>Cedar Studio <span>⌄</span></button><button className="fx-new" data-bb-overlay-tour={edition === "simple" ? "new-chat" : undefined} title="New chat in Cedar Studio" onClick={() => setTargetClicks(v => v + 1)}>New chat <span>+</span></button><div className="fx-chats" data-testid="nav-rail-sidebar-body" data-bb-overlay-tour={edition === "simple" ? "chats" : undefined}><span>Recent chats</span><button>Launch review</button><button>Website labels</button><button>Research notes</button></div><div className="fx-side-bottom"><button data-bb-overlay-tour={edition === "simple" ? "features" : undefined} aria-label="Settings" onClick={() => setTargetClicks(v => v + 1)}>Features</button><button data-bb-overlay-tour={edition === "simple" ? "appearance" : undefined}>Appearance</button></div></aside>
    <main className="fx-main"><div className="fx-tabs" data-nav-tabs=""><div aria-label="Open chats">Launch review <span>Website labels</span></div></div><header className="fx-header"><strong>Launch review</strong><button className="hd-header-button" aria-label="Open Helper Desk history" onClick={() => setTargetClicks(v => v + 1)}>Helper Desk</button></header><div className="fx-reading"><span className="fx-caption">Fictional workspace content</span><h1>Keep the existing workspace intact.</h1><p>The guide moves between real, identified regions. It does not create chats, change a theme, activate a plugin or send a message.</p><p>This fixture uses the production guide UI and state policy. Its controls are authored test regions, not live BB functionality.</p><div id="fixture-settings" className="fx-controls"><button id="fixture-open" onClick={() => action({ kind: "start" })}>Open or resume guide</button><button id="fixture-replay" onClick={() => action({ kind: "replay" })}>Replay guide</button><button id="fixture-reset" onClick={() => { localStorage.removeItem(key); location.reload(); }}>Reset isolated fixture</button></div><pre id="fixture-progress">{JSON.stringify({ status: snapshot.progress.status, index: snapshot.progress.index, reviewed: Object.keys(snapshot.progress.reviewed), history: snapshot.progress.history.completedRuns, targetClicks }, null, 2)}</pre></div><footer className="fx-composer-area"><section className="cc-bar" aria-label="Cache clock">Cache warm · estimate only</section><div className="fx-compose" data-promptbox=""><label htmlFor="fixture-message">Message</label><textarea id="fixture-message" placeholder="This is an isolated fixture" /><div className="fx-compose-actions"><span>Claude · sample model</span><button className="ssm-switch" aria-label="Screen-share mode" onClick={() => setTargetClicks(v => v + 1)}>Screen Share off</button></div></div></footer></main>
  </div>{phase && <GuideView snapshot={snapshot} phase={phase} busy={false} error={null} onAction={action} onClose={close} />}</>;
}
createRoot(document.getElementById("fixture")!).render(<Fixture />);
