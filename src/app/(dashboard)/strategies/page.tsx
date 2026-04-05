"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { RefreshCw, TrendingUp, DollarSign, Zap } from "lucide-react";

type StrategyType = "rebalance" | "yield_optimize" | "dca" | "momentum" | "custom";

type StrategyRow = {
  id: string;
  name: string;
  type: StrategyType;
  description: string | null;
  is_template: boolean;
  rules?: unknown;
};

const icons: Record<StrategyType, React.ComponentType<{ className?: string }>> = {
  rebalance: RefreshCw,
  yield_optimize: TrendingUp,
  dca: DollarSign,
  momentum: Zap,
  custom: Zap,
};

function toObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function formatStrategyRules(type: string, rules: unknown): string {
  const r = toObject(rules);

  switch (type) {
    case "rebalance": {
      const allocations = Array.isArray(r.allocations) ? r.allocations : [];
      const allocationStr = allocations
        .map((a) => {
          const obj = toObject(a);
          const asset = String(obj.asset ?? "?");
          const pct = obj.target_pct ?? obj.percentage ?? "?";
          return `${asset} ${pct}%`;
        })
        .join(", ");
      const threshold = r.rebalance_threshold_pct ?? "?";
      return `Target allocations: ${allocationStr || "none"}. Rebalance threshold: ${threshold}%`;
    }
    case "yield_optimize": {
      const idleThreshold = r.idle_threshold_usd ?? "?";
      const protocols = Array.isArray(r.target_protocols)
        ? r.target_protocols.join(", ")
        : "any";
      return `Idle threshold: $${idleThreshold}. Target protocols: ${protocols}`;
    }
    case "dca": {
      const buyAsset = String(r.buy_asset ?? "?");
      const amount = r.spend_amount_usd ?? "?";
      const intervalHours = r.interval_hours;
      let interval = "custom";
      if (typeof intervalHours === "number") {
        if (intervalHours >= 168) interval = `every ${Math.round(intervalHours / 24)} days`;
        else if (intervalHours >= 24) interval = `every ${Math.round(intervalHours / 24)} day(s)`;
        else interval = `every ${intervalHours}h`;
      }
      return `Buy ${buyAsset}, $${amount} per purchase, ${interval}`;
    }
    case "momentum": {
      const lookback = r.lookback_hours ?? "?";
      const threshold = r.momentum_threshold_pct ?? "?";
      const assets = Array.isArray(r.assets) ? r.assets.join(", ") : "any";
      return `Lookback: ${lookback}h, threshold: ${threshold}%, assets: ${assets}`;
    }
    case "custom":
      return "Custom user-defined rules";
    default:
      return "Unknown strategy type";
  }
}

export default function StrategiesPage() {
  const [strategies, setStrategies] = useState<StrategyRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const empty = useMemo(
    () => !loading && !error && strategies.length === 0,
    [error, loading, strategies.length]
  );

  useEffect(() => {
    const load = async () => {
      try {
        setLoading(true);
        setError(null);
        const response = await fetch("/api/strategies", {
          credentials: "include",
          cache: "no-store",
        });
        const payload = await response.json();
        if (!response.ok) {
          setError(payload.error ?? "Failed to load strategies");
          return;
        }
        setStrategies((payload.strategies ?? []) as StrategyRow[]);
      } catch {
        setError("Failed to load strategies");
      } finally {
        setLoading(false);
      }
    };

    void load();
  }, []);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Strategy Catalog</h1>
        <p className="text-gray-500 text-sm mt-1">
          Strategy selection happens directly in the agent creation drawer.
        </p>
      </div>

      {loading ? <p className="text-gray-500 text-sm">Loading strategies...</p> : null}
      {error ? <p className="text-red-600 text-sm">{error}</p> : null}
      {empty ? (
        <Card className="bg-white border-gray-200">
          <CardContent className="pt-6 text-sm text-gray-500">
            No strategies found yet.
          </CardContent>
        </Card>
      ) : null}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {strategies.map((strategy) => {
          const Icon = icons[strategy.type] ?? Zap;
          return (
            <Card
              key={strategy.id}
              className="bg-white border-gray-200 hover:border-indigo-300 transition-colors"
            >
              <CardHeader>
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <div className="h-10 w-10 rounded-lg bg-indigo-50 flex items-center justify-center">
                      <Icon className="h-5 w-5 text-indigo-600" />
                    </div>
                    <div>
                      <CardTitle className="text-gray-900 text-base">{strategy.name}</CardTitle>
                      <div className="flex items-center gap-2 mt-1">
                        <Badge
                          variant="outline"
                          className="border-gray-300 text-gray-500 text-xs"
                        >
                          {strategy.type}
                        </Badge>
                        <Badge className="bg-indigo-50 text-indigo-600 border-0 text-xs">
                          {strategy.is_template ? "template" : "custom"}
                        </Badge>
                      </div>
                    </div>
                  </div>
                </div>
                <CardDescription className="mt-3">
                  {strategy.description ?? "No description provided."}
                </CardDescription>
                {strategy.rules ? (
                  <p className="text-xs text-gray-500 mt-2 bg-gray-50 rounded-md px-3 py-2 border border-gray-100">
                    {formatStrategyRules(strategy.type, strategy.rules)}
                  </p>
                ) : null}
              </CardHeader>
              <CardContent className="text-xs text-gray-500">
                Use this strategy by selecting it while creating or editing an agent.
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
