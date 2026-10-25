// App-wide owner of the NavMotion motion layer. It renders nothing itself: it feeds the
// engine the chat in view and the thread list. All motion runs on the compositor.
import { useEffect, useRef } from "react";
import { experimental_useSidebarThreads, useBbContext } from "@get-bb/plugin-sdk/app";
import { MotionEngine } from "./engine";

export function MotionLayer() {
  const { threadId } = useBbContext();
  const { threads } = experimental_useSidebarThreads();
  const engine = useRef<MotionEngine | null>(null);

  useEffect(() => {
    const e = new MotionEngine();
    engine.current = e;
    return () => {
      e.dispose();
      engine.current = null;
    };
  }, []);

  useEffect(() => {
    engine.current?.setThreads(threads, threadId ?? null);
  }, [threads, threadId]);

  return null;
}
