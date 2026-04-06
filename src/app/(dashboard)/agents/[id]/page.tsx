"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { isAddress, parseEther, parseUnits } from "viem";
import {
  useAccount,
  useBalance,
  useReadContract,
  useSendTransaction,
  useWriteContract,
  useWaitForTransactionReceipt,
} from "wagmi";
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select";
import {
  Pause,
  Play,
  Bot,
  ExternalLink,
  Wallet,
  ArrowDownToLine,
  Shield,
  RotateCcw,
  Trash2,
} from "lucide-react";
import { getExplorerAddressUrl, getExplorerTxUrl, kiteTestnet } from "@/lib/kite-chain";
import { getKiteTokensByChainId, type KiteToken } from "@/lib/kite-tokens";
import { createClient as createSupabaseClient } from "@/lib/supabase/client";
import {
  LineChart,
  Line,
  ResponsiveContainer,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
} from "recharts";

type AgentStatus = "active" | "paused" | "inactive" | "error";

type StrategyRow = {
  id: string;
  name: string;
  type: string;
  description: string | null;
  rules: unknown;
};

type AgentRow = {
  id: string;
  name: string;
  description: string | null;
  status: AgentStatus;
  aa_wallet_address: string | null;
  vault_proxy_address: string | null;
  config: unknown;
  spending_rules: unknown;
  strategies: StrategyRow | StrategyRow[] | null;
};

type ExecutionLogRow = {
  id: string;
  created_at: string;
  action_type: string;
  description: string | null;
  status: "pending" | "executing" | "success" | "failed";
  tx_hash: string | null;
  attestation_tx_hash: string | null;
  decision: unknown;
};

type PortfolioSummary = {
  id: string;
  total_value_usd: number;
  holdings: unknown;
};

type HoldingRow = {
  asset: string;
  value_usd: number;
  amount?: string;
};

type PerformancePoint = {
  snapshot_at: string;
  total_value_usd: number;
};

type PerformanceMetrics = {
  first_value_usd: number;
  latest_value_usd: number;
  pnl_usd: number;
  pnl_pct: number;
};

type TrackedTokenRow = {
  symbol: string;
  address: string;
  decimals: number;
};

type AllocationRow = {
  asset: string;
  chain: string;
  targetPct: number;
};

const statusColors: Record<AgentStatus, string> = {
  active: "bg-emerald-50 text-emerald-700 border-0",
  inactive: "bg-gray-100 text-gray-500 border-0",
  paused: "bg-amber-50 text-amber-700 border-0",
  error: "bg-red-50 text-red-700 border-0",
};

function truncateHash(hash: string): string {
  return `${hash.slice(0, 10)}...${hash.slice(-6)}`;
}

function formatUsd(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(value);
}

function toFiniteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number.parseFloat(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return null;
}

function isStablecoinSymbol(asset: string): boolean {
  const symbol = asset.trim().toUpperCase();
  return ["USDT", "USDC", "DAI", "PYUSD", "USDS", "FDUSD"].includes(symbol);
}

