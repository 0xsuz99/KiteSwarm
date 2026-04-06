"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { useAccount, useBalance, useWalletClient } from "wagmi";
import { kiteTestnet } from "@/lib/kite-chain";
import { ensureKiteChain } from "@/lib/wallet/ensure-kite-chain";

export function KiteWalletButton() {
  const { address, isConnected, chainId } = useAccount();
  const { data: walletClient } = useWalletClient();
  const [isSwitching, setIsSwitching] = useState(false);
  const [chainError, setChainError] = useState<string | null>(null);
  const hasAttempted = useRef(false);
  const { data: walletBalance, isLoading: isBalanceLoading } = useBalance({
    address,
    query: {
      enabled: Boolean(address) && isConnected && chainId === kiteTestnet.id,
    },
  });

  const balanceLabel = walletBalance?.formatted
    ? `${Number.parseFloat(walletBalance.formatted).toFixed(4)} KITE`
    : "0.0000 KITE";

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
      {isConnected && chainId === kiteTestnet.id ? (
        <span className="hidden lg:inline-flex items-center gap-1 rounded-full border border-gray-200 bg-gray-50 px-2.5 py-1 text-xs text-gray-700">
          {isBalanceLoading ? (
            <>
              <Loader2 className="h-3 w-3 animate-spin text-indigo-500" />
              Syncing...
            </>
          ) : (
            balanceLabel
          )}
        </span>
      ) : null}
      <ConnectButton showBalance={false} chainStatus="name" accountStatus="avatar" />
      {isSwitching ? (
        <span className="text-xs text-gray-500">Switching network...</span>
      ) : null}
      {chainError ? <span className="text-xs text-amber-600">{chainError}</span> : null}
    </div>
  );
}
