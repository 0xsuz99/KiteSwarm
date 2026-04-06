"use client";

import { useEffect, useRef } from "react";
import { useAccount } from "wagmi";

const isDemoMode = process.env.NEXT_PUBLIC_DEMO_NO_AUTH === "1";

/**
 * Syncs the connected wallet address to the user profile.
 * Skipped entirely in demo mode (no Supabase auth).
 */
export function WalletProfileSync() {
  const { isConnected, address } = useAccount();
  const lastSyncedRef = useRef<string | null>(null);
  const syncingRef = useRef(false);

  useEffect(() => {
    if (isDemoMode) return;
    if (!isConnected || !address || syncingRef.current) return;

    const normalized = address.toLowerCase();
    if (lastSyncedRef.current === normalized) return;

    const sync = async () => {
      if (syncingRef.current) return;
      syncingRef.current = true;

      try {
        const response = await fetch("/api/profile", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ wallet_address: normalized }),
        });

        if (response.ok) {
          lastSyncedRef.current = normalized;
        }
      } catch {
        // Silently fail
      } finally {
        syncingRef.current = false;
      }
    };

    const timer = setTimeout(() => void sync(), 500);
    return () => clearTimeout(timer);
  }, [address, isConnected]);

  return null;
}
