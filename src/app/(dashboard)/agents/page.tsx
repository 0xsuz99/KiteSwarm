"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useAccount, useBalance } from "wagmi";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  CreateAgentForm,
  type CreateAgentFormPreset,
} from "@/components/agents/create-agent-form";
import {
  DEFAULT_AGENT_PRESETS,
  type DefaultAgentPreset,
} from "@/lib/default-agent-presets";
import { kiteTestnet } from "@/lib/kite-chain";
import { Plus, Bot } from "lucide-react";

type AgentStatus = "active" | "inactive" | "paused" | "error";

type AgentApiRow = {
  id: string;
  name: string;
  status: AgentStatus;
  aa_wallet_address: string | null;
  vault_proxy_address: string | null;
  created_at: string;
  strategies:
    | {
        name: string;
      }
    | {
        name: string;
      }[]
    | null;
};

const statusColors: Record<AgentStatus, string> = {
  active: "bg-emerald-50 text-emerald-700 border-0",
  inactive: "bg-gray-100 text-gray-500 border-0",
  paused: "bg-amber-50 text-amber-700 border-0",
  error: "bg-red-50 text-red-700 border-0",
};

const riskColors: Record<DefaultAgentPreset["riskLabel"], string> = {
  low: "bg-emerald-50 text-emerald-700 border-emerald-200",
  moderate: "bg-amber-50 text-amber-600 border-amber-200",
  high: "bg-red-50 text-red-600 border-red-200",
};

