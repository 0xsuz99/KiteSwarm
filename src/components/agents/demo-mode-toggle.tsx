"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

const FAST_DEMO_STORAGE_KEY = "kiteswarm:fast-demo";

function readFastDemoFlag() {
  if (typeof window === "undefined") {
    return false;
  }
  return window.localStorage.getItem(FAST_DEMO_STORAGE_KEY) === "1";
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
        Fast Demo: {fastDemo ? "On" : "Off"}
      </Badge>
      <Button
        type="button"
        variant="outline"
        className="border-gray-300 text-gray-700 hover:bg-gray-50"
        onClick={toggle}
      >
        {fastDemo ? "Disable" : "Enable"}
      </Button>
    </div>
  );
}
