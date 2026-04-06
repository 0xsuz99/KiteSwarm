"use client";

import { useEffect, useRef, useState } from "react";

const DEFAULT_POLL_MS = 45_000;
const FAST_DEMO_POLL_MS = 7_000;
const FAST_DEMO_STORAGE_KEY = "kiteswarm:fast-demo";

function fastAutopilotDefaultEnabled() {
  const raw = process.env.NEXT_PUBLIC_DEFAULT_FAST_AUTOPILOT;
  if (!raw) {
    return true;
  }
  return !["0", "false", "no", "off"].includes(raw.trim().toLowerCase());
}

function resolvePollMs() {
  const raw = process.env.NEXT_PUBLIC_AGENT_AUTO_POLL_MS;
  const parsed = raw ? Number.parseInt(raw, 10) : Number.NaN;
  if (!Number.isFinite(parsed)) {
    return DEFAULT_POLL_MS;
  }
  return Math.max(parsed, 15_000);
}

function readFastDemoFlag() {
  if (typeof window === "undefined") {
    return fastAutopilotDefaultEnabled();
  }
  const stored = window.localStorage.getItem(FAST_DEMO_STORAGE_KEY);
  if (stored === "1") {
    return true;
  }
  if (stored === "0") {
    return false;
  }
  return fastAutopilotDefaultEnabled();
}

export function AutoExecutor() {
  const inFlight = useRef(false);
  const [fastDemo, setFastDemo] = useState(readFastDemoFlag);

  useEffect(() => {
    const onModeChanged = () => {
      setFastDemo(readFastDemoFlag());
    };

    window.addEventListener("kiteswarm:demo-mode-changed", onModeChanged);
    window.addEventListener("storage", onModeChanged);
    return () => {
      window.removeEventListener("kiteswarm:demo-mode-changed", onModeChanged);
      window.removeEventListener("storage", onModeChanged);
    };
  }, []);

  useEffect(() => {
    const pollMs = fastDemo ? FAST_DEMO_POLL_MS : resolvePollMs();

    async function tick() {
      if (inFlight.current) {
        return;
      }

      inFlight.current = true;
      try {
        const response = await fetch(
          fastDemo ? "/api/agents/auto-execute?mode=fast" : "/api/agents/auto-execute",
          {
          method: "POST",
          credentials: "include",
          cache: "no-store",
          }
        );

        if (!response.ok) {
          return;
        }

        const payload = (await response.json()) as { executed?: number };
        if ((payload.executed ?? 0) > 0) {
          window.dispatchEvent(
            new CustomEvent("kiteswarm:auto-executed", {
              detail: { executed: payload.executed ?? 0 },
            })
          );
        }
      } catch {
        // Silent background polling.
      } finally {
        inFlight.current = false;
      }
    }

    const initial = window.setTimeout(() => {
      void tick();
    }, fastDemo ? 1_000 : 4_000);

    const interval = window.setInterval(() => {
      void tick();
    }, pollMs);

    return () => {
      window.clearTimeout(initial);
      window.clearInterval(interval);
    };
  }, [fastDemo]);

  return null;
}
