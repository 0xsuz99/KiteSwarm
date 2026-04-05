"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
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
import { Play, Pause, RotateCcw, Activity, Bot } from "lucide-react";

type AgentApiRow = {
  id: string;
  name: string;
  status: "active" | "inactive" | "paused" | "error";
  config: unknown;
  strategies:
    | {
        type: string;
        name: string;
      }
    | {
        type: string;
        name: string;
      }[]
    | null;
};

type PortfolioAgent = {
  id: string;
  total_value_usd: number;
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

const palette = [
  "#34d399",
  "#38bdf8",
  "#f59e0b",
  "#f43f5e",
  "#a78bfa",
  "#22d3ee",
  "#eab308",
  "#4ade80",
];

function toObject(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asStrategy(strategies: AgentApiRow["strategies"]) {
  if (!strategies) {
    return null;
  }
  if (Array.isArray(strategies)) {
    return strategies[0] ?? null;
  }
  return strategies;
}

function formatUsd(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function toSafeNumber(value: string, fallback: number) {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

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
  return palette[index % palette.length];
}

function SimulationChart({ points, agents }: { points: SimulationPoint[]; agents: SimulationAgent[] }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={points} margin={{ left: 8, right: 8, top: 8, bottom: 8 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
        <XAxis dataKey="day" stroke="#64748b" tickLine={false} axisLine={false} />
        <YAxis
          stroke="#64748b"
          tickLine={false}
          axisLine={false}
          tickFormatter={(value) => `$${Math.round(value).toLocaleString()}`}
        />
        <Tooltip
          contentStyle={{
            backgroundColor: "#020617",
            border: "1px solid #334155",
            borderRadius: 8,
          }}
          formatter={(value) => formatUsd(typeof value === "number" ? value : Number(value ?? 0))}
          labelFormatter={(label) => `Day ${label}`}
        />
        <Legend />
        <Line
          type="monotone"
          dataKey="benchmark"
          name="Benchmark"
          stroke="#94a3b8"
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
    <div className="h-full rounded-lg border border-slate-800 bg-slate-950/60 flex items-center justify-center text-slate-500 text-sm">
      Loading chart...
    </div>
  ),
});

export default function SimulationPage() {
  const [horizonInput, setHorizonInput] = useState("180");
  const [tickInput, setTickInput] = useState("650");
  const [driftInput, setDriftInput] = useState("0.05");
  const [volatilityInput, setVolatilityInput] = useState("2.2");
  const [shockDayInput, setShockDayInput] = useState("90");
  const [shockImpactInput, setShockImpactInput] = useState("-18");
  const [seedInput, setSeedInput] = useState("42");

  const [agents, setAgents] = useState<AgentApiRow[]>([]);
  const [portfolioAgents, setPortfolioAgents] = useState<PortfolioAgent[]>([]);
  const [loadingAgents, setLoadingAgents] = useState(true);
  const [dataError, setDataError] = useState<string | null>(null);

  const [isRunning, setIsRunning] = useState(false);
  const [currentDay, setCurrentDay] = useState(0);
  const [history, setHistory] = useState<SimulationPoint[]>([]);

  const rngRef = useRef<() => number>(() => 0.5);
  const benchmarkRef = useRef(0);
  const agentValueRef = useRef<Record<string, number>>({});
  const recentMarketRef = useRef<number[]>([]);

  const scenario = useMemo<Scenario>(() => {
    return {
      horizonDays: Math.max(Math.floor(toSafeNumber(horizonInput, 180)), 15),
      tickMs: Math.max(Math.floor(toSafeNumber(tickInput, 650)), 120),
      driftPct: clamp(toSafeNumber(driftInput, 0.05), -1, 1),
      volatilityPct: clamp(toSafeNumber(volatilityInput, 2.2), 0, 30),
      shockDay: Math.max(Math.floor(toSafeNumber(shockDayInput, 90)), 0),
      shockImpactPct: clamp(toSafeNumber(shockImpactInput, -18), -90, 90),
      seed: Math.max(Math.floor(toSafeNumber(seedInput, 42)), 1),
    };
  }, [driftInput, horizonInput, seedInput, shockDayInput, shockImpactInput, tickInput, volatilityInput]);

  const simulationAgents = useMemo<SimulationAgent[]>(() => {
    if (agents.length === 0) {
      return [];
    }

    return agents.map((agent, index) => {
      const strategy = asStrategy(agent.strategies);
      const portfolio = portfolioAgents.find((entry) => entry.id === agent.id);
      const config = toObject(agent.config);
      const configAllocations = Array.isArray(config.allocations) ? config.allocations.length : 0;

      const fallbackBase = 1000 + index * 350 + configAllocations * 90;
      const startingValue = Math.max(portfolio?.total_value_usd ?? fallbackBase, 100);

      return {
        id: agent.id,
        key: `agent_${agent.id.replace(/-/g, "")}`,
        name: agent.name,
        strategyType: strategy?.type ?? "custom",
        strategyName: strategy?.name ?? "Custom",
        startingValue,
      };
    });
  }, [agents, portfolioAgents]);

  const latestPoint = history[history.length - 1] ?? null;

  const loadAgentData = useCallback(async () => {
    try {
      setLoadingAgents(true);
      setDataError(null);

      const [agentsResponse, portfolioResponse] = await Promise.all([
        fetch("/api/agents", { credentials: "include", cache: "no-store" }),
        fetch("/api/portfolio", { credentials: "include", cache: "no-store" }),
      ]);

      const agentsPayload = await agentsResponse.json();
      const portfolioPayload = await portfolioResponse.json();

      if (!agentsResponse.ok) {
        throw new Error(agentsPayload.error ?? "Failed to load agents");
      }

      if (!portfolioResponse.ok) {
        throw new Error(portfolioPayload.error ?? "Failed to load portfolio");
      }

      setAgents((agentsPayload.agents ?? []) as AgentApiRow[]);
      setPortfolioAgents((portfolioPayload.agents ?? []) as PortfolioAgent[]);
    } catch (error) {
      setDataError(error instanceof Error ? error.message : "Failed to load simulation data");
    } finally {
      setLoadingAgents(false);
    }
  }, []);

  const initializeSimulation = useCallback(() => {
    if (simulationAgents.length === 0) {
      setHistory([]);
      setCurrentDay(0);
      return;
    }

    rngRef.current = createRng(scenario.seed);
    recentMarketRef.current = [];

    const startBenchmark = simulationAgents.reduce((sum, agent) => sum + agent.startingValue, 0);
    benchmarkRef.current = startBenchmark;

    const startAgentValues: Record<string, number> = {};
    for (const agent of simulationAgents) {
      startAgentValues[agent.key] = agent.startingValue;
    }
    agentValueRef.current = startAgentValues;

    const firstPoint: SimulationPoint = {
      day: 0,
      benchmark: startBenchmark,
      ...startAgentValues,
    };

    setHistory([firstPoint]);
    setCurrentDay(0);
  }, [scenario.seed, simulationAgents]);

  useEffect(() => {
    void loadAgentData();
  }, [loadAgentData]);

  useEffect(() => {
    initializeSimulation();
  }, [initializeSimulation]);

  useEffect(() => {
    if (!isRunning || simulationAgents.length === 0) {
      return;
    }

    const timer = setInterval(() => {
      setCurrentDay((prevDay) => {
        if (prevDay >= scenario.horizonDays) {
          setIsRunning(false);
          return prevDay;
        }

        const nextDay = prevDay + 1;
        const drift = scenario.driftPct / 100;
        const volatility = scenario.volatilityPct / 100;

        let marketReturn = drift + sampleNormal(rngRef.current) * volatility;
        if (scenario.shockDay > 0 && nextDay === scenario.shockDay) {
          marketReturn += scenario.shockImpactPct / 100;
        }

        recentMarketRef.current.push(marketReturn);
        if (recentMarketRef.current.length > 5) {
          recentMarketRef.current.shift();
        }

        const marketTrend =
          recentMarketRef.current.reduce((sum, value) => sum + value, 0) /
          Math.max(recentMarketRef.current.length, 1);

        benchmarkRef.current *= 1 + marketReturn;

        const nextAgentValues: Record<string, number> = {};

        for (const agent of simulationAgents) {
          const currentValue = agentValueRef.current[agent.key] ?? agent.startingValue;
          const profile = strategyProfile(agent.strategyType);

          let strategyReturn =
            profile.yieldBoost +
            marketReturn * profile.beta +
            marketTrend * profile.momentum +
            sampleNormal(rngRef.current) * volatility * profile.idio;

          if (marketReturn < 0) {
            strategyReturn += Math.abs(marketReturn) * profile.dipBuy;
          }

          strategyReturn = clamp(strategyReturn, -0.8, 0.8);

          const nextValue = currentValue * (1 + strategyReturn);
          nextAgentValues[agent.key] = nextValue;
        }

        agentValueRef.current = nextAgentValues;

        const nextPoint: SimulationPoint = {
          day: nextDay,
          benchmark: benchmarkRef.current,
          ...nextAgentValues,
        };

        setHistory((prevHistory) => [...prevHistory, nextPoint]);

        return nextDay;
      });
    }, scenario.tickMs);

    return () => clearInterval(timer);
  }, [isRunning, scenario, simulationAgents]);

  const liveStats = useMemo(() => {
    if (!latestPoint) {
      return [] as Array<{
        key: string;
        name: string;
        strategyName: string;
        value: number;
        returnPct: number;
      }>;
    }

    return simulationAgents.map((agent) => {
      const value = latestPoint[agent.key] ?? agent.startingValue;
      return {
        key: agent.key,
        name: agent.name,
        strategyName: agent.strategyName,
        value,
        returnPct: ((value - agent.startingValue) / agent.startingValue) * 100,
      };
    });
  }, [latestPoint, simulationAgents]);

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-white">Live Economy Simulation</h1>
          <p className="text-slate-400 text-sm mt-1">
            Real-time stress simulation using your actual agent configurations.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            className="border-slate-700 text-slate-300 hover:bg-slate-800"
            onClick={() => setIsRunning((running) => !running)}
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
            className="border-slate-700 text-slate-300 hover:bg-slate-800"
            onClick={() => {
              setIsRunning(false);
              initializeSimulation();
            }}
          >
            <RotateCcw className="h-4 w-4 mr-2" />
            Reset
          </Button>
        </div>
      </div>

      <Card className="bg-slate-900 border-slate-800">
        <CardHeader>
          <CardTitle className="text-white text-lg">Simulation Controls</CardTitle>
          <CardDescription>
            Tune macro assumptions and watch how each configured agent reacts over time.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
          <div className="space-y-2">
            <Label htmlFor="horizon" className="text-slate-300 text-xs">
              Horizon (days)
            </Label>
            <Input
              id="horizon"
              type="number"
              value={horizonInput}
              onChange={(event) => setHorizonInput(event.target.value)}
              className="bg-slate-800 border-slate-700 text-white"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="tick" className="text-slate-300 text-xs">
              Tick speed (ms)
            </Label>
            <Input
              id="tick"
              type="number"
              value={tickInput}
              onChange={(event) => setTickInput(event.target.value)}
              className="bg-slate-800 border-slate-700 text-white"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="drift" className="text-slate-300 text-xs">
              Daily drift %
            </Label>
            <Input
              id="drift"
              type="number"
              step="0.01"
              value={driftInput}
              onChange={(event) => setDriftInput(event.target.value)}
              className="bg-slate-800 border-slate-700 text-white"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="volatility" className="text-slate-300 text-xs">
              Daily volatility %
            </Label>
            <Input
              id="volatility"
              type="number"
              step="0.1"
              value={volatilityInput}
              onChange={(event) => setVolatilityInput(event.target.value)}
              className="bg-slate-800 border-slate-700 text-white"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="shock-day" className="text-slate-300 text-xs">
              Shock day
            </Label>
            <Input
              id="shock-day"
              type="number"
              value={shockDayInput}
              onChange={(event) => setShockDayInput(event.target.value)}
              className="bg-slate-800 border-slate-700 text-white"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="shock-impact" className="text-slate-300 text-xs">
              Shock impact %
            </Label>
            <Input
              id="shock-impact"
              type="number"
              value={shockImpactInput}
              onChange={(event) => setShockImpactInput(event.target.value)}
              className="bg-slate-800 border-slate-700 text-white"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="seed" className="text-slate-300 text-xs">
              Random seed
            </Label>
            <Input
              id="seed"
              type="number"
              value={seedInput}
              onChange={(event) => setSeedInput(event.target.value)}
              className="bg-slate-800 border-slate-700 text-white"
            />
          </div>

          <div className="space-y-2">
            <Label className="text-slate-300 text-xs">Live Progress</Label>
            <div className="rounded-md border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-slate-200">
              Day {currentDay} / {scenario.horizonDays}
            </div>
          </div>
        </CardContent>
      </Card>

      {loadingAgents ? <p className="text-slate-400 text-sm">Loading your agents...</p> : null}
      {dataError ? <p className="text-red-400 text-sm">{dataError}</p> : null}
      {!loadingAgents && !dataError && simulationAgents.length === 0 ? (
        <Card className="bg-slate-900 border-slate-800">
          <CardContent className="pt-6 text-sm text-slate-400">
            No agents found yet. Create at least one agent to run personalized simulation.
          </CardContent>
        </Card>
      ) : null}

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {liveStats.map((item, index) => (
          <Card key={item.key} className="bg-slate-900 border-slate-800">
            <CardContent className="pt-6">
              <div className="flex items-center gap-2 text-sm" style={{ color: lineColor(index) }}>
                <Bot className="h-4 w-4" />
                {item.name}
              </div>
              <p className="text-xs text-slate-400 mt-1">{item.strategyName}</p>
              <p className="text-2xl text-white font-semibold mt-2">{formatUsd(item.value)}</p>
              <div className="flex items-center gap-1 mt-1 text-xs">
                <Activity className="h-3 w-3 text-slate-500" />
                <span className={item.returnPct >= 0 ? "text-emerald-300" : "text-red-300"}>
                  {item.returnPct >= 0 ? "+" : ""}
                  {item.returnPct.toFixed(2)}%
                </span>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card className="bg-slate-900 border-slate-800">
        <CardHeader>
          <CardTitle className="text-white">Real-time Agent Value Curves</CardTitle>
          <CardDescription>
            Benchmark vs your agents under current scenario assumptions.
          </CardDescription>
        </CardHeader>
        <CardContent className="h-[420px]">
          {history.length > 0 ? (
            <ClientSimulationChart points={history} agents={simulationAgents} />
          ) : (
            <div className="h-full rounded-lg border border-slate-800 bg-slate-950/60 flex items-center justify-center text-slate-500 text-sm">
              Create agents to begin simulation.
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
