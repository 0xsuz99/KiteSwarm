"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAccount, useBalance } from "wagmi";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import {
  Line,
  LineChart,
  ResponsiveContainer,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
} from "recharts";
import {
  DollarSign,
  Bot,
  Activity,
  BarChart3,
  Plus,
  ExternalLink,
  Play,
  Pause,
  RotateCcw,
  Layers,
  Radio,
} from "lucide-react";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

type AgentStatus = "active" | "inactive" | "paused" | "error";

type PortfolioAgent = {
  id: string;
  name: string;
  status: AgentStatus;
  total_value_usd: number;
};

type PortfolioResponse = {
  total_value_usd: number;
  agents: PortfolioAgent[];
};

type AgentApiRow = {
  id: string;
  name: string;
  status: AgentStatus;
  aa_wallet_address: string | null;
  vault_proxy_address: string | null;
  created_at: string;
  config: unknown;
  strategies:
    | { type: string; name: string }
    | { type: string; name: string }[]
    | null;
};

type ActivityStatus = "success" | "failed" | "pending" | "executing";

type ActivityEntry = {
  id: string;
  created_at: string;
  action_type: string;
  description: string | null;
  status: ActivityStatus;
  tx_hash: string | null;
  agent: { id: string; name: string } | null;
};

type SimulationAgent = {
  id: string;
  key: string;
  name: string;
  strategyType: string;
  strategyName: string;
  startingValue: number;
};

type SimulationPoint = Record<string, number> & {
  day: number;
  benchmark: number;
};

type Scenario = {
  horizonDays: number;
  tickMs: number;
  driftPct: number;
  volatilityPct: number;
  shockDay: number;
  shockImpactPct: number;
  seed: number;
};

/* ------------------------------------------------------------------ */
/*  Color maps (light theme)                                           */
/* ------------------------------------------------------------------ */

const statusBadge: Record<AgentStatus, string> = {
  active: "bg-emerald-50 text-emerald-700 border-0",
  inactive: "bg-gray-100 text-gray-500 border-0",
  paused: "bg-amber-50 text-amber-700 border-0",
  error: "bg-red-50 text-red-700 border-0",
};

const activityStatusBadge: Record<ActivityStatus, string> = {
  success: "bg-emerald-50 text-emerald-700 border-0",
  failed: "bg-red-50 text-red-700 border-0",
  pending: "bg-amber-50 text-amber-700 border-0",
  executing: "bg-indigo-50 text-indigo-700 border-0",
};

const riskBadge: Record<DefaultAgentPreset["riskLabel"], string> = {
  low: "bg-emerald-50 text-emerald-700 border-emerald-200",
  moderate: "bg-amber-50 text-amber-700 border-amber-200",
  high: "bg-red-50 text-red-700 border-red-200",
};

const simPalette = [
  "#059669",
  "#2563eb",
  "#d97706",
  "#dc2626",
  "#7c3aed",
  "#0891b2",
  "#ca8a04",
  "#16a34a",
];

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function currency(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(value);
}

function formatUsd(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);
}

