"use client";

import { useEffect, useRef, useState } from "react";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { useAccount, useWalletClient } from "wagmi";
import { kiteTestnet } from "@/lib/kite-chain";
import { ensureKiteChain } from "@/lib/wallet/ensure-kite-chain";

export function KiteWalletButton() {
  const { isConnected, chainId } = useAccount();
  const { data: walletClient } = useWalletClient();
  const [isSwitching, setIsSwitching] = useState(false);
  const [chainError, setChainError] = useState<string | null>(null);
  const hasAttempted = useRef(false);

  useEffect(() => {
    if (!isConnected || !walletClient || chainId === kiteTestnet.id) {
      setChainError(null);
      return;
    }

    if (hasAttempted.current) {
      return;
    }
    hasAttempted.current = true;

    const switchToKite = async () => {
      setIsSwitching(true);
      try {
        await ensureKiteChain(walletClient);
        setChainError(null);
      } catch {
        setChainError("Switch to Kite Testnet to use KiteSwarm.");
      } finally {
        setIsSwitching(false);
      }
    };

    void switchToKite();
  }, [chainId, isConnected, walletClient]);

  return (
    <div className="flex items-center gap-2">
      <ConnectButton showBalance={false} chainStatus="name" accountStatus="avatar" />
      {isSwitching ? (
        <span className="text-xs text-gray-500">Switching network...</span>
      ) : null}
      {chainError ? <span className="text-xs text-amber-600">{chainError}</span> : null}
    </div>
  );
}
