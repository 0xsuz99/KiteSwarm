"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

const FAST_DEMO_STORAGE_KEY = "kiteswarm:fast-demo";

function fastAutopilotDefaultEnabled() {
  const raw = process.env.NEXT_PUBLIC_DEFAULT_FAST_AUTOPILOT;
  if (!raw) {
    return true;
  }
  return !["0", "false", "no", "off"].includes(raw.trim().toLowerCase());
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

export function DemoModeToggle() {
  const [fastDemo, setFastDemo] = useState(readFastDemoFlag);

  function toggle() {
    const next = !fastDemo;
    setFastDemo(next);
    window.localStorage.setItem(FAST_DEMO_STORAGE_KEY, next ? "1" : "0");
    window.dispatchEvent(new CustomEvent("kiteswarm:demo-mode-changed"));
  }

  return (
    <div className="flex items-center gap-2">
      <Badge
        className={
          fastDemo
            ? "bg-emerald-50 text-emerald-700 border-emerald-200"
            : "bg-gray-100 text-gray-600 border-gray-200"
        }
      >
        Fast Autopilot: {fastDemo ? "On" : "Off"}
      </Badge>
      <Button
        type="button"
        variant="outline"
        className="border-gray-300 text-gray-700 hover:bg-gray-50"
        onClick={toggle}
      >
        {fastDemo ? "Disable" : "Enable"}
      </Button>
      <span className="hidden xl:block text-[11px] text-gray-500">
        Speeds up real execution cadence and on-chain attestations.
      </span>
    </div>
  );
}
