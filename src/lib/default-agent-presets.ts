export type StrategyType =
  | "rebalance"
  | "yield_optimize"
  | "dca"
  | "momentum"
  | "custom";

export type PresetAllocation = {
  asset: string;
  chain: string;
  percentage: string;
};

export type DefaultAgentPreset = {
  id: string;
  name: string;
  summary: string;
  description: string;
  strategyType: StrategyType;
  requiredStakeKite: number;
  riskLabel: "low" | "moderate" | "high";
  dailyBudgetUsd: number;
  maxPerTxUsd: number;
  allocations: PresetAllocation[];
};

export const DEFAULT_AGENT_PRESETS: DefaultAgentPreset[] = [
  {
    id: "yield-maximizer",
    name: "Yield Maximizer",
    summary: "Deposits into Lucid L-USDC and Aave v3 pools for yield.",
    description:
      "Routes liquidity toward Lucid L-USDC and Aave v3 lending pools, auto-compounding yields.",
    strategyType: "yield_optimize",
    requiredStakeKite: 1,
    riskLabel: "low",
    dailyBudgetUsd: 1200,
    maxPerTxUsd: 300,
    allocations: [
      { asset: "USDC", chain: "kite", percentage: "30" },
      { asset: "L-USDC", chain: "kite", percentage: "40" },
      { asset: "aUSDC", chain: "kite", percentage: "30" },
    ],
  },
  {
    id: "balanced-rebalancer",
    name: "Balanced Rebalancer",
    summary: "Maintains a diversified portfolio with threshold-based rebalancing.",
    description:
      "Splits exposure between stablecoins and majors while rebalancing drifts over time.",
    strategyType: "rebalance",
    requiredStakeKite: 3,
    riskLabel: "moderate",
    dailyBudgetUsd: 2500,
    maxPerTxUsd: 700,
    allocations: [
      { asset: "USDC", chain: "kite", percentage: "40" },
      { asset: "ETH", chain: "kite", percentage: "30" },
      { asset: "KITE", chain: "kite", percentage: "30" },
    ],
  },
  {
    id: "momentum-scout",
    name: "Momentum Scout",
    summary: "Takes tactical trend-following positions with tighter controls.",
    description:
      "Uses market trend signals and rotates allocations as momentum conditions change.",
    strategyType: "momentum",
    requiredStakeKite: 5,
    riskLabel: "high",
    dailyBudgetUsd: 3500,
    maxPerTxUsd: 1000,
    allocations: [
      { asset: "USDC", chain: "kite", percentage: "35" },
      { asset: "ETH", chain: "kite", percentage: "35" },
      { asset: "KITE", chain: "kite", percentage: "30" },
    ],
  },
];