function toObject(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function parseHoldings(holdings: unknown) {
  if (!Array.isArray(holdings)) {
    return [] as HoldingRow[];
  }

  return holdings
    .map((item) => {
      if (typeof item !== "object" || item === null) {
        return null;
      }

      const row = item as {
        asset?: unknown;
        value_usd?: unknown;
        amount?: unknown;
      };

      if (typeof row.asset !== "string") {
        return null;
      }

      const holding: HoldingRow = {
        asset: row.asset,
        value_usd:
          typeof row.value_usd === "number"
            ? row.value_usd
            : Number(row.value_usd ?? 0),
      };

      if (typeof row.amount === "string") {
        holding.amount = row.amount;
      }

      return holding;
    })
    .filter((item): item is HoldingRow => item !== null);
}

function parseStrategy(strategies: AgentRow["strategies"]) {
  if (!strategies) {
    return null;
  }

  if (Array.isArray(strategies)) {
    return strategies[0] ?? null;
  }

  return strategies;
}

function parseAllocations(agent: AgentRow, strategy: StrategyRow | null): AllocationRow[] {
  const strategyRules = toObject(strategy?.rules ?? null);
  const config = toObject(agent.config);

  const fromConfig = Array.isArray(config.allocations) ? config.allocations : [];
  const fromRules = Array.isArray(strategyRules.allocations) ? strategyRules.allocations : [];

  const source = fromConfig.length > 0 ? fromConfig : fromRules;

  return source
    .map((entry) => {
      if (typeof entry !== "object" || entry === null) {
        return null;
      }

      const row = entry as Record<string, unknown>;
      const asset = typeof row.asset === "string" ? row.asset : null;
      if (!asset) {
        return null;
      }

      const chain = typeof row.chain === "string" ? row.chain : "kite";
      const rawTarget =
        typeof row.target_pct === "number"
          ? row.target_pct
          : typeof row.target_pct === "string"
            ? Number(row.target_pct)
            : typeof row.percentage === "number"
              ? row.percentage
              : typeof row.percentage === "string"
                ? Number(row.percentage)
                : 0;

      return {
        asset,
        chain,
        targetPct: Number.isFinite(rawTarget) ? rawTarget : 0,
      } satisfies AllocationRow;
    })
    .filter((entry): entry is AllocationRow => entry !== null);
}

function parseProtocols(strategy: StrategyRow | null) {
  const rules = toObject(strategy?.rules ?? null);

  const protocols = new Set<string>();

  const candidateLists = [
    rules.target_protocols,
    rules.targetProviders,
    rules.pools,
  ];

  for (const list of candidateLists) {
    if (!Array.isArray(list)) {
      continue;
    }

    for (const item of list) {
      if (typeof item === "string" && item.trim().length > 0) {
        protocols.add(item);
      }
    }
  }

  if (typeof rules.buy_asset === "string") {
    protocols.add(`buy:${rules.buy_asset}`);
  }

  if (protocols.size === 0 && strategy?.type === "yield_optimize") {
    protocols.add("lucid");
  }

  return Array.from(protocols);
}

function strategyTitle(strategy: StrategyRow | null) {
  if (!strategy) {
    return "No strategy";
  }

  return `${strategy.name} (${strategy.type})`;
}

function parseTrackedTokensFromConfig(config: unknown): TrackedTokenRow[] {
  const obj = toObject(config);
  const list = Array.isArray(obj.tracked_tokens) ? obj.tracked_tokens : [];
  const tokens: TrackedTokenRow[] = [];

  for (const item of list) {
    if (!item || typeof item !== "object") {
      continue;
    }

    const row = item as Record<string, unknown>;
    const symbol =
      typeof row.symbol === "string" && row.symbol.trim().length > 0
        ? row.symbol.toUpperCase()
        : null;
    const address =
      typeof row.address === "string" && isAddress(row.address)
        ? row.address
        : null;
    const decimalsRaw =
      typeof row.decimals === "number"
        ? row.decimals
        : typeof row.decimals === "string"
          ? Number.parseInt(row.decimals, 10)
          : 18;
    const decimals = Number.isFinite(decimalsRaw) ? Math.max(Math.min(decimalsRaw, 30), 0) : 18;

    if (!symbol || !address) {
      continue;
    }

    tokens.push({ symbol, address, decimals });
  }

  return tokens;
}

const erc20TransferAbi = [
  {
    type: "function",
    name: "transfer",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
] as const;

function decisionSummary(entry: ExecutionLogRow): string {
  const decision = toObject(entry.decision);

  if (typeof decision.description === "string" && decision.description.trim().length > 0) {
    return decision.description;
  }

  if (Array.isArray(decision.actions) && decision.actions.length > 0) {
    const first = toObject(decision.actions[0]);
    const firstDescription =
      typeof first.description === "string" && first.description.trim().length > 0
        ? first.description
        : entry.description ?? "Decision recorded";
    return decision.actions.length > 1
      ? `${firstDescription} (+${decision.actions.length - 1} more action${decision.actions.length > 2 ? "s" : ""})`
      : firstDescription;
  }

  const params = toObject(decision.params);
  const fromAsset =
    typeof params.from_asset === "string" ? params.from_asset : null;
  const toAsset =
    typeof params.to_asset === "string" ? params.to_asset : null;
  const protocol =
    typeof params.protocol === "string" ? params.protocol : null;

  if (fromAsset && toAsset) {
    return `Swap ${fromAsset} into ${toAsset}`;
  }
  if (entry.action_type === "yield_deposit" && protocol) {
    return `Deposit funds into ${protocol}`;
  }
  if (entry.action_type === "yield_withdraw" && protocol) {
    return `Withdraw funds from ${protocol}`;
  }

  return entry.description ?? "Decision recorded";
}

export default function AgentDetailPage() {
  const router = useRouter();
  const params = useParams();
  const id = params.id as string;

  const { address: connectedWallet } = useAccount();

  const [agent, setAgent] = useState<AgentRow | null>(null);
  const [logs, setLogs] = useState<ExecutionLogRow[]>([]);
  const [portfolioAgent, setPortfolioAgent] = useState<PortfolioSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [savingSpendingRules, setSavingSpendingRules] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [performancePoints, setPerformancePoints] = useState<PerformancePoint[]>([]);
  const [performanceMetrics, setPerformanceMetrics] = useState<PerformanceMetrics | null>(null);
  const [dailyBudgetInput, setDailyBudgetInput] = useState("");
  const [maxPerTxInput, setMaxPerTxInput] = useState("");

  const [fundAmount, setFundAmount] = useState("0.1");
  const [withdrawAmount, setWithdrawAmount] = useState("0.01");
  const [fundingTxHash, setFundingTxHash] = useState<`0x${string}` | null>(null);
  const [withdrawTxHash, setWithdrawTxHash] = useState<`0x${string}` | null>(null);
  const [selectedCommonFundingToken, setSelectedCommonFundingToken] = useState("custom");
  const [tokenAddress, setTokenAddress] = useState("");
  const [tokenAmount, setTokenAmount] = useState("1");
  const [tokenFundingTxHash, setTokenFundingTxHash] = useState<`0x${string}` | null>(null);
  const [tokenWithdrawTxHash, setTokenWithdrawTxHash] = useState<`0x${string}` | null>(null);
  const [trackingPresetAddress, setTrackingPresetAddress] = useState("none");
  const [trackingCustomSymbol, setTrackingCustomSymbol] = useState("");
  const [trackingCustomAddress, setTrackingCustomAddress] = useState("");
  const [trackingCustomDecimals, setTrackingCustomDecimals] = useState("18");
  const [savingTrackedTokens, setSavingTrackedTokens] = useState(false);

  const wallet = agent?.aa_wallet_address ?? agent?.vault_proxy_address ?? null;
  const strategy = useMemo(() => parseStrategy(agent?.strategies ?? null), [agent?.strategies]);
  const holdings = useMemo(
    () => parseHoldings(portfolioAgent?.holdings ?? null),
    [portfolioAgent?.holdings]
  );
  const allocations = useMemo(() => (agent ? parseAllocations(agent, strategy) : []), [agent, strategy]);
  const protocols = useMemo(() => parseProtocols(strategy), [strategy]);
  const spendingRules = useMemo(() => toObject(agent?.spending_rules ?? null), [agent?.spending_rules]);
  const suspiciousStablecoinHoldings = useMemo(
    () =>
      holdings.filter(
        (holding) => isStablecoinSymbol(holding.asset) && Number(holding.amount ?? "0") > 1_000_000
      ),
    [holdings]
  );
  const trackedTokens = useMemo(
    () => parseTrackedTokensFromConfig(agent?.config ?? null),
    [agent?.config]
  );
  const commonTokens = useMemo<KiteToken[]>(
    () => getKiteTokensByChainId(kiteTestnet.id),
    []
  );
  const selectedCommonToken = useMemo(
    () =>
      selectedCommonFundingToken === "custom"
        ? null
        : commonTokens.find(
            (entry) =>
              entry.address.toLowerCase() === selectedCommonFundingToken.toLowerCase()
          ) ?? null,
    [commonTokens, selectedCommonFundingToken]
  );
  const isCustomTokenInput = selectedCommonFundingToken === "custom";
  const performanceChartData = useMemo(
    () =>
      performancePoints.map((point) => ({
        time: new Date(point.snapshot_at).toLocaleTimeString(),
        value: point.total_value_usd,
      })),
    [performancePoints]
  );

  const normalizedTokenAddress =
    isAddress(tokenAddress.trim()) ? (tokenAddress.trim() as `0x${string}`) : undefined;

  const erc20MetadataAbi = [
    {
      type: "function",
      name: "decimals",
      stateMutability: "view",
      inputs: [],
      outputs: [{ name: "", type: "uint8" }],
    },
    {
      type: "function",
      name: "symbol",
      stateMutability: "view",
      inputs: [],
      outputs: [{ name: "", type: "string" }],
    },
  ] as const;

  const { data: tokenDecimalsOnChain } = useReadContract({
    abi: erc20MetadataAbi,
    address: normalizedTokenAddress,
    functionName: "decimals",
    chainId: kiteTestnet.id,
    query: { enabled: Boolean(normalizedTokenAddress) },
  });

  const { data: tokenSymbolOnChain } = useReadContract({
    abi: erc20MetadataAbi,
    address: normalizedTokenAddress,
    functionName: "symbol",
    chainId: kiteTestnet.id,
    query: { enabled: Boolean(normalizedTokenAddress) },
  });

  const resolvedTokenDecimals = useMemo(() => {
    if (selectedCommonToken && typeof selectedCommonToken.decimals === "number") {
      return selectedCommonToken.decimals;
    }
    if (typeof tokenDecimalsOnChain === "number") {
      return tokenDecimalsOnChain;
    }
    return null;
  }, [selectedCommonToken, tokenDecimalsOnChain]);

  const { data: walletBalance } = useBalance({
    address: connectedWallet,
    chainId: kiteTestnet.id,
    query: { enabled: Boolean(connectedWallet) },
  });

  const { data: vaultBalance } = useBalance({
    address: wallet as `0x${string}` | undefined,
    chainId: kiteTestnet.id,
    query: { enabled: Boolean(wallet) },
  });

  const { sendTransactionAsync, isPending: fundingPending } = useSendTransaction();
  const { writeContractAsync, isPending: tokenFundingPending } = useWriteContract();

  const {
    isLoading: fundingConfirming,
    isSuccess: fundingConfirmed,
    error: fundingReceiptError,
  } = useWaitForTransactionReceipt({
    hash: fundingTxHash ?? undefined,
    chainId: kiteTestnet.id,
    query: { enabled: Boolean(fundingTxHash) },
  });

  const {
    isLoading: tokenFundingConfirming,
    isSuccess: tokenFundingConfirmed,
    error: tokenFundingReceiptError,
  } = useWaitForTransactionReceipt({
    hash: tokenFundingTxHash ?? undefined,
    chainId: kiteTestnet.id,
    query: { enabled: Boolean(tokenFundingTxHash) },
  });

  const {
    isLoading: withdrawConfirming,
    isSuccess: withdrawConfirmed,
    error: withdrawReceiptError,
  } = useWaitForTransactionReceipt({
    hash: withdrawTxHash ?? undefined,
    chainId: kiteTestnet.id,
    query: { enabled: Boolean(withdrawTxHash) },
  });

  const {
    isLoading: tokenWithdrawConfirming,
    isSuccess: tokenWithdrawConfirmed,
    error: tokenWithdrawReceiptError,
  } = useWaitForTransactionReceipt({
    hash: tokenWithdrawTxHash ?? undefined,
    chainId: kiteTestnet.id,
    query: { enabled: Boolean(tokenWithdrawTxHash) },
  });

  const loadAgent = useCallback(async () => {
    const response = await fetch(`/api/agents/${id}`, {
      credentials: "include",
      cache: "no-store",
    });
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error ?? "Failed to load agent");
    }
    setAgent((payload.agent ?? null) as AgentRow | null);
  }, [id]);

  const loadLogs = useCallback(async () => {
    const response = await fetch(`/api/agents/${id}/logs`, {
      credentials: "include",
      cache: "no-store",
    });
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error ?? "Failed to load logs");
    }
    setLogs((payload.logs ?? []) as ExecutionLogRow[]);
  }, [id]);

  const loadPortfolioSummary = useCallback(async () => {
    const response = await fetch("/api/portfolio", {
      credentials: "include",
      cache: "no-store",
    });
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error ?? "Failed to load portfolio");
    }
    const matched = ((payload.agents ?? []) as PortfolioSummary[]).find(
      (row) => row.id === id
    );
    setPortfolioAgent(matched ?? null);
  }, [id]);

  const loadPerformance = useCallback(async () => {
    const response = await fetch(`/api/agents/${id}/performance`, {
      credentials: "include",
      cache: "no-store",
    });
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error ?? "Failed to load performance");
    }
    setPerformancePoints((payload.points ?? []) as PerformancePoint[]);
    setPerformanceMetrics((payload.metrics ?? null) as PerformanceMetrics | null);
  }, [id]);

  const load = useCallback(
    async (options?: { showLoading?: boolean }) => {
      const showLoading = options?.showLoading ?? false;
      try {
        if (showLoading) {
          setLoading(true);
        }
        setError(null);
        await Promise.all([loadAgent(), loadLogs(), loadPortfolioSummary(), loadPerformance()]);
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : "Failed to load agent");
      } finally {
        if (showLoading) {
          setLoading(false);
        }
      }
    },
    [loadAgent, loadLogs, loadPerformance, loadPortfolioSummary]
  );

  useEffect(() => {
    void load({ showLoading: true });
  }, [load]);

  useEffect(() => {
    if (fundingConfirmed) {
      void Promise.all([loadPortfolioSummary(), loadPerformance(), loadLogs()]).catch(() => {});
    }
  }, [fundingConfirmed, loadLogs, loadPerformance, loadPortfolioSummary]);

  useEffect(() => {
    if (tokenFundingConfirmed) {
      void Promise.all([loadPortfolioSummary(), loadPerformance(), loadLogs()]).catch(() => {});
    }
  }, [tokenFundingConfirmed, loadLogs, loadPerformance, loadPortfolioSummary]);

  useEffect(() => {
    if (withdrawConfirmed) {
      void Promise.all([loadPortfolioSummary(), loadPerformance(), loadLogs()]).catch(() => {});
    }
  }, [withdrawConfirmed, loadLogs, loadPerformance, loadPortfolioSummary]);

  useEffect(() => {
    if (tokenWithdrawConfirmed) {
      void Promise.all([loadPortfolioSummary(), loadPerformance(), loadLogs()]).catch(() => {});
    }
  }, [tokenWithdrawConfirmed, loadLogs, loadPerformance, loadPortfolioSummary]);

  useEffect(() => {
    if (selectedCommonFundingToken === "custom") {
      return;
    }

    const token = commonTokens.find(
      (entry) =>
        entry.address.toLowerCase() === selectedCommonFundingToken.toLowerCase()
    );
    if (!token) {
      return;
    }

    setTokenAddress(token.address);
  }, [commonTokens, selectedCommonFundingToken]);

  useEffect(() => {
    const dailyBudget = toFiniteNumber(spendingRules.daily_budget_usd);
    const maxPerTx = toFiniteNumber(spendingRules.max_per_tx_usd);
    setDailyBudgetInput(dailyBudget !== null ? String(dailyBudget) : "");
    setMaxPerTxInput(maxPerTx !== null ? String(maxPerTx) : "");
  }, [spendingRules.daily_budget_usd, spendingRules.max_per_tx_usd]);

  useEffect(() => {
    const handleAutoExecuted = () => {
      void Promise.all([loadLogs(), loadPortfolioSummary(), loadPerformance()]).catch(() => {});
    };

    window.addEventListener("kiteswarm:auto-executed", handleAutoExecuted);
    return () => {
      window.removeEventListener("kiteswarm:auto-executed", handleAutoExecuted);
    };
  }, [loadLogs, loadPerformance, loadPortfolioSummary]);

  useEffect(() => {
    const supabase = createSupabaseClient();
    const channel = supabase
      .channel(`agent-${id}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "execution_logs",
          filter: `agent_id=eq.${id}`,
        },
        () => {
          void loadLogs();
        }
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "portfolio_snapshots",
          filter: `agent_id=eq.${id}`,
        },
        () => {
          void Promise.all([loadPortfolioSummary(), loadPerformance()]).catch(() => {});
        }
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [id, loadLogs, loadPerformance, loadPortfolioSummary]);

  async function updateStatus(nextStatus: AgentStatus) {
    if (!agent) {
      return;
    }

    try {
      setSaving(true);
      setError(null);
      const response = await fetch(`/api/agents/${agent.id}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
        },
        credentials: "include",
        body: JSON.stringify({ status: nextStatus }),
      });
      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload.error ?? "Failed to update status");
      }

      setAgent((current) => (current ? { ...current, status: nextStatus } : current));
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : "Failed to update status");
    } finally {
      setSaving(false);
    }
  }

  async function saveSpendingRules() {
    if (!agent) {
      return;
    }

    const nextDailyBudget =
      dailyBudgetInput.trim().length > 0 ? Number.parseFloat(dailyBudgetInput) : null;
    const nextMaxPerTx =
      maxPerTxInput.trim().length > 0 ? Number.parseFloat(maxPerTxInput) : null;

    if (nextDailyBudget !== null && (!Number.isFinite(nextDailyBudget) || nextDailyBudget <= 0)) {
      setError("Daily budget must be a positive number.");
      return;
    }

    if (nextMaxPerTx !== null && (!Number.isFinite(nextMaxPerTx) || nextMaxPerTx <= 0)) {
      setError("Max per transaction must be a positive number.");
      return;
    }

    if (
      nextDailyBudget !== null &&
      nextMaxPerTx !== null &&
      nextMaxPerTx > nextDailyBudget
    ) {
      setError("Max per transaction cannot be greater than daily budget.");
      return;
    }

    try {
      setSavingSpendingRules(true);
      setError(null);

      const nextRules = {
        ...spendingRules,
        daily_budget_usd: nextDailyBudget,
        max_per_tx_usd: nextMaxPerTx,
        source: "user_edit",
      };

      const response = await fetch(`/api/agents/${agent.id}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
        },
        credentials: "include",
        body: JSON.stringify({ spending_rules: nextRules }),
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error ?? "Failed to update spending rules");
      }

      setAgent((current) => (current ? { ...current, spending_rules: nextRules } : current));
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Failed to update spending rules");
    } finally {
      setSavingSpendingRules(false);
    }
  }

  function resolveTokenDecimalsForTransfer() {
    if (selectedCommonToken) {
      if (typeof selectedCommonToken.decimals === "number") {
        return selectedCommonToken.decimals;
      }
      return null;
    }

    if (typeof tokenDecimalsOnChain === "number") {
      return tokenDecimalsOnChain;
    }

    return null;
  }

  async function fundAgentVault() {
    if (!wallet) {
      setError("This agent does not have a vault/AA address yet.");
      return;
    }

    try {
      setError(null);
      const parsedAmount = parseFloat(fundAmount);
      if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
        setError("Enter a valid amount of KITE to fund.");
        return;
      }

      const txHash = await sendTransactionAsync({
        to: wallet as `0x${string}`,
        value: parseEther(fundAmount),
        chainId: kiteTestnet.id,
      });

      setFundingTxHash(txHash);
    } catch (fundError) {
      setError(fundError instanceof Error ? fundError.message : "Funding transaction failed");
    }
  }

  async function fundTokenToVault() {
    if (!wallet) {
      setError("This agent does not have a vault/AA address yet.");
      return;
    }

    if (!normalizedTokenAddress) {
      setError("Enter a valid token contract address.");
      return;
    }

    try {
      setError(null);

      if (isCustomTokenInput && typeof tokenDecimalsOnChain !== "number") {
        setError(
          "Token decimals were not auto-detected yet. Use a common token or wait for metadata detection before sending."
        );
        return;
      }

      const decimals = resolveTokenDecimalsForTransfer();
      if (decimals === null || !Number.isFinite(decimals) || decimals < 0 || decimals > 30) {
        setError("Token decimals could not be resolved from chain metadata yet.");
        return;
      }

      const parsedAmount = Number.parseFloat(tokenAmount);
      if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
        setError("Enter a valid token amount.");
        return;
      }

      const txHash = await writeContractAsync({
        abi: erc20TransferAbi,
        address: normalizedTokenAddress,
        functionName: "transfer",
        args: [wallet as `0x${string}`, parseUnits(tokenAmount, decimals)],
        chainId: kiteTestnet.id,
      });

      setTokenFundingTxHash(txHash);
    } catch (fundError) {
      setError(
        fundError instanceof Error
          ? fundError.message
          : "Token funding transaction failed"
      );
    }
  }

  async function withdrawFromVault(kind: "native" | "erc20") {
    if (!agent || !connectedWallet) {
      setError("Connect wallet first.");
      return;
    }

    if (kind === "erc20" && !normalizedTokenAddress) {
      setError("Enter a valid token contract address.");
      return;
    }

    try {
      setError(null);

      if (kind === "native") {
        const parsedAmount = Number.parseFloat(withdrawAmount);
        if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
          setError("Enter a valid KITE withdrawal amount.");
          return;
        }

        const response = await fetch(`/api/agents/${agent.id}/withdraw`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          credentials: "include",
          body: JSON.stringify({
            kind: "native",
            amount: withdrawAmount,
            recipient: connectedWallet,
          }),
        });
        const payload = await response.json();
        if (!response.ok) {
          throw new Error(payload.error ?? "Failed to withdraw from vault");
        }

        setWithdrawTxHash((payload.txHash ?? null) as `0x${string}` | null);
        await load();
        return;
      }

      if (isCustomTokenInput && typeof tokenDecimalsOnChain !== "number") {
        setError(
          "Token decimals were not auto-detected yet. Use a common token or wait for metadata detection before withdrawing."
        );
        return;
      }

      const decimals = resolveTokenDecimalsForTransfer();
      if (decimals === null || !Number.isFinite(decimals) || decimals < 0 || decimals > 30) {
        setError("Token decimals could not be resolved from chain metadata yet.");
        return;
      }

      const parsedAmount = Number.parseFloat(tokenAmount);
      if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
        setError("Enter a valid token amount to withdraw.");
        return;
      }

      const response = await fetch(`/api/agents/${agent.id}/withdraw`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        credentials: "include",
        body: JSON.stringify({
          kind: "erc20",
          recipient: connectedWallet,
          tokenAddress: normalizedTokenAddress,
          amount: tokenAmount,
          decimals,
        }),
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error ?? "Failed to withdraw token from vault");
      }

      setTokenWithdrawTxHash((payload.txHash ?? null) as `0x${string}` | null);
      await load();
    } catch (withdrawError) {
      setError(
        withdrawError instanceof Error
          ? withdrawError.message
          : "Failed to withdraw from vault"
      );
    }
  }

  async function resetAgent() {
    if (!agent) {
      return;
    }

    const confirmed = window.confirm(
      "Reset this agent? This clears execution logs and performance snapshots and sets status to inactive."
    );
    if (!confirmed) {
      return;
    }

    try {
      setResetting(true);
      setError(null);
      const response = await fetch(`/api/agents/${agent.id}/reset`, {
        method: "POST",
        credentials: "include",
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error ?? "Failed to reset agent");
      }

      await load();
    } catch (resetError) {
      setError(resetError instanceof Error ? resetError.message : "Failed to reset agent");
    } finally {
      setResetting(false);
    }
  }

  async function deleteAgent() {
    if (!agent) {
      return;
    }

    const confirmed = window.confirm(
      "Delete this agent permanently? This cannot be undone."
    );
    if (!confirmed) {
      return;
    }

    try {
      setDeleting(true);
      setError(null);
      const response = await fetch(`/api/agents/${agent.id}`, {
        method: "DELETE",
        credentials: "include",
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error ?? "Failed to delete agent");
      }

      router.push("/dashboard");
      router.refresh();
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "Failed to delete agent");
    } finally {
      setDeleting(false);
    }
  }

  function normalizeTrackedTokens(nextTokens: TrackedTokenRow[]): TrackedTokenRow[] {
    const unique = new Map<string, TrackedTokenRow>();
    for (const token of nextTokens) {
      unique.set(token.address.toLowerCase(), {
        symbol: token.symbol.toUpperCase(),
        address: token.address,
        decimals: token.decimals,
      });
    }
    return Array.from(unique.values());
  }

  async function saveTrackedTokens(nextTokens: TrackedTokenRow[]) {
    if (!agent) {
      return;
    }

    try {
      setSavingTrackedTokens(true);
      setError(null);

      const nextConfig = {
        ...toObject(agent.config),
        tracked_tokens: normalizeTrackedTokens(nextTokens).map((token) => ({
          symbol: token.symbol.toUpperCase(),
          address: token.address,
          decimals: token.decimals,
        })),
      };

      const response = await fetch(`/api/agents/${agent.id}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
        },
        credentials: "include",
        body: JSON.stringify({ config: nextConfig }),
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error ?? "Failed to update tracked tokens");
      }

      await load();
    } catch (trackedError) {
      setError(
        trackedError instanceof Error
          ? trackedError.message
          : "Failed to update tracked tokens"
      );
    } finally {
      setSavingTrackedTokens(false);
    }
  }

  async function addPresetTrackedToken() {
    if (trackingPresetAddress === "none") {
      return;
    }

    const token = commonTokens.find(
      (entry) => entry.address.toLowerCase() === trackingPresetAddress.toLowerCase()
    );
    if (!token) {
      return;
    }

    await saveTrackedTokens([
      ...trackedTokens,
      {
        symbol: token.symbol,
        address: token.address,
        decimals: typeof token.decimals === "number" ? token.decimals : 18,
      },
    ]);
  }

  async function addCustomTrackedToken() {
    const symbol = trackingCustomSymbol.trim().toUpperCase();
    const address = trackingCustomAddress.trim();
    const decimals = Number.parseInt(trackingCustomDecimals, 10);

    if (!symbol) {
      setError("Token symbol is required.");
      return;
    }
    if (!isAddress(address)) {
      setError("Token address must be a valid EVM address.");
      return;
    }
    if (!Number.isFinite(decimals) || decimals < 0 || decimals > 30) {
      setError("Token decimals must be between 0 and 30.");
      return;
    }

    await saveTrackedTokens([
      ...trackedTokens,
      {
        symbol,
        address,
        decimals,
      },
    ]);

    setTrackingCustomSymbol("");
    setTrackingCustomAddress("");
    setTrackingCustomDecimals("18");
  }

  async function removeTrackedToken(address: string) {
    await saveTrackedTokens(
      trackedTokens.filter((token) => token.address.toLowerCase() !== address.toLowerCase())
    );
  }

  if (loading) {
    return <p className="text-gray-500 text-sm">Loading agent...</p>;
  }

  if (!agent) {
    return <p className="text-red-600 text-sm">Agent not found.</p>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-4">
          <div className="h-12 w-12 rounded-xl bg-indigo-50 flex items-center justify-center">
            <Bot className="h-6 w-6 text-indigo-600" />
          </div>
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold text-gray-900">{agent.name}</h1>
              <Badge className={statusColors[agent.status]}>{agent.status}</Badge>
            </div>
            <p className="text-gray-500 text-sm mt-0.5">Strategy: {strategyTitle(strategy)}</p>
            {wallet ? (
              <a
                href={getExplorerAddressUrl(wallet)}
                target="_blank"
                rel="noopener noreferrer"
                className="text-gray-400 hover:text-indigo-600 text-xs mt-1 inline-flex items-center gap-1"
              >
                Vault: {wallet}
                <ExternalLink className="h-3 w-3" />
              </a>
            ) : null}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {agent.status === "active" ? (
            <Button
              variant="outline"
              disabled={saving}
              onClick={() => void updateStatus("paused")}
              className="border-gray-300 text-gray-700 hover:bg-gray-100"
            >
              <Pause className="h-4 w-4 mr-2" />
              Pause
            </Button>
          ) : (
            <Button
              variant="outline"
              disabled={saving}
              onClick={() => void updateStatus("active")}
              className="border-gray-300 text-gray-700 hover:bg-gray-100"
            >
              <Play className="h-4 w-4 mr-2" />
              {agent.status === "inactive" ? "Activate" : "Resume"}
            </Button>
          )}
          <Button
            variant="outline"
            disabled={resetting || deleting}
            onClick={() => {
              void resetAgent();
            }}
            className="border-gray-300 text-gray-700 hover:bg-gray-100"
          >
            <RotateCcw className="h-4 w-4 mr-2" />
            {resetting ? "Resetting..." : "Reset"}
          </Button>
          <Button
            variant="outline"
            disabled={deleting || resetting}
            onClick={() => {
              void deleteAgent();
            }}
            className="border-red-200 text-red-600 hover:bg-red-50"
          >
            <Trash2 className="h-4 w-4 mr-2" />
            {deleting ? "Deleting..." : "Delete"}
          </Button>
        </div>
      </div>

      {error ? <p className="text-red-600 text-sm">{error}</p> : null}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="bg-white border-gray-200">
          <CardContent className="pt-6">
            <p className="text-sm text-gray-500">Vault Value</p>
            <p className="text-xl font-bold text-gray-900 mt-1">
              {formatUsd(portfolioAgent?.total_value_usd ?? 0)}
            </p>
          </CardContent>
        </Card>
        <Card className="bg-white border-gray-200">
          <CardContent className="pt-6">
            <p className="text-sm text-gray-500">Executions Logged</p>
            <p className="text-xl font-bold text-gray-900 mt-1">{logs.length}</p>
          </CardContent>
        </Card>
        <Card className="bg-white border-gray-200">
          <CardContent className="pt-6">
            <p className="text-sm text-gray-500">On-chain Vault Balance</p>
            <p className="text-xl font-bold text-gray-900 mt-1">
              {vaultBalance?.formatted ? `${Number(vaultBalance.formatted).toFixed(4)} KITE` : "-"}
            </p>
          </CardContent>
        </Card>
      </div>

      <Card className="bg-white border-gray-200">
        <CardHeader>
          <CardTitle className="text-gray-900">Profit / Loss Trend</CardTitle>
          <CardDescription>
            Performance based on recorded portfolio snapshots after each execution cycle.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-sm">
            <div className="rounded-md border border-gray-200 bg-gray-50 px-3 py-2">
              <p className="text-gray-500">Start Value</p>
              <p className="text-gray-900 font-medium">
                {formatUsd(performanceMetrics?.first_value_usd ?? 0)}
              </p>
            </div>
            <div className="rounded-md border border-gray-200 bg-gray-50 px-3 py-2">
              <p className="text-gray-500">Current Value</p>
              <p className="text-gray-900 font-medium">
                {formatUsd(performanceMetrics?.latest_value_usd ?? 0)}
              </p>
            </div>
            <div className="rounded-md border border-gray-200 bg-gray-50 px-3 py-2">
              <p className="text-gray-500">P/L</p>
              <p
                className={`font-medium ${
                  (performanceMetrics?.pnl_usd ?? 0) >= 0
                    ? "text-emerald-600"
                    : "text-red-600"
                }`}
              >
                {formatUsd(performanceMetrics?.pnl_usd ?? 0)} (
                {(performanceMetrics?.pnl_pct ?? 0).toFixed(2)}%)
              </p>
            </div>
          </div>

          <div className="h-64">
            {performanceChartData.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={performanceChartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                  <XAxis dataKey="time" stroke="#9ca3af" tickLine={false} axisLine={false} />
                  <YAxis
                    stroke="#9ca3af"
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={(value) => `$${Number(value).toFixed(2)}`}
                  />
                  <Tooltip
                    formatter={(value) => formatUsd(Number(value))}
                    labelFormatter={(label) => `Time: ${label}`}
                  />
                  <Line
                    type="monotone"
                    dataKey="value"
                    stroke="#4f46e5"
                    strokeWidth={2.5}
                    dot={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-full rounded-lg border border-gray-200 bg-gray-50 flex items-center justify-center text-gray-400 text-sm">
                No performance data yet. Activate and run at least one cycle.
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      <Card className="bg-white border-gray-200">
        <CardHeader>
          <CardTitle className="text-gray-900 flex items-center gap-2">
            <ArrowDownToLine className="h-5 w-5 text-indigo-600" />
            Fund / Stake Agent Vault
          </CardTitle>
          <CardDescription>
            Send KITE from your connected wallet into this agent vault address.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="space-y-2">
              <Label className="text-gray-700 text-xs">Your Wallet Balance</Label>
              <div className="rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-700">
                {walletBalance?.formatted
                  ? `${Number(walletBalance.formatted).toFixed(4)} KITE`
                  : "Connect wallet"}
              </div>
            </div>
            <div className="space-y-2">
              <Label className="text-gray-700 text-xs">Agent Vault Address</Label>
              <div className="rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-700 break-all">
                {wallet ?? "No vault available"}
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="fund-amount" className="text-gray-700 text-xs">
                Amount (KITE)
              </Label>
              <Input
                id="fund-amount"
                type="number"
                min={0}
                step="0.01"
                value={fundAmount}
                onChange={(event) => setFundAmount(event.target.value)}
                className="bg-white border-gray-300 text-gray-900"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="withdraw-amount" className="text-gray-700 text-xs">
                Withdraw (KITE)
              </Label>
              <Input
                id="withdraw-amount"
                type="number"
                min={0}
                step="0.01"
                value={withdrawAmount}
                onChange={(event) => setWithdrawAmount(event.target.value)}
                className="bg-white border-gray-300 text-gray-900"
              />
            </div>
          </div>

          <div className="flex items-center gap-3 flex-wrap">
            <Button
              onClick={() => {
                void fundAgentVault();
              }}
              disabled={!wallet || !connectedWallet || fundingPending || fundingConfirming}
              className="bg-indigo-600 hover:bg-indigo-500 text-white"
            >
              <Wallet className="h-4 w-4 mr-2" />
              {fundingPending || fundingConfirming ? "Funding..." : "Send KITE to Vault"}
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                void withdrawFromVault("native");
              }}
              disabled={!wallet || !connectedWallet || withdrawConfirming}
              className="border-gray-300 text-gray-700 hover:bg-gray-50"
            >
              <ArrowDownToLine className="h-4 w-4 mr-2" />
              {withdrawConfirming ? "Withdrawing..." : "Withdraw KITE to Wallet"}
            </Button>
            {fundingTxHash ? (
              <a
                href={getExplorerTxUrl(fundingTxHash)}
                target="_blank"
                rel="noopener noreferrer"
                className="text-indigo-600 hover:text-indigo-600 text-sm inline-flex items-center gap-1"
              >
                View funding tx
                <ExternalLink className="h-3 w-3" />
                </a>
              ) : null}
            {withdrawTxHash ? (
              <a
                href={getExplorerTxUrl(withdrawTxHash)}
                target="_blank"
                rel="noopener noreferrer"
                className="text-indigo-600 hover:text-indigo-600 text-sm inline-flex items-center gap-1"
              >
                View withdrawal tx
                <ExternalLink className="h-3 w-3" />
              </a>
            ) : null}
          </div>

          {fundingReceiptError ? (
            <p className="text-red-600 text-sm">{fundingReceiptError.message}</p>
          ) : null}
          {withdrawReceiptError ? (
            <p className="text-red-600 text-sm">{withdrawReceiptError.message}</p>
          ) : null}

          <div className="border-t border-gray-200 pt-4 space-y-3">
            <p className="text-sm font-medium text-gray-800">Fund with ERC-20 Token</p>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div className="space-y-2">
                <Label className="text-gray-700 text-xs">Common Tokens</Label>
                <Select
                  value={selectedCommonFundingToken}
                  onValueChange={(value) => setSelectedCommonFundingToken(value ?? "custom")}
                >
                  <SelectTrigger className="bg-white border-gray-300 text-gray-900 w-full">
                    <span className="truncate text-left">
                      {selectedCommonFundingToken === "custom"
                        ? "Custom token"
                        : commonTokens.find(
                            (token) =>
                              token.address.toLowerCase() ===
                              selectedCommonFundingToken.toLowerCase()
                          )?.label ?? "Custom token"}
                    </span>
                  </SelectTrigger>
                  <SelectContent className="bg-white border-gray-200">
                    <SelectItem value="custom">Custom token</SelectItem>
                    {commonTokens.map((token) => (
                      <SelectItem key={token.address} value={token.address}>
                        {token.label ?? token.symbol}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="token-address" className="text-gray-700 text-xs">
                  Token Address
                </Label>
                <Input
                  id="token-address"
                  placeholder="0x..."
                  value={tokenAddress}
                  onChange={(event) => setTokenAddress(event.target.value)}
                  readOnly={!isCustomTokenInput}
                  className="bg-white border-gray-300 text-gray-900"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="token-amount" className="text-gray-700 text-xs">
                  Token Amount
                </Label>
                <Input
                  id="token-amount"
                  type="number"
                  min={0}
                  step="0.0001"
                  value={tokenAmount}
                  onChange={(event) => setTokenAmount(event.target.value)}
                  className="bg-white border-gray-300 text-gray-900"
                />
              </div>
              <div className="space-y-2">
                <Label className="text-gray-700 text-xs">
                  Token Decimals (Auto)
                </Label>
                <div className="rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-700">
                  {resolvedTokenDecimals ?? "-"}
                </div>
              </div>
            </div>
            <p className="text-xs text-gray-500">
              Detected token: {typeof tokenSymbolOnChain === "string" ? tokenSymbolOnChain : "-"}{" "}
              | On-chain decimals:{" "}
              {typeof tokenDecimalsOnChain === "number" ? tokenDecimalsOnChain : "-"}
            </p>
            {!isCustomTokenInput ? (
              <p className="text-xs text-gray-500">
                Common token selected: address/decimals are locked to prevent unit mistakes.
              </p>
            ) : null}
            <div className="flex items-center gap-3 flex-wrap">
              <Button
                onClick={() => {
                  void fundTokenToVault();
                }}
                disabled={
                  !wallet ||
                  !connectedWallet ||
                  tokenFundingPending ||
                  tokenFundingConfirming
                }
                className="bg-indigo-600 hover:bg-indigo-500 text-white"
              >
                <Wallet className="h-4 w-4 mr-2" />
                {tokenFundingPending || tokenFundingConfirming
                  ? "Funding Token..."
                  : "Send Token to Vault"}
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  void withdrawFromVault("erc20");
                }}
                disabled={
                  !wallet ||
                  !connectedWallet ||
                  tokenWithdrawConfirming
                }
                className="border-gray-300 text-gray-700 hover:bg-gray-50"
              >
                <ArrowDownToLine className="h-4 w-4 mr-2" />
                {tokenWithdrawConfirming ? "Withdrawing Token..." : "Withdraw Token to Wallet"}
              </Button>
              {tokenFundingTxHash ? (
                <a
                  href={getExplorerTxUrl(tokenFundingTxHash)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-indigo-600 hover:text-indigo-600 text-sm inline-flex items-center gap-1"
                >
                  View token funding tx
                  <ExternalLink className="h-3 w-3" />
                </a>
              ) : null}
              {tokenWithdrawTxHash ? (
                <a
                  href={getExplorerTxUrl(tokenWithdrawTxHash)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-indigo-600 hover:text-indigo-600 text-sm inline-flex items-center gap-1"
                >
                  View token withdrawal tx
                  <ExternalLink className="h-3 w-3" />
                </a>
              ) : null}
            </div>
            {tokenFundingReceiptError ? (
              <p className="text-red-600 text-sm">{tokenFundingReceiptError.message}</p>
            ) : null}
            {tokenWithdrawReceiptError ? (
              <p className="text-red-600 text-sm">{tokenWithdrawReceiptError.message}</p>
            ) : null}
          </div>
        </CardContent>
      </Card>

      <Card className="bg-white border-gray-200">
        <CardHeader>
          <CardTitle className="text-gray-900 flex items-center gap-2">
            <Shield className="h-5 w-5 text-indigo-600" />
            Strategy Plan
          </CardTitle>
          <CardDescription>
            Tokens, pools, and constraints currently configured for this agent.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
              <p className="text-xs uppercase tracking-wide text-gray-400">Strategy</p>
              <p className="text-sm text-gray-700 mt-1">{strategyTitle(strategy)}</p>
              <p className="text-xs text-gray-500 mt-2">{strategy?.description ?? "No strategy description."}</p>
            </div>
            <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
              <p className="text-xs uppercase tracking-wide text-gray-400">Protocols / Pools</p>
              <div className="flex items-center gap-2 flex-wrap mt-2">
                {protocols.length > 0 ? (
                  protocols.map((protocol) => (
                    <Badge key={protocol} variant="outline" className="border-indigo-200 text-indigo-600">
                      {protocol}
                    </Badge>
                  ))
                ) : (
                  <span className="text-xs text-gray-400">No pool/protocol metadata configured.</span>
                )}
              </div>
            </div>
          </div>

          <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
            <p className="text-xs uppercase tracking-wide text-gray-400">Tracked Tokens</p>
            <div className="mt-3 grid grid-cols-1 md:grid-cols-[1fr_auto] gap-2">
              <Select
                value={trackingPresetAddress}
                onValueChange={(value) => setTrackingPresetAddress(value ?? "none")}
              >
                <SelectTrigger className="bg-white border-gray-300 text-gray-900 w-full">
                  <span className="truncate text-left">
                    {trackingPresetAddress === "none"
                      ? "Quick add common token"
                      : commonTokens.find(
                          (token) =>
                            token.address.toLowerCase() ===
                            trackingPresetAddress.toLowerCase()
                        )?.label ?? "Quick add common token"}
                  </span>
                </SelectTrigger>
                <SelectContent className="bg-white border-gray-200">
                  <SelectItem value="none">Quick add common token</SelectItem>
                  {commonTokens.map((token) => (
                    <SelectItem key={token.address} value={token.address}>
                      {token.label ?? token.symbol}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                variant="outline"
                className="border-gray-300 text-gray-700 hover:bg-gray-50"
                disabled={savingTrackedTokens}
                onClick={() => {
                  void addPresetTrackedToken();
                }}
              >
                Add
              </Button>
            </div>

            <div className="mt-3 grid grid-cols-1 md:grid-cols-4 gap-2">
              <Input
                placeholder="Symbol"
                value={trackingCustomSymbol}
                onChange={(event) => setTrackingCustomSymbol(event.target.value)}
                className="bg-white border-gray-300 text-gray-900"
              />
              <Input
                placeholder="0xTokenAddress"
                value={trackingCustomAddress}
                onChange={(event) => setTrackingCustomAddress(event.target.value)}
                className="bg-white border-gray-300 text-gray-900"
              />
              <Input
                type="number"
                min={0}
                max={30}
                placeholder="Decimals"
                value={trackingCustomDecimals}
                onChange={(event) => setTrackingCustomDecimals(event.target.value)}
                className="bg-white border-gray-300 text-gray-900"
              />
              <Button
                variant="outline"
                className="border-gray-300 text-gray-700 hover:bg-gray-50"
                disabled={savingTrackedTokens}
                onClick={() => {
                  void addCustomTrackedToken();
                }}
              >
                Add Custom
              </Button>
            </div>

            {trackedTokens.length === 0 ? (
              <p className="text-sm text-gray-500 mt-2">
                No custom tracked tokens configured. Add tokens while creating the agent.
              </p>
            ) : (
              <div className="mt-2 space-y-1">
                {trackedTokens.map((token) => (
                  <div
                    key={token.address}
                    className="text-sm text-gray-700 flex items-center justify-between gap-2"
                  >
                    <div className="flex flex-col">
                      <span>{token.symbol}</span>
                      <span className="text-xs text-gray-500">{token.address}</span>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      className="border-red-200 text-red-600 hover:bg-red-50"
                      disabled={savingTrackedTokens}
                      onClick={() => {
                        void removeTrackedToken(token.address);
                      }}
                    >
                      Remove
                    </Button>
                  </div>
                ))}
              </div>
            )}
            {savingTrackedTokens ? (
              <p className="text-xs text-gray-500 mt-2">Saving tracked tokens...</p>
            ) : null}
          </div>

          <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
            <p className="text-xs uppercase tracking-wide text-gray-400">Target Allocations</p>
            {allocations.length === 0 ? (
              <p className="text-sm text-gray-500 mt-2">No allocation targets configured.</p>
            ) : (
              <div className="mt-2 space-y-2">
                {allocations.map((allocation) => (
                  <div
                    key={`${allocation.asset}-${allocation.chain}`}
                    className="flex items-center justify-between text-sm"
                  >
                    <span className="text-gray-700">{allocation.asset} on {allocation.chain}</span>
                    <span className="text-gray-500">{allocation.targetPct}%</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
            <p className="text-xs uppercase tracking-wide text-gray-400">Spending Rules</p>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-2">
              <div className="space-y-1">
                <Label htmlFor="daily-budget-input" className="text-xs text-gray-600">
                  Daily Budget (USD)
                </Label>
                <Input
                  id="daily-budget-input"
                  type="number"
                  min={0}
                  step="0.01"
                  value={dailyBudgetInput}
                  onChange={(event) => setDailyBudgetInput(event.target.value)}
                  className="bg-white border-gray-300 text-gray-900"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="max-per-tx-input" className="text-xs text-gray-600">
                  Max Per Transaction (USD)
                </Label>
                <Input
                  id="max-per-tx-input"
                  type="number"
                  min={0}
                  step="0.01"
                  value={maxPerTxInput}
                  onChange={(event) => setMaxPerTxInput(event.target.value)}
                  className="bg-white border-gray-300 text-gray-900"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-gray-600">Source</Label>
                <div className="rounded-md border border-gray-200 bg-white px-3 py-2 text-sm text-gray-600">
                  {String(spendingRules.source ?? "-")}
                </div>
              </div>
            </div>
            <div className="mt-3">
              <Button
                variant="outline"
                className="border-gray-300 text-gray-700 hover:bg-gray-50"
                disabled={savingSpendingRules}
                onClick={() => {
                  void saveSpendingRules();
                }}
              >
                {savingSpendingRules ? "Saving..." : "Save Spending Rules"}
              </Button>
            </div>
          </div>

        </CardContent>
      </Card>

      <Card className="bg-white border-gray-200">
        <CardHeader>
          <CardTitle className="text-gray-900">Holdings Snapshot</CardTitle>
          <CardDescription>Latest tracked vault holdings for this agent.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {suspiciousStablecoinHoldings.length > 0 ? (
            <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
              Detected unusually large stablecoin balance(s). This usually means the token was funded
              with incorrect decimals (for example 18 instead of 6). Withdraw and re-fund using detected
              on-chain decimals.
            </div>
          ) : null}
          {holdings.length === 0 ? (
            <p className="text-sm text-gray-500">No holdings snapshot yet.</p>
          ) : (
            holdings.map((holding) => (
              <div key={holding.asset} className="flex items-center justify-between text-sm">
                <span className="text-gray-700">{holding.asset}</span>
                <span className="text-gray-500">
                  {formatUsd(holding.value_usd)}
                  {holding.amount ? ` (${holding.amount})` : ""}
                </span>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      <Card className="bg-white border-gray-200">
        <CardHeader>
          <CardTitle className="text-gray-900">Execution Log</CardTitle>
          <CardDescription>Real transaction traces and attestation hashes.</CardDescription>
        </CardHeader>
        <CardContent>
          <Table className="table-fixed">
            <TableHeader>
              <TableRow className="border-gray-200 hover:bg-transparent">
                <TableHead className="text-gray-500">Time</TableHead>
                <TableHead className="text-gray-500">Action</TableHead>
                <TableHead className="text-gray-500">Decision</TableHead>
                <TableHead className="text-gray-500">Status</TableHead>
                <TableHead className="text-gray-500">Tx</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {logs.map((entry) => {
                const txToShow = entry.tx_hash ?? entry.attestation_tx_hash;
                return (
                  <TableRow key={entry.id} className="border-gray-200">
                    <TableCell className="text-gray-700 text-sm align-top whitespace-nowrap">
                      {new Date(entry.created_at).toLocaleString()}
                    </TableCell>
                    <TableCell className="text-gray-700 text-sm align-top max-w-[220px] whitespace-normal break-words">
                      {entry.action_type}
                      {entry.description ? ` - ${entry.description}` : ""}
                    </TableCell>
                    <TableCell className="text-gray-700 text-sm align-top max-w-[380px] whitespace-normal break-words">
                      {decisionSummary(entry)}
                    </TableCell>
                    <TableCell className="align-top">
                      <Badge className="bg-gray-100 text-gray-700 border-0">
                        {entry.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="align-top w-[170px]">
                      {txToShow ? (
                        <a
                          href={getExplorerTxUrl(txToShow)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-indigo-600 hover:text-indigo-600 text-sm inline-flex items-center gap-1 whitespace-nowrap"
                        >
                          {truncateHash(txToShow)}
                          <ExternalLink className="h-3 w-3" />
                        </a>
                      ) : (
                        <span className="text-gray-400 text-sm">-</span>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
