"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useAccount } from "wagmi";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select";
import { Plus, Trash2, Rocket } from "lucide-react";
import { kiteTestnet } from "@/lib/kite-chain";
import { getKiteTokensByChainId } from "@/lib/kite-tokens";

interface Allocation {
  asset: string;
  chain: string;
  percentage: string;
}

type TrackedToken = {
  symbol: string;
  address: string;
  decimals: number;
};

type StrategyRow = {
  id: string;
  name: string;
  type: "rebalance" | "yield_optimize" | "dca" | "momentum" | "custom";
  is_template: boolean;
};

export type CreateAgentFormPreset = {
  name: string;
  description?: string;
  strategyType?: StrategyRow["type"];
  dailyBudgetUsd?: number;
  maxPerTxUsd?: number;
  allocations?: Allocation[];
};

type CreateAgentFormProps = {
  mode?: "page" | "drawer";
  preset?: CreateAgentFormPreset | null;
  onCreated?: (agentId: string | null) => void;
};

const defaultAllocations: Allocation[] = [
  { asset: "USDC", chain: "kite", percentage: "100" },
];

function parseTrackedTokensInput(input: string): TrackedToken[] {
  const rows = input
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  const tokens: TrackedToken[] = [];
  for (const row of rows) {
    const parts = row.includes(",") ? row.split(",") : row.split(":");
    const [symbolRaw, addressRaw, decimalsRaw] = parts.map((part) => part.trim());
    if (!symbolRaw || !addressRaw) {
      continue;
    }
    if (!/^0x[a-fA-F0-9]{40}$/.test(addressRaw)) {
      continue;
    }
    const decimals = Number.parseInt(decimalsRaw ?? "18", 10);
    tokens.push({
      symbol: symbolRaw.toUpperCase(),
      address: addressRaw,
      decimals: Number.isFinite(decimals) ? Math.max(Math.min(decimals, 30), 0) : 18,
    });
  }

  return tokens;
}

