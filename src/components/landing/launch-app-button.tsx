"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";

export function LaunchAppButton() {
  const router = useRouter();
  const [isLaunching, setIsLaunching] = useState(false);

  const handleLaunch = () => {
    setIsLaunching(true);
    router.push("/dashboard");
  };

  return (
    <button
      type="button"
      onClick={handleLaunch}
      disabled={isLaunching}
      className="inline-flex cursor-pointer items-center justify-center gap-2 h-12 px-8 rounded-lg bg-indigo-600 hover:bg-indigo-700 active:scale-[0.99] disabled:bg-indigo-500 disabled:cursor-not-allowed transition-all text-white font-medium text-lg shadow-lg shadow-indigo-500/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-900"
    >
      {isLaunching ? (
        <>
          <Loader2 className="h-4 w-4 animate-spin" />
          Opening Dashboard...
        </>
      ) : (
        "Launch App"
      )}
    </button>
  );
}