function truncateAddress(address: string): string {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function truncateHash(hash: string): string {
  return `${hash.slice(0, 10)}...${hash.slice(-6)}`;
}

function resolveStrategyName(
  strategies: AgentApiRow["strategies"]
): string {
  if (!strategies) return "No strategy";
  if (Array.isArray(strategies)) return strategies[0]?.name ?? "No strategy";
  return strategies.name;
}

function asStrategy(strategies: AgentApiRow["strategies"]) {
  if (!strategies) return null;
  if (Array.isArray(strategies)) return strategies[0] ?? null;
  return strategies;
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

function toObject(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function toSafeNumber(value: string, fallback: number) {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/* ------------------------------------------------------------------ */
/*  Simulation helpers (deterministic RNG, profiles)                   */
/* ------------------------------------------------------------------ */

function createRng(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function sampleNormal(rng: () => number) {
  const u1 = Math.max(rng(), 1e-12);
  const u2 = rng();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

function strategyProfile(type: string) {
  switch (type) {
    case "yield_optimize":
      return { beta: 0.25, idio: 0.12, yieldBoost: 0.00018, momentum: 0.05, dipBuy: 0.02 };
    case "rebalance":
      return { beta: 0.58, idio: 0.18, yieldBoost: 0.00008, momentum: 0.04, dipBuy: 0.06 };
    case "dca":
      return { beta: 0.62, idio: 0.24, yieldBoost: 0.00004, momentum: 0.02, dipBuy: 0.15 };
    case "momentum":
      return { beta: 0.82, idio: 0.28, yieldBoost: 0.00002, momentum: 0.2, dipBuy: 0.01 };
    default:
      return { beta: 0.5, idio: 0.2, yieldBoost: 0.00005, momentum: 0.05, dipBuy: 0.05 };
  }
}

function lineColor(index: number) {
  return simPalette[index % simPalette.length];
}

/* ------------------------------------------------------------------ */
/*  Simulation chart (client-only via dynamic import)                  */
/* ------------------------------------------------------------------ */

function SimulationChart({
  points,
  agents,
}: {
  points: SimulationPoint[];
  agents: SimulationAgent[];
}) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={points} margin={{ left: 8, right: 8, top: 8, bottom: 8 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
        <XAxis dataKey="day" stroke="#9ca3af" tickLine={false} axisLine={false} />
        <YAxis
          stroke="#9ca3af"
          tickLine={false}
          axisLine={false}
          tickFormatter={(value) => `$${Math.round(value).toLocaleString()}`}
        />
        <Tooltip
          contentStyle={{
            backgroundColor: "#ffffff",
            border: "1px solid #e5e7eb",
            borderRadius: 8,
          }}
          formatter={(value) =>
            formatUsd(typeof value === "number" ? value : Number(value ?? 0))
          }
          labelFormatter={(label) => `Day ${label}`}
        />
        <Legend />
        <Line
          type="monotone"
          dataKey="benchmark"
          name="Benchmark"
          stroke="#9ca3af"
          strokeWidth={2}
          dot={false}
          strokeDasharray="6 4"
        />
        {agents.map((agent, index) => (
          <Line
            key={agent.key}
            type="monotone"
            dataKey={agent.key}
            name={agent.name}
            stroke={lineColor(index)}
            strokeWidth={2.5}
            dot={false}
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}

const ClientSimulationChart = dynamic(() => Promise.resolve(SimulationChart), {
  ssr: false,
  loading: () => (
    <div className="h-full rounded-lg border border-gray-200 bg-gray-50 flex items-center justify-center text-gray-400 text-sm">
      Loading chart...
    </div>
  ),
});

/* ------------------------------------------------------------------ */
/*  Section header component                                           */
/* ------------------------------------------------------------------ */

function SectionHeader({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-4 flex-wrap">
      <div className="flex items-start gap-3">
        <div className="mt-1 h-9 w-9 rounded-lg bg-indigo-50 flex items-center justify-center shrink-0">
          <Icon className="h-5 w-5 text-indigo-500" />
        </div>
        <div>
          <h2 className="text-xl font-bold text-gray-900">{title}</h2>
          <p className="text-gray-500 text-sm mt-0.5">{description}</p>
        </div>
      </div>
      {action}
    </div>
  );
}

/* ================================================================== */
/*  MAIN PAGE COMPONENT                                                */
/* ================================================================== */

export default function DashboardPage() {
  /* ----- Wallet ----- */
  const { address } = useAccount();
  const { data: walletBalance } = useBalance({
    address,
    chainId: kiteTestnet.id,
    query: { enabled: Boolean(address) },
  });
  const availableKiteAmount =
    Number.parseFloat(walletBalance?.formatted ?? "0") || 0;

  /* ----- Dashboard data ----- */
  const [portfolio, setPortfolio] = useState<PortfolioResponse | null>(null);
  const [agents, setAgents] = useState<AgentApiRow[]>([]);
  const [activityEntries, setActivityEntries] = useState<ActivityEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  /* ----- Agent creation drawer ----- */
  const [createOpen, setCreateOpen] = useState(false);
  const [formKey, setFormKey] = useState(0);
  const [selectedPreset, setSelectedPreset] =
    useState<CreateAgentFormPreset | null>(null);

  /* ----- Simulation state ----- */
  const [horizonInput, setHorizonInput] = useState("180");
  const [tickInput, setTickInput] = useState("650");
  const [driftInput, setDriftInput] = useState("0.05");
  const [volatilityInput, setVolatilityInput] = useState("2.2");
  const [shockDayInput, setShockDayInput] = useState("90");
  const [shockImpactInput, setShockImpactInput] = useState("-18");
  const [seedInput, setSeedInput] = useState("42");

  const [isRunning, setIsRunning] = useState(false);
  const [currentDay, setCurrentDay] = useState(0);
  const [history, setHistory] = useState<SimulationPoint[]>([]);

  const rngRef = useRef<() => number>(() => 0.5);
  const benchmarkRef = useRef(0);
  const agentValueRef = useRef<Record<string, number>>({});
  const recentMarketRef = useRef<number[]>([]);

  /* ----- Derived ----- */
  const activeAgents = useMemo(
    () =>
      portfolio?.agents.filter((a) => a.status === "active").length ?? 0,
    [portfolio?.agents]
  );

  const scenario = useMemo<Scenario>(
    () => ({
      horizonDays: Math.max(Math.floor(toSafeNumber(horizonInput, 180)), 15),
      tickMs: Math.max(Math.floor(toSafeNumber(tickInput, 650)), 120),
      driftPct: clamp(toSafeNumber(driftInput, 0.05), -1, 1),
      volatilityPct: clamp(toSafeNumber(volatilityInput, 2.2), 0, 30),
      shockDay: Math.max(Math.floor(toSafeNumber(shockDayInput, 90)), 0),
      shockImpactPct: clamp(toSafeNumber(shockImpactInput, -18), -90, 90),
      seed: Math.max(Math.floor(toSafeNumber(seedInput, 42)), 1),
    }),
    [
      driftInput,
      horizonInput,
      seedInput,
      shockDayInput,
      shockImpactInput,
      tickInput,
      volatilityInput,
    ]
  );

  const simulationAgents = useMemo<SimulationAgent[]>(() => {
    if (agents.length === 0) return [];
    const portfolioAgents = portfolio?.agents ?? [];
    return agents.map((agent, index) => {
      const strategy = asStrategy(agent.strategies);
      const pa = portfolioAgents.find((e) => e.id === agent.id);
      const config = toObject(agent.config);
      const configAllocations = Array.isArray(config.allocations)
        ? config.allocations.length
        : 0;
      const fallbackBase = 1000 + index * 350 + configAllocations * 90;
      const startingValue = Math.max(pa?.total_value_usd ?? fallbackBase, 100);
      return {
        id: agent.id,
        key: `agent_${agent.id.replace(/-/g, "")}`,
        name: agent.name,
        strategyType: strategy?.type ?? "custom",
        strategyName: strategy?.name ?? "Custom",
        startingValue,
      };
    });
  }, [agents, portfolio?.agents]);

  const latestPoint = history[history.length - 1] ?? null;

  const liveStats = useMemo(() => {
    if (!latestPoint) return [] as Array<{ key: string; name: string; strategyName: string; value: number; returnPct: number }>;
    return simulationAgents.map((agent) => {
      const value = latestPoint[agent.key] ?? agent.startingValue;
      return {
        key: agent.key,
        name: agent.name,
        strategyName: agent.strategyName,
        value,
        returnPct:
          ((value - agent.startingValue) / agent.startingValue) * 100,
      };
    });
  }, [latestPoint, simulationAgents]);

  /* ----- Data loading ----- */
  const loadAll = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const [portfolioRes, agentsRes, activityRes] =
        await Promise.all([
          fetch("/api/portfolio", { credentials: "include", cache: "no-store" }),
          fetch("/api/agents", { credentials: "include", cache: "no-store" }),
          fetch("/api/activity?page=1&pageSize=25", {
            credentials: "include",
            cache: "no-store",
          }),
        ]);

      const [portfolioJson, agentsJson, activityJson] =
        await Promise.all([
          portfolioRes.json(),
          agentsRes.json(),
          activityRes.json(),
        ]);

      if (!portfolioRes.ok)
        throw new Error(portfolioJson.error ?? "Failed to load portfolio");
      if (!agentsRes.ok)
        throw new Error(agentsJson.error ?? "Failed to load agents");
      if (!activityRes.ok)
        throw new Error(activityJson.error ?? "Failed to load activity");

      setPortfolio(portfolioJson as PortfolioResponse);
      setAgents((agentsJson.agents ?? []) as AgentApiRow[]);
      setActivityEntries(
        (activityJson.activity ?? []) as ActivityEntry[]
      );
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to load dashboard"
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  useEffect(() => {
    const handleAutoExecuted = () => {
      void loadAll();
    };

    window.addEventListener("kiteswarm:auto-executed", handleAutoExecuted);
    return () => {
      window.removeEventListener("kiteswarm:auto-executed", handleAutoExecuted);
    };
  }, [loadAll]);

  /* ----- Simulation init / tick ----- */
  const initializeSimulation = useCallback(() => {
    if (simulationAgents.length === 0) {
      setHistory([]);
      setCurrentDay(0);
      return;
    }
    rngRef.current = createRng(scenario.seed);
    recentMarketRef.current = [];
    const startBenchmark = simulationAgents.reduce(
      (s, a) => s + a.startingValue,
      0
    );
    benchmarkRef.current = startBenchmark;
    const startVals: Record<string, number> = {};
    for (const a of simulationAgents) startVals[a.key] = a.startingValue;
    agentValueRef.current = startVals;
    setHistory([{ day: 0, benchmark: startBenchmark, ...startVals }]);
    setCurrentDay(0);
  }, [scenario.seed, simulationAgents]);

  useEffect(() => {
    initializeSimulation();
  }, [initializeSimulation]);

  useEffect(() => {
    if (!isRunning || simulationAgents.length === 0) return;
    const timer = setInterval(() => {
      setCurrentDay((prev) => {
        if (prev >= scenario.horizonDays) {
          setIsRunning(false);
          return prev;
        }
        const nextDay = prev + 1;
        const drift = scenario.driftPct / 100;
        const volatility = scenario.volatilityPct / 100;
        let marketReturn =
          drift + sampleNormal(rngRef.current) * volatility;
        if (scenario.shockDay > 0 && nextDay === scenario.shockDay)
          marketReturn += scenario.shockImpactPct / 100;
        recentMarketRef.current.push(marketReturn);
        if (recentMarketRef.current.length > 5)
          recentMarketRef.current.shift();
        const marketTrend =
          recentMarketRef.current.reduce((s, v) => s + v, 0) /
          Math.max(recentMarketRef.current.length, 1);
        benchmarkRef.current *= 1 + marketReturn;
        const nextVals: Record<string, number> = {};
        for (const agent of simulationAgents) {
          const cur =
            agentValueRef.current[agent.key] ?? agent.startingValue;
          const p = strategyProfile(agent.strategyType);
          let ret =
            p.yieldBoost +
            marketReturn * p.beta +
            marketTrend * p.momentum +
            sampleNormal(rngRef.current) * volatility * p.idio;
          if (marketReturn < 0) ret += Math.abs(marketReturn) * p.dipBuy;
          ret = clamp(ret, -0.8, 0.8);
          nextVals[agent.key] = cur * (1 + ret);
        }
        agentValueRef.current = nextVals;
        setHistory((h) => [
          ...h,
          { day: nextDay, benchmark: benchmarkRef.current, ...nextVals },
        ]);
        return nextDay;
      });
    }, scenario.tickMs);
    return () => clearInterval(timer);
  }, [isRunning, scenario, simulationAgents]);

  /* ----- Agent creation drawer helpers ----- */
  const openCreateDrawer = (preset: CreateAgentFormPreset | null) => {
    setSelectedPreset(preset);
    setFormKey((c) => c + 1);
    setCreateOpen(true);
  };

  const handleCreated = async () => {
    setCreateOpen(false);
    setSelectedPreset(null);
    await loadAll();
  };

  /* ================================================================ */
  /*  RENDER                                                           */
  /* ================================================================ */

  return (
    <div className="space-y-10 pb-16">
      {/* Page title */}
      <div>
        <h1 className="text-3xl font-bold text-gray-900">Dashboard</h1>
        <p className="text-gray-500 text-sm mt-1">
          Unified view of your DeFi portfolio, agents, strategies, simulation,
          and activity.
        </p>
        <p className="text-emerald-600 text-xs mt-1">
          Autonomous engine is enabled. Active agents auto-run in the background.
        </p>
      </div>

      {loading ? (
        <p className="text-gray-500 text-sm">Loading dashboard...</p>
      ) : null}
      {error ? <p className="text-red-600 text-sm">{error}</p> : null}

      {/* ============================================================ */}
      {/*  SECTION 1 - Portfolio Overview                               */}
      {/* ============================================================ */}
      <section className="space-y-4">
        <SectionHeader
          icon={BarChart3}
          title="Portfolio Overview"
          description="Key metrics across all your agents"
        />

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <Card className="bg-white border border-gray-200">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-gray-500">
                Total Portfolio Value
              </CardTitle>
              <DollarSign className="h-4 w-4 text-indigo-500" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-gray-900">
                {currency(portfolio?.total_value_usd ?? 0)}
              </div>
              <p className="text-xs text-gray-400 mt-1">Across all agents</p>
            </CardContent>
          </Card>

          <Card className="bg-white border border-gray-200">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-gray-500">
                Active Agents
              </CardTitle>
              <Bot className="h-4 w-4 text-indigo-500" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-gray-900">
                {activeAgents}
              </div>
              <p className="text-xs text-gray-400 mt-1">
                {portfolio?.agents.length ?? 0} total agents
              </p>
            </CardContent>
          </Card>

          <Card className="bg-white border border-gray-200">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-gray-500">
                Total Executions
              </CardTitle>
              <BarChart3 className="h-4 w-4 text-indigo-500" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-gray-900">
                {activityEntries.length}
              </div>
              <p className="text-xs text-gray-400 mt-1">Last 100 records</p>
            </CardContent>
          </Card>

          <Card className="bg-white border border-gray-200">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-gray-500">
                Recent Activity
              </CardTitle>
              <Activity className="h-4 w-4 text-indigo-500" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-gray-900">
                {activityEntries.slice(0, 5).length}
              </div>
              <p className="text-xs text-gray-400 mt-1">Most recent events</p>
            </CardContent>
          </Card>
        </div>
      </section>

      {/* ============================================================ */}
      {/*  SECTION 2 - Your Agents                                      */}
      {/* ============================================================ */}
      <section className="space-y-4">
        <SectionHeader
          icon={Bot}
          title="Your Agents"
          description="Manage your autonomous DeFi agents"
          action={
            <Button
              className="bg-indigo-600 hover:bg-indigo-700 text-white"
              onClick={() => openCreateDrawer(null)}
            >
              <Plus className="h-4 w-4 mr-2" />
              Create Agent
            </Button>
          }
        />

        {/* Featured presets */}
        <Card className="bg-white border border-gray-200 overflow-hidden">
          <CardHeader className="bg-gradient-to-r from-indigo-50 via-white to-white">
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div>
                <CardTitle className="text-gray-900 text-lg">
                  Featured Agent Presets
                </CardTitle>
                <CardDescription className="text-gray-500">
                  Use curated starter agents. Unlock based on your connected
                  wallet KITE balance on Kite testnet.
                </CardDescription>
              </div>
              <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-right min-w-[200px]">
                <p className="text-xs text-gray-400">Connected Wallet KITE</p>
                <p className="text-sm text-gray-900 mt-1">
                  {walletBalance?.formatted
                    ? `${Number(walletBalance.formatted).toFixed(4)} KITE`
                    : "Connect wallet"}
                </p>
              </div>
            </div>
          </CardHeader>
          <CardContent className="pt-6 grid grid-cols-1 xl:grid-cols-3 gap-4">
            {DEFAULT_AGENT_PRESETS.map((preset) => {
              const suggested =
                availableKiteAmount >= preset.requiredStakeKite;
              return (
                <Card
                  key={preset.id}
                  className="bg-gray-50 border border-gray-200"
                >
                  <CardHeader>
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <CardTitle className="text-gray-900 text-base">
                          {preset.name}
                        </CardTitle>
                        <CardDescription className="mt-1 text-gray-500">
                          {preset.summary}
                        </CardDescription>
                      </div>
                      <Badge
                        variant="outline"
                        className={riskBadge[preset.riskLabel]}
                      >
                        {preset.riskLabel} risk
                      </Badge>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="text-xs text-gray-500">
                      Minimum wallet balance:{" "}
                      <span className="text-gray-900 font-medium">
                        {preset.requiredStakeKite.toLocaleString()} KITE
                      </span>
                    </div>
                    <div className="text-xs text-gray-500">
                      Strategy:{" "}
                      <span className="text-gray-700">
                        {preset.strategyType}
                      </span>
                    </div>
                    <div className="text-xs text-gray-400">
                      Budget: ${preset.dailyBudgetUsd}/day, $
                      {preset.maxPerTxUsd} max per tx
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

        {/* Created agents */}
        <p className="text-sm text-gray-500 font-medium">Created agents</p>

        {!loading && !error && agents.length === 0 ? (
          <Card className="bg-white border border-gray-200">
            <CardContent className="pt-6 text-sm text-gray-500">
              No agents yet. Create your first one to start autonomous
              execution.
            </CardContent>
          </Card>
        ) : null}

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {agents.map((agent) => {
            const wallet =
              agent.aa_wallet_address ?? agent.vault_proxy_address;
            return (
              <Link key={agent.id} href={`/agents/${agent.id}`}>
                <Card className="bg-white border border-gray-200 hover:border-indigo-400 transition-colors cursor-pointer h-full">
                  <CardHeader className="pb-3">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <div className="h-8 w-8 rounded-lg bg-indigo-50 flex items-center justify-center">
                          <Bot className="h-4 w-4 text-indigo-500" />
                        </div>
                        <CardTitle className="text-gray-900 text-base">
                          {agent.name}
                        </CardTitle>
                      </div>
                      <Badge className={statusBadge[agent.status]}>
                        {agent.status}
                      </Badge>
                    </div>
                    <CardDescription className="mt-2 text-gray-500">
                      Strategy: {resolveStrategyName(agent.strategies)}
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-gray-400">AA Wallet</span>
                      <code className="text-gray-700 text-xs bg-gray-100 px-2 py-0.5 rounded">
                        {wallet
                          ? truncateAddress(wallet)
                          : "Not configured"}
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
      </section>

      {/* ============================================================ */}
      {/*  SECTION 3 - Live Simulation                                  */}
      {/* ============================================================ */}
      <section className="space-y-4">
        <SectionHeader
          icon={Radio}
          title="Live Economy Simulation"
          description="Real-time stress simulation using your actual agent configurations"
          action={
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                className="border-gray-300 text-gray-700 hover:bg-gray-50"
                onClick={() => setIsRunning((r) => !r)}
                disabled={simulationAgents.length === 0}
              >
                {isRunning ? (
                  <>
                    <Pause className="h-4 w-4 mr-2" />
                    Pause
                  </>
                ) : (
                  <>
                    <Play className="h-4 w-4 mr-2" />
                    Run
                  </>
                )}
              </Button>
              <Button
                variant="outline"
                className="border-gray-300 text-gray-700 hover:bg-gray-50"
                onClick={() => {
                  setIsRunning(false);
                  initializeSimulation();
                }}
              >
                <RotateCcw className="h-4 w-4 mr-2" />
                Reset
              </Button>
            </div>
          }
        />

        {/* Controls */}
        <Card className="bg-white border border-gray-200">
          <CardHeader>
            <CardTitle className="text-gray-900 text-lg">
              Simulation Controls
            </CardTitle>
            <CardDescription className="text-gray-500">
              Tune macro assumptions and watch how each agent reacts over time.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
            <div className="space-y-2">
              <Label htmlFor="horizon" className="text-gray-700 text-xs">
                Horizon (days)
              </Label>
              <Input
                id="horizon"
                type="number"
                value={horizonInput}
                onChange={(e) => setHorizonInput(e.target.value)}
                className="bg-white border-gray-300 text-gray-900"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="tick" className="text-gray-700 text-xs">
                Tick speed (ms)
              </Label>
              <Input
                id="tick"
                type="number"
                value={tickInput}
                onChange={(e) => setTickInput(e.target.value)}
                className="bg-white border-gray-300 text-gray-900"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="drift" className="text-gray-700 text-xs">
                Daily drift %
              </Label>
              <Input
                id="drift"
                type="number"
                step="0.01"
                value={driftInput}
                onChange={(e) => setDriftInput(e.target.value)}
                className="bg-white border-gray-300 text-gray-900"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="volatility" className="text-gray-700 text-xs">
                Daily volatility %
              </Label>
              <Input
                id="volatility"
                type="number"
                step="0.1"
                value={volatilityInput}
                onChange={(e) => setVolatilityInput(e.target.value)}
                className="bg-white border-gray-300 text-gray-900"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="shock-day" className="text-gray-700 text-xs">
                Shock day
              </Label>
              <Input
                id="shock-day"
                type="number"
                value={shockDayInput}
                onChange={(e) => setShockDayInput(e.target.value)}
                className="bg-white border-gray-300 text-gray-900"
              />
            </div>
            <div className="space-y-2">
              <Label
                htmlFor="shock-impact"
                className="text-gray-700 text-xs"
              >
                Shock impact %
              </Label>
              <Input
                id="shock-impact"
                type="number"
                value={shockImpactInput}
                onChange={(e) => setShockImpactInput(e.target.value)}
                className="bg-white border-gray-300 text-gray-900"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="seed" className="text-gray-700 text-xs">
                Random seed
              </Label>
              <Input
                id="seed"
                type="number"
                value={seedInput}
                onChange={(e) => setSeedInput(e.target.value)}
                className="bg-white border-gray-300 text-gray-900"
              />
            </div>
            <div className="space-y-2">
              <Label className="text-gray-700 text-xs">Live Progress</Label>
              <div className="rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-700">
                Day {currentDay} / {scenario.horizonDays}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Agent value cards */}
        {!loading && simulationAgents.length === 0 ? (
          <Card className="bg-white border border-gray-200">
            <CardContent className="pt-6 text-sm text-gray-500">
              No agents found. Create at least one agent to run personalized
              simulation.
            </CardContent>
          </Card>
        ) : null}

        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {liveStats.map((item, index) => (
            <Card
              key={item.key}
              className="bg-white border border-gray-200"
            >
              <CardContent className="pt-6">
                <div
                  className="flex items-center gap-2 text-sm font-medium"
                  style={{ color: lineColor(index) }}
                >
                  <Bot className="h-4 w-4" />
                  {item.name}
                </div>
                <p className="text-xs text-gray-400 mt-1">
                  {item.strategyName}
                </p>
                <p className="text-2xl text-gray-900 font-semibold mt-2">
                  {formatUsd(item.value)}
                </p>
                <div className="flex items-center gap-1 mt-1 text-xs">
                  <Activity className="h-3 w-3 text-gray-400" />
                  <span
                    className={
                      item.returnPct >= 0
                        ? "text-emerald-600"
                        : "text-red-600"
                    }
                  >
                    {item.returnPct >= 0 ? "+" : ""}
                    {item.returnPct.toFixed(2)}%
                  </span>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Chart */}
        <Card className="bg-white border border-gray-200">
          <CardHeader>
            <CardTitle className="text-gray-900">
              Real-time Agent Value Curves
            </CardTitle>
            <CardDescription className="text-gray-500">
              Benchmark vs your agents under current scenario assumptions.
            </CardDescription>
          </CardHeader>
          <CardContent className="h-[420px]">
            {history.length > 0 ? (
              <ClientSimulationChart
                points={history}
                agents={simulationAgents}
              />
            ) : (
              <div className="h-full rounded-lg border border-gray-200 bg-gray-50 flex items-center justify-center text-gray-400 text-sm">
                Create agents to begin simulation.
              </div>
            )}
          </CardContent>
        </Card>
      </section>

      {/* ============================================================ */}
      {/*  SECTION 4 - Activity Feed                                    */}
      {/* ============================================================ */}
      <section className="space-y-4">
        <SectionHeader
          icon={Layers}
          title="Activity Feed"
          description="Global activity log across all agents"
        />

        {!loading && !error && activityEntries.length === 0 ? (
          <Card className="bg-white border border-gray-200">
            <CardContent className="pt-6 text-sm text-gray-500">
              No executions yet.
            </CardContent>
          </Card>
        ) : null}

        <Card className="bg-white border border-gray-200">
          <CardHeader>
            <CardTitle className="text-gray-900">All Transactions</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow className="border-gray-100 hover:bg-transparent">
                  <TableHead className="text-gray-500">Time</TableHead>
                  <TableHead className="text-gray-500">Agent</TableHead>
                  <TableHead className="text-gray-500">Action Type</TableHead>
                  <TableHead className="text-gray-500">Description</TableHead>
                  <TableHead className="text-gray-500">Status</TableHead>
                  <TableHead className="text-gray-500">Tx Hash</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {activityEntries.map((entry) => (
                  <TableRow key={entry.id} className="border-gray-100">
                    <TableCell className="text-gray-700 text-sm whitespace-nowrap">
                      {new Date(entry.created_at).toLocaleString()}
                    </TableCell>
                    <TableCell className="text-gray-700 text-sm">
                      {entry.agent?.name ?? "Unknown Agent"}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant="outline"
                        className="border-indigo-200 text-indigo-700"
                      >
                        {entry.action_type}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-gray-700 text-sm max-w-[250px] truncate">
                      {entry.description ?? "-"}
                    </TableCell>
                    <TableCell>
                      <Badge className={activityStatusBadge[entry.status]}>
                        {entry.status}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {entry.tx_hash ? (
                        <a
                          href={`https://testnet.kitescan.ai/tx/${entry.tx_hash}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-indigo-600 hover:text-indigo-500 text-sm flex items-center gap-1"
                        >
                          {truncateHash(entry.tx_hash)}
                          <ExternalLink className="h-3 w-3" />
                        </a>
                      ) : (
                        <span className="text-gray-400 text-sm">-</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </section>

      {/* ============================================================ */}
      {/*  Create Agent Sheet Drawer                                    */}
      {/* ============================================================ */}
      <Sheet open={createOpen} onOpenChange={setCreateOpen}>
        <SheetContent
          side="right"
          className="w-full sm:max-w-5xl p-0 bg-white border-gray-200 text-gray-900 overflow-y-auto"
        >
          <SheetHeader className="px-6 py-5 border-b border-gray-200">
            <SheetTitle className="text-gray-900 text-lg">
              {selectedPreset
                ? "Create Agent From Preset"
                : "Create New Agent"}
            </SheetTitle>
            <SheetDescription className="text-gray-500">
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