export function CreateAgentForm({
  mode = "page",
  preset = null,
  onCreated,
}: CreateAgentFormProps) {
  const router = useRouter();
  const { address } = useAccount();

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [strategyId, setStrategyId] = useState("");
  const [dailyBudget, setDailyBudget] = useState("");
  const [maxPerTx, setMaxPerTx] = useState("");
  const [riskPerCycle, setRiskPerCycle] = useState("100");
  const [reservePct, setReservePct] = useState("0");
  const [minTradeUsd, setMinTradeUsd] = useState("0.1");
  const [maxTradeUsd, setMaxTradeUsd] = useState("1000000");
  const [trackedTokensInput, setTrackedTokensInput] = useState("");
  const [quickTokenAddress, setQuickTokenAddress] = useState("none");
  const [allocations, setAllocations] = useState<Allocation[]>(defaultAllocations);
  const [strategies, setStrategies] = useState<StrategyRow[]>([]);
  const [loadingStrategies, setLoadingStrategies] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedStrategy = useMemo(
    () => strategies.find((strategy) => strategy.id === strategyId) ?? null,
    [strategies, strategyId]
  );

  const selectedStrategyLabel = selectedStrategy
    ? `${selectedStrategy.name} (${selectedStrategy.type})`
    : loadingStrategies
      ? "Loading strategies..."
      : "Select a strategy";
  const commonTokens = useMemo(
    () => getKiteTokensByChainId(kiteTestnet.id),
    []
  );

  const normalizedAllocationTotal = useMemo(
    () =>
      allocations
        .map((allocation) => Number(allocation.percentage || 0))
        .filter((value) => Number.isFinite(value))
        .reduce((sum, value) => sum + value, 0),
    [allocations]
  );

  useEffect(() => {
    const loadStrategies = async () => {
      try {
        setLoadingStrategies(true);
        const response = await fetch("/api/strategies", {
          credentials: "include",
          cache: "no-store",
        });
        const payload = await response.json();
        if (!response.ok) {
          setError(payload.error ?? "Failed to load strategies");
          return;
        }

        const rows = (payload.strategies ?? []) as StrategyRow[];
        setStrategies(rows);
        if (rows.length > 0) {
          setStrategyId((current) => current || rows[0].id);
        }
      } catch {
        setError("Failed to load strategies");
      } finally {
        setLoadingStrategies(false);
      }
    };

    void loadStrategies();
  }, []);

  const resetToCustomDefaults = useCallback(() => {
    setName("");
    setDescription("");
    setDailyBudget("");
    setMaxPerTx("");
    setRiskPerCycle("100");
    setReservePct("0");
    setMinTradeUsd("0.1");
    setMaxTradeUsd("1000000");
    setTrackedTokensInput("");
    setQuickTokenAddress("none");
    setAllocations(defaultAllocations);
    setStrategyId(strategies[0]?.id ?? "");
  }, [strategies]);

  useEffect(() => {
    if (!preset) {
      if (mode === "drawer") {
        resetToCustomDefaults();
      }
      return;
    }

    setName(preset.name);
    setDescription(preset.description ?? "");
    setDailyBudget(
      typeof preset.dailyBudgetUsd === "number" ? String(preset.dailyBudgetUsd) : ""
    );
    setMaxPerTx(
      typeof preset.maxPerTxUsd === "number" ? String(preset.maxPerTxUsd) : ""
    );
    setRiskPerCycle("100");
    setReservePct("0");
    setMinTradeUsd("0.1");
    setMaxTradeUsd("1000000");
    setTrackedTokensInput("");
    setQuickTokenAddress("none");
    if (preset.allocations && preset.allocations.length > 0) {
      setAllocations(preset.allocations);
    }

    if (preset.strategyType && strategies.length > 0) {
      const match = strategies.find((strategy) => strategy.type === preset.strategyType);
      if (match) {
        setStrategyId(match.id);
      }
    }
  }, [mode, preset, resetToCustomDefaults, strategies]);

  const addAllocation = () => {
    setAllocations([...allocations, { asset: "", chain: "kite", percentage: "" }]);
  };

  const removeAllocation = (index: number) => {
    setAllocations(allocations.filter((_, i) => i !== index));
  };

  const updateAllocation = (
    index: number,
    field: keyof Allocation,
    value: string
  ) => {
    const updated = [...allocations];
    updated[index] = { ...updated[index], [field]: value };
    setAllocations(updated);
  };

  const addQuickToken = () => {
    if (quickTokenAddress === "none") {
      return;
    }
    const token = commonTokens.find(
      (row) => row.address.toLowerCase() === quickTokenAddress.toLowerCase()
    );
    if (!token) {
      return;
    }

    const decimals = typeof token.decimals === "number" ? token.decimals : 18;
    const line = `${token.symbol},${token.address},${decimals}`;

    const existingLines = trackedTokensInput
      .split("\n")
      .map((entry) => entry.trim().toLowerCase())
      .filter((entry) => entry.length > 0);
    if (existingLines.includes(line.toLowerCase())) {
      return;
    }

    setTrackedTokensInput((current) =>
      current.trim().length > 0 ? `${current}\n${line}` : line
    );
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);

    if (!name.trim()) {
      setError("Agent name is required.");
      return;
    }

    if (!strategyId) {
      setError("Please select a strategy.");
      return;
    }

    if (
      normalizedAllocationTotal > 0 &&
      (normalizedAllocationTotal < 99 || normalizedAllocationTotal > 101)
    ) {
      setError("Target allocations should sum to 100%.");
      return;
    }

    const spendingRules = {
      daily_budget_usd: dailyBudget ? Number(dailyBudget) : null,
      max_per_tx_usd: maxPerTx ? Number(maxPerTx) : null,
      source: "ui",
    };

    const trackedTokens = parseTrackedTokensInput(trackedTokensInput);

    const responsePayload = {
      name: name.trim(),
      description: description.trim() || null,
      strategy_id: strategyId,
      spending_rules: spendingRules,
      config: {
        allocations: allocations
          .filter((allocation) => allocation.asset && allocation.percentage)
          .map((allocation) => ({
            asset: allocation.asset.toUpperCase(),
            chain: allocation.chain || "kite",
            target_pct: Number(allocation.percentage),
          })),
        strategy_type: selectedStrategy?.type ?? null,
        position_sizing: {
          per_cycle_risk_pct: riskPerCycle ? Number(riskPerCycle) : 5,
          reserve_pct: reservePct ? Number(reservePct) : 10,
          min_trade_usd: minTradeUsd ? Number(minTradeUsd) : 1,
          max_trade_usd: maxTradeUsd ? Number(maxTradeUsd) : 30,
        },
        tracked_tokens: trackedTokens,
      },
      owner_signer_address: address ?? null,
    };

    try {
      setSubmitting(true);
      const response = await fetch("/api/agents", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        credentials: "include",
        body: JSON.stringify(responsePayload),
      });

      const payload = await response.json();
      if (!response.ok) {
        setError(payload.error ?? "Failed to create agent");
        return;
      }

      const agentId = payload.agent?.id as string | undefined;
      if (onCreated) {
        onCreated(agentId ?? null);
        return;
      }

      if (agentId) {
        router.push(`/agents/${agentId}`);
      } else {
        router.push("/agents");
      }
      router.refresh();
    } catch {
      setError("Failed to create agent");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className={mode === "drawer" ? "space-y-4" : "space-y-6"}>
      {mode === "page" ? (
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Create New Agent</h1>
          <p className="text-gray-500 text-sm mt-1">
            Configure and deploy an autonomous DeFi agent
          </p>
        </div>
      ) : null}

      <Card className="bg-white border-gray-200">
        <CardHeader>
          <CardTitle className="text-gray-900 text-lg">Basic Information</CardTitle>
          <CardDescription>Name and configure your agent</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="name" className="text-gray-700">
              Agent Name
            </Label>
            <Input
              id="name"
              placeholder="e.g., My Yield Optimizer"
              value={name}
              onChange={(event) => setName(event.target.value)}
              className="bg-white border-gray-300 text-gray-900 placeholder:text-gray-400"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="description" className="text-gray-700">
              Description
            </Label>
            <Textarea
              id="description"
              placeholder="Describe what this agent should do..."
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              className="bg-white border-gray-300 text-gray-900 placeholder:text-gray-400"
              rows={3}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="strategy" className="text-gray-700">
              Strategy
            </Label>
            <Select
              value={strategyId}
              onValueChange={(value) => setStrategyId(value ?? "")}
              disabled={loadingStrategies || strategies.length === 0}
            >
              <SelectTrigger className="bg-white border-gray-300 text-gray-900 w-full">
                <span className="truncate text-left">{selectedStrategyLabel}</span>
              </SelectTrigger>
              <SelectContent className="bg-white border-gray-200">
                {strategies.map((strategy) => (
                  <SelectItem key={strategy.id} value={strategy.id}>
                    {strategy.name} ({strategy.type})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-500">
            Owner signer wallet for AA derivation: {address ?? "Connect wallet in header"}
          </div>
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-700">
            Agent setup generates a dedicated signer per agent, derives a unique AA vault
            address, stores config in Supabase, and attempts an on-chain creation attestation
            when contract/env is configured.
          </div>
        </CardContent>
      </Card>

      <Card className="bg-white border-gray-200">
        <CardHeader>
          <CardTitle className="text-gray-900 text-lg">Spending Rules</CardTitle>
          <CardDescription>
            Set limits for your agent&apos;s transactions
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="dailyBudget" className="text-gray-700">
                Daily Budget (USD)
              </Label>
              <Input
                id="dailyBudget"
                type="number"
                placeholder="1000"
                value={dailyBudget}
                onChange={(event) => setDailyBudget(event.target.value)}
                className="bg-white border-gray-300 text-gray-900 placeholder:text-gray-400"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="maxPerTx" className="text-gray-700">
                Max Per Transaction (USD)
              </Label>
              <Input
                id="maxPerTx"
                type="number"
                placeholder="500"
                value={maxPerTx}
                onChange={(event) => setMaxPerTx(event.target.value)}
                className="bg-white border-gray-300 text-gray-900 placeholder:text-gray-400"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="bg-white border-gray-200">
        <CardHeader>
          <CardTitle className="text-gray-900 text-lg">Micro Position Sizing</CardTitle>
          <CardDescription>
            Keep live trades small for testnet reliability and risk control.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="risk-per-cycle" className="text-gray-700">
                Risk Per Cycle (%)
              </Label>
              <Input
                id="risk-per-cycle"
                type="number"
                min={0.1}
                step="0.1"
                value={riskPerCycle}
                onChange={(event) => setRiskPerCycle(event.target.value)}
                className="bg-white border-gray-300 text-gray-900"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="reserve-pct" className="text-gray-700">
                Reserve (%)
              </Label>
              <Input
                id="reserve-pct"
                type="number"
                min={0}
                max={95}
                step="1"
                value={reservePct}
                onChange={(event) => setReservePct(event.target.value)}
                className="bg-white border-gray-300 text-gray-900"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="min-trade-usd" className="text-gray-700">
                Min Trade (USD)
              </Label>
              <Input
                id="min-trade-usd"
                type="number"
                min={0.01}
                step="0.01"
                value={minTradeUsd}
                onChange={(event) => setMinTradeUsd(event.target.value)}
                className="bg-white border-gray-300 text-gray-900"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="max-trade-usd" className="text-gray-700">
                Max Trade (USD)
              </Label>
              <Input
                id="max-trade-usd"
                type="number"
                min={0.01}
                step="0.01"
                value={maxTradeUsd}
                onChange={(event) => setMaxTradeUsd(event.target.value)}
                className="bg-white border-gray-300 text-gray-900"
              />
            </div>
          </div>
          <p className="text-xs text-gray-500">
            Current defaults deploy most available capital each cycle (100% risk, 0% reserve).
          </p>
        </CardContent>
      </Card>

      <Card className="bg-white border-gray-200">
        <CardHeader>
          <CardTitle className="text-gray-900 text-lg">Target Allocations</CardTitle>
          <CardDescription>
            The percentage split your agent should maintain across assets/chains.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {allocations.map((allocation, index) => (
            <div key={index} className="flex items-end gap-3">
              <div className="flex-1 space-y-2">
                <Label className="text-gray-700 text-xs">Asset</Label>
                <Input
                  placeholder="e.g., USDC"
                  value={allocation.asset}
                  onChange={(event) =>
                    updateAllocation(index, "asset", event.target.value)
                  }
                  className="bg-white border-gray-300 text-gray-900 placeholder:text-gray-400"
                />
              </div>
              <div className="flex-1 space-y-2">
                <Label className="text-gray-700 text-xs">Chain</Label>
                <Input
                  placeholder="kite"
                  value={allocation.chain}
                  onChange={(event) =>
                    updateAllocation(index, "chain", event.target.value)
                  }
                  className="bg-white border-gray-300 text-gray-900 placeholder:text-gray-400"
                />
              </div>
              <div className="w-24 space-y-2">
                <Label className="text-gray-700 text-xs">%</Label>
                <Input
                  type="number"
                  placeholder="25"
                  value={allocation.percentage}
                  onChange={(event) =>
                    updateAllocation(index, "percentage", event.target.value)
                  }
                  className="bg-white border-gray-300 text-gray-900 placeholder:text-gray-400"
                />
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => removeAllocation(index)}
                className="text-gray-400 hover:text-red-500 hover:bg-gray-50 shrink-0"
                disabled={allocations.length === 1}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          ))}
          <div
            className={`text-xs ${
              normalizedAllocationTotal >= 99 && normalizedAllocationTotal <= 101
                ? "text-emerald-600"
                : "text-amber-600"
            }`}
          >
            Current total: {normalizedAllocationTotal.toFixed(2)}%
          </div>
          <Button
            type="button"
            variant="outline"
            onClick={addAllocation}
            className="w-full border-gray-300 text-gray-700 hover:bg-gray-50"
          >
            <Plus className="h-4 w-4 mr-2" />
            Add Allocation
          </Button>
        </CardContent>
      </Card>

      <Card className="bg-white border-gray-200">
        <CardHeader>
          <CardTitle className="text-gray-900 text-lg">Tracked Tokens</CardTitle>
          <CardDescription>
            Optional. One token per line: `SYMBOL,0xTokenAddress,decimals` (or colon-separated).
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-[1fr_auto] gap-3 mb-3">
            <Select
              value={quickTokenAddress}
              onValueChange={(value) => setQuickTokenAddress(value ?? "none")}
            >
              <SelectTrigger className="bg-white border-gray-300 text-gray-900 w-full">
                <span className="truncate text-left">
                  {quickTokenAddress === "none"
                    ? "Quick add common token"
                    : commonTokens.find(
                        (row) =>
                          row.address.toLowerCase() === quickTokenAddress.toLowerCase()
                      )?.label ?? "Quick add common token"}
                </span>
              </SelectTrigger>
              <SelectContent className="bg-white border-gray-200">
                <SelectItem value="none">Quick add common token</SelectItem>
                {commonTokens.map((token) => (
                  <SelectItem key={token.address} value={token.address}>
                    {token.label ?? token.symbol} - {token.address}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              type="button"
              variant="outline"
              className="border-gray-300 text-gray-700 hover:bg-gray-50"
              onClick={addQuickToken}
            >
              Add Token
            </Button>
          </div>
          <Textarea
            value={trackedTokensInput}
            onChange={(event) => setTrackedTokensInput(event.target.value)}
            placeholder={`USDT,0x0fF5393387ad2f9f691FD6Fd28e07E3969e27e63,6\nPYUSD,0x8E04D099b1a8Dd20E6caD4b2Ab2B405B98242ec9,6`}
            className="bg-white border-gray-300 text-gray-900 placeholder:text-gray-400 min-h-24"
          />
          <p className="text-xs text-gray-500 mt-2">
            Tracked token balances are used for strategy execution checks and portfolio valuation.
          </p>
        </CardContent>
      </Card>

      {error ? <p className="text-sm text-red-600">{error}</p> : null}

      <Button
        type="submit"
        disabled={submitting}
        className="w-full bg-indigo-600 hover:bg-indigo-700 text-white h-12 text-base"
      >
        <Rocket className="h-5 w-5 mr-2" />
        {submitting ? "Creating Agent..." : "Create Agent"}
      </Button>
    </form>
  );
}
