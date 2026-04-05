"use client";

import Link from "next/link";
import { Zap } from "lucide-react";
import { KiteWalletButton } from "@/components/wallet/kite-wallet-button";
import { UserMenu } from "@/components/auth/user-menu";
import { WalletProfileSync } from "@/components/auth/wallet-profile-sync";
import { AutoExecutor } from "@/components/agents/auto-executor";
import { DemoModeToggle } from "@/components/agents/demo-mode-toggle";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-gray-50 text-gray-900">
      <WalletProfileSync />
      <AutoExecutor />
      <header className="h-16 border-b border-gray-200 bg-white/90 backdrop-blur flex items-center justify-between px-6 sticky top-0 z-20">
        <div className="flex items-center gap-6">
          <Link href="/dashboard" className="flex items-center gap-2">
            <div className="h-8 w-8 rounded-lg bg-indigo-600 flex items-center justify-center">
              <Zap className="h-4 w-4 text-white" />
            </div>
            <div>
              <p className="text-sm font-semibold text-gray-900">KiteSwarm</p>
              <p className="text-xs text-gray-500">
                Autonomous Multi-Agent DeFi Portfolio Manager
              </p>
            </div>
          </Link>
        </div>
        <div className="flex items-center gap-3">
          <DemoModeToggle />
          <KiteWalletButton />
          <UserMenu />
        </div>
      </header>

      <main className="px-6 py-6">{children}</main>
    </div>
  );
}