function truncateAddress(address: string): string {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function resolveStrategyName(strategies: AgentApiRow["strategies"]): string {
  if (!strategies) return "No strategy";
  if (Array.isArray(strategies)) return strategies[0]?.name ?? "No strategy";
  return strategies.name;
}

function presetToForm(preset: DefaultAgentPreset): CreateAgentFormPreset {
  return {
    name: `${preset.name} Agent`,
    description: preset.description,
    strategyType: preset.strategyType,
    dailyBudgetUsd: preset.dailyBudgetUsd,
    maxPerTxUsd: preset.maxPerTxUsd,
    allocations: preset.allocations,
  };
}

export default function AgentsPage() {
  const { address } = useAccount();
  const { data: walletBalance } = useBalance({
    address,
    chainId: kiteTestnet.id,
    query: { enabled: Boolean(address) },
  });

  const [agents, setAgents] = useState<AgentApiRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [formKey, setFormKey] = useState(0);
  const [selectedPreset, setSelectedPreset] =
    useState<CreateAgentFormPreset | null>(null);

  const empty = useMemo(
    () => !loading && !error && agents.length === 0,
    [agents.length, error, loading]
  );
  const availableKiteAmount = Number.parseFloat(walletBalance?.formatted ?? "0") || 0;

  const loadAgents = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await fetch("/api/agents", {
        credentials: "include",
        cache: "no-store",
      });

      const payload = await response.json();
      if (!response.ok) {
        setError(payload.error ?? "Failed to load agents");
        return;
      }

      setAgents((payload.agents ?? []) as AgentApiRow[]);
    } catch {
      setError("Failed to load agents");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadAgents();
  }, [loadAgents]);

  const openCreateDrawer = (preset: CreateAgentFormPreset | null) => {
    setSelectedPreset(preset);
    setFormKey((current) => current + 1);
    setCreateOpen(true);
  };

  const handleCreated = async () => {
    setCreateOpen(false);
    setSelectedPreset(null);
    await loadAgents();
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Your Agents</h1>
          <p className="text-gray-500 text-sm mt-1">
            Manage your autonomous DeFi agents
          </p>
        </div>
        <Button
          className="bg-indigo-600 hover:bg-indigo-500 text-white"
          onClick={() => openCreateDrawer(null)}
        >
          <Plus className="h-4 w-4 mr-2" />
          Create Agent
        </Button>
      </div>

      <Card className="bg-white border-gray-200 overflow-hidden">
        <CardHeader className="bg-gradient-to-r from-sky-500/10 via-indigo-500/5 to-white dark:from-slate-800/70 dark:via-slate-900 dark:to-slate-900">
          <div>
            <CardTitle className="text-gray-900 text-lg">
              Featured Agent Presets
            </CardTitle>
            <CardDescription>
              Use curated starter agents. Unlock based on wallet KITE balance on
              Kite testnet.
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent className="pt-6 grid grid-cols-1 xl:grid-cols-3 gap-4">
          {DEFAULT_AGENT_PRESETS.map((preset) => {
            const suggested = availableKiteAmount >= preset.requiredStakeKite;
            return (
              <Card key={preset.id} className="bg-gray-50 border-gray-200">
                <CardHeader>
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <CardTitle className="text-gray-900 text-base">{preset.name}</CardTitle>
                      <CardDescription className="mt-1">{preset.summary}</CardDescription>
                    </div>
                    <Badge variant="outline" className={riskColors[preset.riskLabel]}>
                      {preset.riskLabel} risk
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="text-xs text-gray-500">
                    Minimum wallet balance:{" "}
                    <span className="text-gray-700 font-medium">
                      {preset.requiredStakeKite.toLocaleString()} KITE
                    </span>
                  </div>
                  <div className="text-xs text-gray-500">
                    Strategy: <span className="text-gray-700">{preset.strategyType}</span>
                  </div>
                  <div className="text-xs text-gray-400">
                    Budget: ${preset.dailyBudgetUsd}/day, ${preset.maxPerTxUsd} max per tx
                  </div>
                  <Button
                    className="w-full bg-indigo-600 hover:bg-indigo-700 text-white"
                    variant="default"
                    onClick={() => openCreateDrawer(presetToForm(preset))}
                  >
                    Use Preset
                  </Button>
                  {!suggested ? (
                    <p className="text-xs text-amber-600">
                      Low balance warning: preset is still available, but fund this agent after creation.
                    </p>
                  ) : null}
                </CardContent>
              </Card>
            );
          })}
        </CardContent>
      </Card>

      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-500">Created agents</p>
        <Link href="/agents/new">
          <Button
            variant="outline"
            className="border-gray-300 text-gray-700 hover:bg-gray-100"
          >
            <Plus className="h-4 w-4 mr-2" />
            Open Full Page Form
          </Button>
        </Link>
      </div>

      {loading ? <p className="text-gray-500 text-sm">Loading agents...</p> : null}
      {error ? <p className="text-red-600 text-sm">{error}</p> : null}
      {empty ? (
        <Card className="bg-white border-gray-200">
          <CardContent className="pt-6 text-sm text-gray-500">
            No agents yet. Create your first one to start autonomous execution.
          </CardContent>
        </Card>
      ) : null}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {agents.map((agent) => {
          const wallet = agent.aa_wallet_address ?? agent.vault_proxy_address;
          return (
            <Link key={agent.id} href={`/agents/${agent.id}`}>
              <Card className="bg-white border-gray-200 hover:border-indigo-300 transition-colors cursor-pointer h-full">
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <div className="h-8 w-8 rounded-lg bg-indigo-50 flex items-center justify-center">
                        <Bot className="h-4 w-4 text-indigo-600" />
                      </div>
                      <CardTitle className="text-gray-900 text-base">{agent.name}</CardTitle>
                    </div>
                    <Badge className={statusColors[agent.status]}>{agent.status}</Badge>
                  </div>
                  <CardDescription className="mt-2">
                    Strategy: {resolveStrategyName(agent.strategies)}
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-gray-400">AA Wallet</span>
                    <code className="text-gray-700 text-xs bg-gray-50 px-2 py-0.5 rounded">
                      {wallet ? truncateAddress(wallet) : "Not configured"}
                    </code>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-gray-400">Created</span>
                    <span className="text-gray-700">
                      {new Date(agent.created_at).toLocaleString()}
                    </span>
                  </div>
                </CardContent>
              </Card>
            </Link>
          );
        })}
      </div>

      <Sheet open={createOpen} onOpenChange={setCreateOpen}>
        <SheetContent
          side="right"
          className="w-full sm:max-w-5xl p-0 bg-white border-gray-200 text-gray-900 overflow-y-auto"
        >
          <SheetHeader className="px-6 py-5 border-b border-gray-200">
            <SheetTitle className="text-gray-900 text-lg">
              {selectedPreset ? "Create Agent From Preset" : "Create New Agent"}
            </SheetTitle>
            <SheetDescription>
              {selectedPreset
                ? "Preset values are pre-filled. You can edit anything before saving."
                : "Set strategy, limits, and allocations for your autonomous agent."}
            </SheetDescription>
          </SheetHeader>
          <div className="px-6 py-5">
            <CreateAgentForm
              key={formKey}
              mode="drawer"
              preset={selectedPreset}
              onCreated={() => {
                void handleCreated();
              }}
            />
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
