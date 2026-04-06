import { ethers } from "ethers";
import OpenAI from "openai";
import { DECISION_LOG_ABI } from "./contracts/decision-log-abi";
import { getServerDefaultKiteTokens } from "./kite-tokens";
import { createKiteAASdk } from "./kite-aa";
import { decryptAgentSignerPrivateKey } from "./agent-signer";
import type { Agent, Strategy } from "@/types/database";

const provider = new ethers.JsonRpcProvider(
  process.env.KITE_RPC_URL ??
    process.env.NEXT_PUBLIC_KITE_RPC_URL ??
    "https://rpc-testnet.gokite.ai"
);

const openai = process.env.OPENAI_API_KEY
  ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  : null;

const ERC20_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
  "function approve(address spender, uint256 amount) returns (bool)",
];

const UNISWAP_V2_ROUTER_ABI = [
  "function swapExactTokensForTokens(uint256 amountIn, uint256 amountOutMin, address[] path, address to, uint256 deadline) returns (uint256[] amounts)",
];

const BRIDGE_CONTROLLER_ABI = [
  "function transferTo(address recipient, uint256 amount, bool unwrap, uint256 destChainId, address bridgeAdapter, bytes bridgeOptions) payable",
];

const ERC4626_ABI = [
  "function deposit(uint256 assets, address receiver) returns (uint256 shares)",
  "function withdraw(uint256 assets, address receiver, address owner) returns (uint256 shares)",
  "function redeem(uint256 shares, address receiver, address owner) returns (uint256 assets)",
  "function previewDeposit(uint256 assets) view returns (uint256 shares)",
  "function previewRedeem(uint256 shares) view returns (uint256 assets)",
];

type AIProvider = "openai" | "gemini";

interface PortfolioHolding {
  asset: string;
  chain: string;
  amount: string;
  valueUsd: number;
}

interface PortfolioState {
  totalValueUsd: number;
  holdings: PortfolioHolding[];
}

interface MarketData {
  prices: Record<string, number>;
  timestamp: number;
}

interface AgentAction {
  type:
    | "swap"
    | "bridge"
    | "yield_deposit"
    | "yield_withdraw"
    | "transfer"
    | "rebalance";
  description: string;
  params: Record<string, unknown>;
}

type ActionExecutionResult = {
  action: AgentAction;
  executionTxHash: string | null;
  attestationTxHash: string | null;
  status: "success" | "failed";
  error: string | null;
};

type ResolvedToken = {
  address: string;
  symbol: string;
  decimals: number;
  bridgeController?: string;
  defaultBridgeAdapter?: string;
  yieldVault?: string;
};

type TokenCatalog = {
  bySymbol: Map<string, ResolvedToken>;
  byAddress: Map<string, ResolvedToken>;
};

type PositionSizingSettings = {
  perCycleRiskPct: number;
  reservePct: number;
  minTradeUsd: number;
  maxTradeUsd: number;
  maxPerTxUsd: number | null;
  dailyBudgetUsd: number | null;
};

const ALLOWED_ACTION_TYPES = new Set<AgentAction["type"]>([
  "swap",
  "bridge",
  "yield_deposit",
  "yield_withdraw",
  "transfer",
  "rebalance",
]);

function resolveAIProvider(): AIProvider | null {
  const explicit = process.env.AI_PROVIDER?.trim().toLowerCase();
  if (explicit === "openai" || explicit === "gemini") {
    return explicit;
  }

  if (process.env.GEMINI_API_KEY) {
    return "gemini";
  }
  if (process.env.OPENAI_API_KEY) {
    return "openai";
  }

  return null;
}

function parseDecisionJson(content: string) {
  try {
    return JSON.parse(content);
  } catch {
    // Continue to fallback parsing attempts
  }

  const fenced = content.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) {
    try {
      return JSON.parse(fenced[1].trim());
    } catch {
      // Continue to fallback parsing attempts
    }
  }

  const firstBrace = content.indexOf("{");
  const lastBrace = content.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    try {
      return JSON.parse(content.slice(firstBrace, lastBrace + 1));
    } catch {
      // Continue to final error
    }
  }

  throw new Error(`AI response was not valid JSON: ${content.slice(0, 200)}`);
}

function normalizeActions(raw: unknown): AgentAction[] {
  if (!Array.isArray(raw)) {
    return [];
  }

  return raw
    .map((item) => {
      if (!item || typeof item !== "object") {
        return null;
      }

      const row = item as {
        type?: unknown;
        description?: unknown;
        params?: unknown;
      };

      if (
        typeof row.type !== "string" ||
        !ALLOWED_ACTION_TYPES.has(row.type as AgentAction["type"])
      ) {
        return null;
      }

      return {
        type: row.type as AgentAction["type"],
        description:
          typeof row.description === "string" && row.description.trim().length > 0
            ? row.description
            : "No description",
        params:
          row.params && typeof row.params === "object" && !Array.isArray(row.params)
            ? (row.params as Record<string, unknown>)
            : {},
      } satisfies AgentAction;
    })
    .filter((item): item is AgentAction => item !== null);
}

function extractGeminiText(response: unknown): string {
  if (!response || typeof response !== "object") {
    return "";
  }

  const root = response as {
    candidates?: Array<{
      content?: {
        parts?: Array<{ text?: unknown }>;
      };
    }>;
  };

  for (const candidate of root.candidates ?? []) {
    for (const part of candidate.content?.parts ?? []) {
      if (typeof part.text === "string" && part.text.trim().length > 0) {
        return part.text;
      }
    }
  }

  return "";
}

function parseObject(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
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

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function normalizeAssetSymbol(asset: string): string {
  return asset.trim().toUpperCase();
}

function toAddressString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  if (!ethers.isAddress(trimmed)) {
    return null;
  }
  return ethers.getAddress(trimmed);
}

function toBytes(value: unknown): string {
  if (typeof value !== "string") {
    return "0x";
  }
  const trimmed = value.trim();
  if (!trimmed.startsWith("0x")) {
    return "0x";
  }
  return trimmed;
}

function toBoolean(value: unknown, fallback = false): boolean {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["1", "true", "yes", "y", "on"].includes(normalized)) {
      return true;
    }
    if (["0", "false", "no", "n", "off"].includes(normalized)) {
      return false;
    }
  }
  return fallback;
}

function toBigIntValue(value: unknown): bigint | null {
  if (typeof value === "bigint") {
    return value;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return BigInt(Math.floor(value));
  }
  if (typeof value === "string" && value.trim().length > 0) {
    try {
      return BigInt(value.trim());
    } catch {
      return null;
    }
  }
  return null;
}

function resolveTxHashFromStatus(status: unknown): string | null {
  if (!status || typeof status !== "object") {
    return null;
  }
  const row = status as {
    transactionHash?: unknown;
    receipt?: {
      receipt?: {
        transactionHash?: unknown;
      };
    };
  };
  if (typeof row.transactionHash === "string" && row.transactionHash.length > 0) {
    return row.transactionHash;
  }
  if (
    typeof row.receipt?.receipt?.transactionHash === "string" &&
    row.receipt.receipt.transactionHash.length > 0
  ) {
    return row.receipt.receipt.transactionHash;
  }
  return null;
}

function asHeartbeatAction(reason: string): AgentAction {
  return {
    type: "transfer",
    description: reason,
    params: {
      note: "no_trade_cycle",
      reason,
    },
  };
}

function resolvePositionSizing(agent: Agent, strategy: Strategy): PositionSizingSettings {
  const config = parseObject(agent.config);
  const positionSizing = parseObject(config.position_sizing);
  const spendingRules = parseObject(agent.spending_rules);
  const strategyRules = parseObject(strategy.rules);

  const perCycleRiskPct = clamp(
    toFiniteNumber(positionSizing.per_cycle_risk_pct ?? strategyRules.per_cycle_risk_pct) ?? 5,
    0.1,
    100
  );
  const reservePct = clamp(
    toFiniteNumber(positionSizing.reserve_pct ?? strategyRules.reserve_pct) ?? 10,
    0,
    95
  );
  const minTradeUsd = Math.max(
    toFiniteNumber(positionSizing.min_trade_usd ?? strategyRules.min_trade_usd) ?? 1,
    0.01
  );
  const maxTradeUsd = Math.max(
    toFiniteNumber(positionSizing.max_trade_usd ?? strategyRules.max_trade_usd) ?? 30,
    minTradeUsd
  );

  const maxPerTxUsd = toFiniteNumber(spendingRules.max_per_tx_usd);
  const dailyBudgetUsd = toFiniteNumber(spendingRules.daily_budget_usd);

  return {
    perCycleRiskPct,
    reservePct,
    minTradeUsd,
    maxTradeUsd,
    maxPerTxUsd,
    dailyBudgetUsd,
  };
}

function pickSpendAsset(
  portfolio: PortfolioState,
  buyAsset: string | null,
  preferredAsset: string | null
): string | null {
  const buy = buyAsset ? normalizeAssetSymbol(buyAsset) : null;
  const preferred = preferredAsset ? normalizeAssetSymbol(preferredAsset) : null;

  const byAsset = new Map<string, number>();
  for (const holding of portfolio.holdings) {
    const symbol = normalizeAssetSymbol(holding.asset);
    const current = byAsset.get(symbol) ?? 0;
    byAsset.set(symbol, current + Math.max(holding.valueUsd, 0));
  }

  const available = Array.from(byAsset.entries())
    .filter(([, valueUsd]) => valueUsd > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([symbol]) => symbol);

  if (preferred && available.includes(preferred) && preferred !== buy) {
    return preferred;
  }

  for (const stable of ["USDC", "USDT", "DAI", "PYUSD"]) {
    if (available.includes(stable) && stable !== buy) {
      return stable;
    }
  }

  for (const symbol of available) {
    if (symbol !== buy) {
      return symbol;
    }
  }

  return null;
}

function applyMicroPositionSizing(
  actions: AgentAction[],
  portfolio: PortfolioState,
  strategy: Strategy,
  agent: Agent
): AgentAction[] {
  if (actions.length === 0) {
    return [];
  }

  const sizing = resolvePositionSizing(agent, strategy);
  const strategyRules = parseObject(strategy.rules);

  const tradableUsd =
    portfolio.totalValueUsd * (1 - sizing.reservePct / 100);
  if (!Number.isFinite(tradableUsd) || tradableUsd <= 0) {
    return [asHeartbeatAction("No tradable funds available in vault after reserve rules.")];
  }

  const cycleRiskBudgetUsd =
    tradableUsd * (sizing.perCycleRiskPct / 100);

  const capCandidates = [cycleRiskBudgetUsd, sizing.maxTradeUsd].filter(
    (value) => Number.isFinite(value) && value > 0
  );
  if (sizing.maxPerTxUsd && sizing.maxPerTxUsd > 0) {
    capCandidates.push(sizing.maxPerTxUsd);
  }
  if (sizing.dailyBudgetUsd && sizing.dailyBudgetUsd > 0) {
    capCandidates.push(sizing.dailyBudgetUsd);
  }

  const totalActionCapUsd = capCandidates.length > 0
    ? Math.min(...capCandidates)
    : cycleRiskBudgetUsd;
  const perActionCapUsd = totalActionCapUsd / Math.max(actions.length, 1);

  if (!Number.isFinite(perActionCapUsd) || perActionCapUsd < sizing.minTradeUsd) {
    return [
      asHeartbeatAction(
        `Cycle skipped by micro-position sizing. Available cap ${perActionCapUsd.toFixed(4)} USD is below minimum trade size ${sizing.minTradeUsd.toFixed(2)} USD.`
      ),
    ];
  }

  const normalized = actions
    .map((action) => {
      if (action.type === "rebalance" || action.type === "yield_withdraw") {
        return action;
      }

      const params = { ...action.params };
      const desiredAmountUsd =
        toFiniteNumber(params.amount_usd ?? params.spend_amount_usd) ??
        toFiniteNumber(strategyRules.spend_amount_usd) ??
        perActionCapUsd;
      const amountUsd = clamp(
        desiredAmountUsd,
        sizing.minTradeUsd,
        perActionCapUsd
      );

      if (!Number.isFinite(amountUsd) || amountUsd < sizing.minTradeUsd) {
        return null;
      }

      params.amount_usd = Number(amountUsd.toFixed(6));
      params.position_size_usd = Number(amountUsd.toFixed(6));

      if (action.type === "swap") {
        const buyAssetRaw =
          typeof params.to_asset === "string"
            ? params.to_asset
            : typeof strategyRules.buy_asset === "string"
              ? strategyRules.buy_asset
              : "BTC";
        const buyAsset = normalizeAssetSymbol(buyAssetRaw);

        const preferredFrom =
          typeof params.from_asset === "string"
            ? params.from_asset
            : typeof strategyRules.spend_asset === "string"
              ? strategyRules.spend_asset
              : null;

        const fromAsset = pickSpendAsset(portfolio, buyAsset, preferredFrom);
        if (!fromAsset) {
          return null;
        }

        if (fromAsset === buyAsset) {
          return null;
        }

        params.from_asset = fromAsset;
        params.to_asset = buyAsset;
        params.spend_amount_usd = Number(amountUsd.toFixed(6));

        return {
          ...action,
          description: `Swap ${amountUsd.toFixed(2)} USD from ${fromAsset} into ${buyAsset}.`,
          params,
        } satisfies AgentAction;
      }

      if (action.type === "yield_deposit") {
        if (typeof params.asset !== "string" || params.asset.trim().length === 0) {
          const asset = pickSpendAsset(portfolio, null, null);
          if (!asset) {
            return null;
          }
          params.asset = asset;
        } else {
          params.asset = normalizeAssetSymbol(params.asset);
        }

        return {
          ...action,
          description: `${action.description} Position size capped to ${amountUsd.toFixed(2)} USD.`,
          params,
        } satisfies AgentAction;
      }

      return {
        ...action,
        params,
      } satisfies AgentAction;
    })
    .filter((action): action is AgentAction => action !== null);

  if (normalized.length === 0) {
    return [asHeartbeatAction("No executable action after balance and sizing checks.")];
  }

  return normalized;
}

function fallbackActions(
  strategy: Strategy,
  agent: Agent,
  marketData: MarketData,
  portfolio: PortfolioState
) {
  const rules = parseObject(strategy.rules);
  const config = parseObject(agent.config);

  const strategyType = strategy.type;
  if (strategyType === "yield_optimize") {
    const protocols = Array.isArray(rules.target_protocols)
      ? rules.target_protocols.filter((item): item is string => typeof item === "string")
      : ["lucid"];
    const pools = Array.isArray(rules.pools) ? rules.pools : [];

    const actions: AgentAction[] = [];

    if (pools.length > 0) {
      for (const pool of pools) {
        const p = pool && typeof pool === "object" ? (pool as Record<string, unknown>) : {};
        const fallbackAsset = pickSpendAsset(
          portfolio,
          null,
          typeof p.asset === "string" ? p.asset : null
        );
        if (!fallbackAsset) {
          continue;
        }

        actions.push({
          type: "yield_deposit" as const,
          description: `Deposit ${fallbackAsset} into ${String(p.protocol ?? "lucid")} ${String(p.pool ?? "")} pool for yield.`,
          params: {
            protocol: String(p.protocol ?? "lucid"),
            asset: fallbackAsset,
            pool: String(p.pool ?? ""),
            allocation_pct: typeof p.allocation_pct === "number" ? p.allocation_pct : 100,
          },
        });
      }
    } else {
      const fallbackAsset = pickSpendAsset(portfolio, null, "USDC");
      if (fallbackAsset) {
        actions.push({
          type: "yield_deposit" as const,
          description: `Deploy idle ${fallbackAsset} balance into yield strategy.`,
          params: {
            protocol: protocols[0] ?? "lucid",
            asset: fallbackAsset,
            target_asset: "L-USDC",
          },
        });
      }
    }

    return actions.length > 0
      ? actions
      : [asHeartbeatAction("No suitable asset available for yield deposit cycle.")];
  }

  if (strategyType === "rebalance") {
    const configAllocations = parseObject(config).allocations;
    const ruleAllocations = rules.allocations;
    const allocations = Array.isArray(configAllocations)
      ? configAllocations
      : Array.isArray(ruleAllocations)
        ? ruleAllocations
        : [];

    return [
      {
        type: "rebalance" as const,
        description: "Rebalance holdings toward target allocations.",
        params: {
          allocations,
          threshold_pct:
            typeof rules.rebalance_threshold_pct === "number"
              ? rules.rebalance_threshold_pct
              : 5,
        },
      },
    ];
  }

  if (strategyType === "dca") {
    const buyAssetRaw = typeof rules.buy_asset === "string" ? rules.buy_asset : "BTC";
    const buyAsset = normalizeAssetSymbol(buyAssetRaw);
    const preferredSpend =
      typeof rules.spend_asset === "string" ? rules.spend_asset : "USDC";
    const spendAsset = pickSpendAsset(portfolio, buyAsset, preferredSpend);
    if (!spendAsset) {
      return [asHeartbeatAction("No funding asset available for DCA cycle.")];
    }

    return [
      {
        type: "swap" as const,
        description: `DCA swap from ${spendAsset} into ${buyAsset}.`,
        params: {
          from_asset: spendAsset,
          to_asset: buyAsset,
          amount_usd:
            typeof rules.spend_amount_usd === "number" ? rules.spend_amount_usd : 15,
        },
      },
    ];
  }

  if (strategyType === "momentum") {
    const assets = Array.isArray(rules.assets)
      ? rules.assets.filter((item): item is string => typeof item === "string")
      : ["ETH", "BTC", "USDC"];

    const priceEntries = Object.entries(marketData.prices).filter(
      ([asset]) => asset !== "USDC"
    );

    const target = priceEntries.sort((a, b) => b[1] - a[1])[0]?.[0] ?? assets[0] ?? "ETH";
    const fromAsset = pickSpendAsset(portfolio, target, "USDC");
    if (!fromAsset) {
      return [asHeartbeatAction("No suitable source asset for momentum rotation.")];
    }

    return [
      {
        type: "swap" as const,
        description: `Momentum rotation from ${fromAsset} into ${target}.`,
        params: {
          from_asset: fromAsset,
          to_asset: target,
          signal: "fallback_momentum",
        },
      },
    ];
  }

  return [
    {
      type: "transfer" as const,
      description: "No-op heartbeat action to attest autonomous cycle.",
      params: {
        note: "fallback_custom_strategy_execution",
      },
    },
  ];
}

function parseTrackedTokens(config: Record<string, unknown>) {
  const list = Array.isArray(config.tracked_tokens) ? config.tracked_tokens : [];
  const unique = new Map<
    string,
    {
      address: string;
      symbol?: string;
      decimals?: number;
      bridgeController?: string;
      defaultBridgeAdapter?: string;
      yieldVault?: string;
    }
  >();

  for (const token of getServerDefaultKiteTokens()) {
    unique.set(token.address.toLowerCase(), {
      address: token.address,
      symbol: token.symbol,
      decimals: typeof token.decimals === "number" ? token.decimals : undefined,
      bridgeController:
        typeof token.bridgeController === "string"
          ? token.bridgeController
          : undefined,
      defaultBridgeAdapter:
        typeof token.defaultBridgeAdapter === "string"
          ? token.defaultBridgeAdapter
          : undefined,
      yieldVault:
        typeof token.yieldVault === "string"
          ? token.yieldVault
          : undefined,
    });
  }

  for (const entry of list) {
    if (!entry || typeof entry !== "object") {
      continue;
    }

    const row = entry as Record<string, unknown>;
    const address = typeof row.address === "string" ? row.address : null;
    if (!address || !ethers.isAddress(address)) {
      continue;
    }

    const symbol =
      typeof row.symbol === "string" && row.symbol.trim().length > 0
        ? normalizeAssetSymbol(row.symbol)
        : undefined;
    const decimals = toFiniteNumber(row.decimals);
    const bridgeController = toAddressString(row.bridge_controller);
    const defaultBridgeAdapter = toAddressString(row.default_bridge_adapter);
    const yieldVault = toAddressString(row.yield_vault);

    unique.set(address.toLowerCase(), {
      address,
      symbol,
      decimals: Number.isFinite(decimals) && decimals !== null ? Math.floor(decimals) : undefined,
      bridgeController: bridgeController ?? undefined,
      defaultBridgeAdapter: defaultBridgeAdapter ?? undefined,
      yieldVault: yieldVault ?? undefined,
    });
  }

  return Array.from(unique.values());
}

function resolveAgentSignerCredentials(agent: Agent): {
  ownerSignerAddress: string;
  privateKey: string;
} | null {
  const config = parseObject(agent.config);
  const ownerSignerAddressRaw =
    typeof config.agent_signer_address === "string"
      ? config.agent_signer_address
      : null;
  if (!ownerSignerAddressRaw || !ethers.isAddress(ownerSignerAddressRaw)) {
    return null;
  }

  const encryptedPrivateKeyRaw =
    typeof config.agent_signer_private_key_enc === "string"
      ? config.agent_signer_private_key_enc
      : null;
  const encryption =
    typeof config.agent_signer_key_encryption === "string"
      ? config.agent_signer_key_encryption
      : "none";

  const privateKey = decryptAgentSignerPrivateKey({
    encryptedPrivateKey: encryptedPrivateKeyRaw,
    encryption,
  });
  if (!privateKey) {
    return null;
  }

  return {
    ownerSignerAddress: ownerSignerAddressRaw,
    privateKey,
  };
}

export class AgentEngine {
  private aaSdk = createKiteAASdk();
  private fallbackSigner: ethers.Wallet | null;
  private fallbackDecisionLogContract: ethers.Contract | null;
  private decisionLogAddress: string | null;

  constructor() {
    this.decisionLogAddress = process.env.DECISION_LOG_CONTRACT ?? null;
    const masterKey = process.env.AGENT_MASTER_PRIVATE_KEY;
    if (masterKey && this.decisionLogAddress) {
      this.fallbackSigner = new ethers.Wallet(masterKey, provider);
      this.fallbackDecisionLogContract = new ethers.Contract(
        this.decisionLogAddress,
        DECISION_LOG_ABI,
        this.fallbackSigner
      );
    } else {
      this.fallbackSigner = null;
      this.fallbackDecisionLogContract = null;
      if (!this.decisionLogAddress) {
        console.warn("DECISION_LOG_CONTRACT not set - on-chain attestation disabled");
      } else if (!masterKey) {
        console.warn(
          "AGENT_MASTER_PRIVATE_KEY not set - fallback server-signer attestation disabled"
        );
      }
    }
  }

  private resolveVaultAddress(agent: Agent): string | null {
    const address = agent.aa_wallet_address || agent.vault_proxy_address;
    if (!address || !ethers.isAddress(address)) {
      return null;
    }
    return ethers.getAddress(address);
  }

  private resolveAgentSignerOrThrow(agent: Agent): {
    ownerSignerAddress: string;
    signFunction: (userOpHash: string) => Promise<string>;
  } {
    const credentials = resolveAgentSignerCredentials(agent);
    if (!credentials) {
      throw new Error(
        "Agent signer credentials are missing. Recreate agent with current flow before executing on-chain actions."
      );
    }

    const ownerSigner = new ethers.Wallet(credentials.privateKey);
    const signFunction = async (userOpHash: string) =>
      ownerSigner.signMessage(ethers.getBytes(userOpHash));

    return {
      ownerSignerAddress: credentials.ownerSignerAddress,
      signFunction,
    };
  }

  private async sendAgentOperationAndWait(
    agent: Agent,
    request:
      | { target: string; value: bigint; callData: string }
      | { targets: string[]; values: bigint[]; callDatas: string[] }
  ): Promise<string | null> {
    const signer = this.resolveAgentSignerOrThrow(agent);
    const result = await this.aaSdk.sendUserOperationAndWait(
      signer.ownerSignerAddress,
      request,
      signer.signFunction
    );
    return resolveTxHashFromStatus(result.status);
  }

  private async buildTokenCatalog(agent: Agent): Promise<TokenCatalog> {
    const config = parseObject(agent.config);
    const tracked = parseTrackedTokens(config);

    const bySymbol = new Map<string, ResolvedToken>();
    const byAddress = new Map<string, ResolvedToken>();

    for (const entry of tracked) {
      if (!ethers.isAddress(entry.address)) {
        continue;
      }

      const normalizedAddress = ethers.getAddress(entry.address);
      let decimals: number | null = null;
      let symbol: string | null = entry.symbol
        ? normalizeAssetSymbol(entry.symbol)
        : null;

      try {
        const contract = new ethers.Contract(normalizedAddress, ERC20_ABI, provider);
        const onChainDecimals = Number(await contract.decimals());
        if (Number.isFinite(onChainDecimals) && onChainDecimals >= 0) {
          decimals = Math.max(Math.floor(onChainDecimals), 0);
        }
        if (!symbol) {
          const onChainSymbol = await contract.symbol();
          if (typeof onChainSymbol === "string" && onChainSymbol.trim().length > 0) {
            symbol = normalizeAssetSymbol(onChainSymbol);
          }
        }
      } catch {
        // Keep fallback metadata below.
      }

      if (decimals === null) {
        decimals =
          typeof entry.decimals === "number" && Number.isFinite(entry.decimals)
            ? Math.max(Math.floor(entry.decimals), 0)
            : 18;
      }
      if (!symbol) {
        symbol = "TOKEN";
      }

      const token: ResolvedToken = {
        address: normalizedAddress,
        symbol,
        decimals,
        bridgeController: entry.bridgeController,
        defaultBridgeAdapter: entry.defaultBridgeAdapter,
        yieldVault: entry.yieldVault,
      };

      byAddress.set(normalizedAddress.toLowerCase(), token);
      if (!bySymbol.has(token.symbol)) {
        bySymbol.set(token.symbol, token);
      }
    }

    return { bySymbol, byAddress };
  }

  private resolveTokenFromInput(
    catalog: TokenCatalog,
    tokenInput: unknown
  ): ResolvedToken | null {
    if (typeof tokenInput !== "string" || tokenInput.trim().length === 0) {
      return null;
    }
    const trimmed = tokenInput.trim();
    if (ethers.isAddress(trimmed)) {
      return catalog.byAddress.get(trimmed.toLowerCase()) ?? null;
    }
    const symbol = normalizeAssetSymbol(trimmed);
    return catalog.bySymbol.get(symbol) ?? null;
  }

  private resolveUsdAmountToUnits(
    usdAmount: number,
    token: ResolvedToken,
    marketData: MarketData
  ): bigint {
    const price = marketData.prices[token.symbol] ?? (token.symbol.includes("USD") ? 1 : null);
    if (!price || !Number.isFinite(price) || price <= 0) {
      throw new Error(
        `Unable to price token ${token.symbol}. Add price feed support or provide explicit token amount.`
      );
    }
    const tokenAmount = usdAmount / price;
    if (!Number.isFinite(tokenAmount) || tokenAmount <= 0) {
      throw new Error(`Invalid USD amount ${usdAmount} for token ${token.symbol}`);
    }

    const precision = Math.min(token.decimals, 8);
    return ethers.parseUnits(tokenAmount.toFixed(precision), token.decimals);
  }

  private async resolveTradeAmountUnits(params: {
    token: ResolvedToken;
    marketData: MarketData;
    actionParams: Record<string, unknown>;
    walletAddress: string;
  }): Promise<bigint> {
    const { token, marketData, actionParams, walletAddress } = params;

    const contract = new ethers.Contract(token.address, ERC20_ABI, provider);
    const balance = (await contract.balanceOf(walletAddress)) as bigint;
    if (balance <= BigInt(0)) {
      throw new Error(`Vault has no ${token.symbol} balance to execute action.`);
    }

    let requested: bigint | null = null;

    const amountUnits = toBigIntValue(actionParams.amount_units ?? actionParams.amount_wei);
    if (amountUnits !== null && amountUnits > BigInt(0)) {
      requested = amountUnits;
    } else {
      const tokenAmount =
        toFiniteNumber(actionParams.amount_token ?? actionParams.amount_asset ?? actionParams.amount);
      if (tokenAmount !== null && tokenAmount > 0) {
        requested = ethers.parseUnits(tokenAmount.toString(), token.decimals);
      } else {
        const usdAmount = toFiniteNumber(
          actionParams.amount_usd ?? actionParams.spend_amount_usd
        );
        if (usdAmount !== null && usdAmount > 0) {
          requested = this.resolveUsdAmountToUnits(usdAmount, token, marketData);
        }
      }
    }

    if (!requested || requested <= BigInt(0)) {
      throw new Error("Action does not provide a valid amount to execute.");
    }

    // Avoid full balance drains from rounding and leave tiny dust.
    const safetyMax =
      balance > BigInt(10) ? balance - BigInt(1) : balance;
    return requested > safetyMax ? safetyMax : requested;
  }

  private async executeSwapAction(params: {
    agent: Agent;
    action: AgentAction;
    marketData: MarketData;
    catalog: TokenCatalog;
    walletAddress: string;
  }): Promise<string | null> {
    const { agent, action, marketData, catalog, walletAddress } = params;
    const router =
      toAddressString(action.params.router) ??
      toAddressString(action.params.router_address) ??
      toAddressString(process.env.KITE_SWAP_ROUTER_ADDRESS);
    if (!router) {
      throw new Error(
        "Swap router is not configured. Set KITE_SWAP_ROUTER_ADDRESS or provide router in action params."
      );
    }

    const fromToken =
      this.resolveTokenFromInput(
        catalog,
        action.params.from_token_address ?? action.params.from_token ?? action.params.from_asset
      ) ?? null;
    const toToken =
      this.resolveTokenFromInput(
        catalog,
        action.params.to_token_address ?? action.params.to_token ?? action.params.to_asset
      ) ?? null;
    if (!fromToken || !toToken) {
      throw new Error("Swap action requires resolvable from/to tokens.");
    }
    if (fromToken.address.toLowerCase() === toToken.address.toLowerCase()) {
      throw new Error("Swap source and destination tokens are identical.");
    }

    const amountIn = await this.resolveTradeAmountUnits({
      token: fromToken,
      marketData,
      actionParams: action.params,
      walletAddress,
    });
    if (amountIn <= BigInt(0)) {
      throw new Error("Swap amount resolved to zero.");
    }

    let minAmountOut = toBigIntValue(action.params.amount_out_min ?? action.params.min_amount_out);
    if (minAmountOut === null || minAmountOut < BigInt(0)) {
      const fromPrice = marketData.prices[fromToken.symbol] ?? (fromToken.symbol.includes("USD") ? 1 : 0);
      const toPrice = marketData.prices[toToken.symbol] ?? (toToken.symbol.includes("USD") ? 1 : 0);
      if (fromPrice <= 0 || toPrice <= 0) {
        throw new Error("Unable to compute swap min output due to missing token prices.");
      }
      const slippagePct = clamp(
        toFiniteNumber(action.params.max_slippage_pct ?? action.params.slippage_pct) ?? 1,
        0,
        30
      );
      const amountInFloat = Number(ethers.formatUnits(amountIn, fromToken.decimals));
      const grossTo = (amountInFloat * fromPrice) / toPrice;
      const netTo = grossTo * (1 - slippagePct / 100);
      minAmountOut = ethers.parseUnits(
        Math.max(netTo, 0).toFixed(Math.min(toToken.decimals, 8)),
        toToken.decimals
      );
    }

    const pathRaw = action.params.path;
    const path =
      Array.isArray(pathRaw) && pathRaw.length >= 2
        ? pathRaw
            .map((entry) => toAddressString(entry))
            .filter((entry): entry is string => Boolean(entry))
        : [fromToken.address, toToken.address];
    if (path.length < 2) {
      throw new Error("Swap path is invalid.");
    }
    if (path[0].toLowerCase() !== fromToken.address.toLowerCase()) {
      path.unshift(fromToken.address);
    }
    if (path[path.length - 1].toLowerCase() !== toToken.address.toLowerCase()) {
      path.push(toToken.address);
    }

    const deadlineSeconds = Math.max(
      Math.floor(toFiniteNumber(action.params.deadline_seconds) ?? 900),
      30
    );
    const deadline = BigInt(Math.floor(Date.now() / 1000) + deadlineSeconds);

    const erc20 = new ethers.Interface(ERC20_ABI);
    const routerIface = new ethers.Interface(UNISWAP_V2_ROUTER_ABI);
    const approveData = erc20.encodeFunctionData("approve", [router, amountIn]);
    const swapData = routerIface.encodeFunctionData("swapExactTokensForTokens", [
      amountIn,
      minAmountOut,
      path,
      walletAddress,
      deadline,
    ]);

    return this.sendAgentOperationAndWait(agent, {
      targets: [fromToken.address, router],
      values: [BigInt(0), BigInt(0)],
      callDatas: [approveData, swapData],
    });
  }

  private async executeBridgeAction(params: {
    agent: Agent;
    action: AgentAction;
    marketData: MarketData;
    catalog: TokenCatalog;
    walletAddress: string;
  }): Promise<string | null> {
    const { agent, action, marketData, catalog, walletAddress } = params;
    const token =
      this.resolveTokenFromInput(
        catalog,
        action.params.asset ??
          action.params.from_token ??
          action.params.from_token_address ??
          action.params.from_asset
      ) ?? null;
    if (!token) {
      throw new Error("Bridge action requires a resolvable source token.");
    }

    const controller =
      toAddressString(action.params.controller) ??
      toAddressString(action.params.bridge_controller) ??
      toAddressString(token.bridgeController) ??
      toAddressString(process.env.KITE_BRIDGE_CONTROLLER_ADDRESS);
    if (!controller) {
      throw new Error(
        "Bridge controller is not configured. Set KITE_BRIDGE_CONTROLLER_ADDRESS or provide it in action params."
      );
    }

    const bridgeAdapter =
      toAddressString(action.params.bridge_adapter) ??
      toAddressString(token.defaultBridgeAdapter) ??
      toAddressString(process.env.KITE_BRIDGE_ADAPTER_ADDRESS);
    if (!bridgeAdapter) {
      throw new Error(
        "Bridge adapter is not configured. Provide bridge_adapter in action params or set KITE_BRIDGE_ADAPTER_ADDRESS."
      );
    }

    const destinationChainIdRaw = toFiniteNumber(
      action.params.dest_chain_id ??
        action.params.destination_chain_id ??
        action.params.dst_chain_id
    );
    if (!destinationChainIdRaw || destinationChainIdRaw <= 0) {
      throw new Error("Bridge action must include destination chain id.");
    }
    const destinationChainId = BigInt(Math.floor(destinationChainIdRaw));

    const config = parseObject(agent.config);
    const recipient =
      toAddressString(action.params.recipient) ??
      toAddressString(config.owner_wallet_address) ??
      walletAddress;
    const unwrap = toBoolean(action.params.unwrap, false);
    const bridgeOptions = toBytes(action.params.bridge_options);

    const nativeFeeWei =
      toBigIntValue(action.params.native_fee_wei) ??
      (typeof action.params.native_fee_eth === "string"
        ? ethers.parseEther(action.params.native_fee_eth)
        : BigInt(0));

    const amount = await this.resolveTradeAmountUnits({
      token,
      marketData,
      actionParams: action.params,
      walletAddress,
    });
    if (amount <= BigInt(0)) {
      throw new Error("Bridge amount resolved to zero.");
    }

    const erc20 = new ethers.Interface(ERC20_ABI);
    const controllerIface = new ethers.Interface(BRIDGE_CONTROLLER_ABI);
    const approveData = erc20.encodeFunctionData("approve", [controller, amount]);
    const bridgeData = controllerIface.encodeFunctionData("transferTo", [
      recipient,
      amount,
      unwrap,
      destinationChainId,
      bridgeAdapter,
      bridgeOptions,
    ]);

    return this.sendAgentOperationAndWait(agent, {
      targets: [token.address, controller],
      values: [BigInt(0), nativeFeeWei],
      callDatas: [approveData, bridgeData],
    });
  }

  private async executeYieldDepositAction(params: {
    agent: Agent;
    action: AgentAction;
    marketData: MarketData;
    catalog: TokenCatalog;
    walletAddress: string;
  }): Promise<string | null> {
    const { agent, action, marketData, catalog, walletAddress } = params;
    const token =
      this.resolveTokenFromInput(
        catalog,
        action.params.asset ??
          action.params.from_asset ??
          action.params.from_token ??
          action.params.from_token_address
      ) ?? null;
    if (!token) {
      throw new Error("Yield deposit requires a resolvable token.");
    }

    const vault =
      toAddressString(action.params.yield_vault) ??
      toAddressString(action.params.vault) ??
      toAddressString(token.yieldVault) ??
      toAddressString(process.env.KITE_YIELD_VAULT_ADDRESS);
    if (!vault) {
      throw new Error(
        "Yield vault is not configured. Set KITE_YIELD_VAULT_ADDRESS or provide yield_vault in action params."
      );
    }

    const amount = await this.resolveTradeAmountUnits({
      token,
      marketData,
      actionParams: action.params,
      walletAddress,
    });
    if (amount <= BigInt(0)) {
      throw new Error("Yield deposit amount resolved to zero.");
    }

    const receiver = toAddressString(action.params.receiver) ?? walletAddress;
    const erc20 = new ethers.Interface(ERC20_ABI);
    const vaultIface = new ethers.Interface(ERC4626_ABI);
    const approveData = erc20.encodeFunctionData("approve", [vault, amount]);
    const depositData = vaultIface.encodeFunctionData("deposit", [amount, receiver]);

    return this.sendAgentOperationAndWait(agent, {
      targets: [token.address, vault],
      values: [BigInt(0), BigInt(0)],
      callDatas: [approveData, depositData],
    });
  }

  private async executeYieldWithdrawAction(params: {
    agent: Agent;
    action: AgentAction;
    marketData: MarketData;
    catalog: TokenCatalog;
    walletAddress: string;
  }): Promise<string | null> {
    const { agent, action, marketData, catalog, walletAddress } = params;
    const token =
      this.resolveTokenFromInput(
        catalog,
        action.params.asset ??
          action.params.to_asset ??
          action.params.from_asset ??
          action.params.from_token
      ) ?? null;
    if (!token) {
      throw new Error("Yield withdraw requires a resolvable token.");
    }

    const vault =
      toAddressString(action.params.yield_vault) ??
      toAddressString(action.params.vault) ??
      toAddressString(token.yieldVault) ??
      toAddressString(process.env.KITE_YIELD_VAULT_ADDRESS);
    if (!vault) {
      throw new Error(
        "Yield vault is not configured. Set KITE_YIELD_VAULT_ADDRESS or provide yield_vault in action params."
      );
    }

    const recipient = toAddressString(action.params.recipient) ?? walletAddress;
    const owner = toAddressString(action.params.owner) ?? walletAddress;
    const useRedeem = toBoolean(action.params.redeem, false);

    const vaultIface = new ethers.Interface(ERC4626_ABI);
    let callData: string;

    if (useRedeem) {
      const shareDecimalsContract = new ethers.Contract(vault, ERC20_ABI, provider);
      const shareDecimals = Number(await shareDecimalsContract.decimals().catch(() => 18));
      const sharesRaw =
        toFiniteNumber(action.params.shares ?? action.params.amount_shares ?? action.params.amount);
      if (!sharesRaw || sharesRaw <= 0) {
        throw new Error("Yield redeem requires a positive share amount.");
      }
      const shares = ethers.parseUnits(
        sharesRaw.toFixed(Math.min(Math.max(shareDecimals, 0), 8)),
        Math.max(Math.floor(shareDecimals), 0)
      );
      callData = vaultIface.encodeFunctionData("redeem", [shares, recipient, owner]);
    } else {
      const assets = await this.resolveTradeAmountUnits({
        token,
        marketData,
        actionParams: action.params,
        walletAddress,
      });
      callData = vaultIface.encodeFunctionData("withdraw", [assets, recipient, owner]);
    }

    return this.sendAgentOperationAndWait(agent, {
      target: vault,
      value: BigInt(0),
      callData,
    });
  }

  private async executeTransferAction(params: {
    agent: Agent;
    action: AgentAction;
    marketData: MarketData;
    catalog: TokenCatalog;
    walletAddress: string;
  }): Promise<string | null> {
    const { agent, action, marketData, catalog, walletAddress } = params;
    if (
      typeof action.params.note === "string" &&
      action.params.note.toLowerCase() === "no_trade_cycle"
    ) {
      return null;
    }

    const recipient = toAddressString(action.params.recipient);
    if (!recipient) {
      return null;
    }

    const tokenInput = action.params.asset ?? action.params.token ?? action.params.token_address;
    const token = this.resolveTokenFromInput(catalog, tokenInput);
    if (!token || normalizeAssetSymbol(token.symbol) === "KITE") {
      const kiteAmount = toFiniteNumber(action.params.amount_kite ?? action.params.amount);
      const amountUsd = toFiniteNumber(action.params.amount_usd);
      const amountWei =
        toBigIntValue(action.params.amount_wei) ??
        (kiteAmount && kiteAmount > 0
          ? ethers.parseEther(kiteAmount.toString())
          : amountUsd && amountUsd > 0
            ? ethers.parseEther(
                (amountUsd / Math.max(marketData.prices.KITE ?? 0.01, 0.000001)).toFixed(8)
              )
            : null);

      if (!amountWei || amountWei <= BigInt(0)) {
        return null;
      }
      return this.sendAgentOperationAndWait(agent, {
        target: recipient,
        value: amountWei,
        callData: "0x",
      });
    }

    const amount = await this.resolveTradeAmountUnits({
      token,
      marketData,
      actionParams: action.params,
      walletAddress,
    });
    const tokenIface = new ethers.Interface(["function transfer(address to, uint256 amount) returns (bool)"]);
    const callData = tokenIface.encodeFunctionData("transfer", [recipient, amount]);
    return this.sendAgentOperationAndWait(agent, {
      target: token.address,
      value: BigInt(0),
      callData,
    });
  }

  private async executeAction(params: {
    agent: Agent;
    action: AgentAction;
    marketData: MarketData;
    catalog: TokenCatalog;
    walletAddress: string;
  }): Promise<string | null> {
    const { action } = params;
    switch (action.type) {
      case "swap":
        return this.executeSwapAction(params);
      case "bridge":
        return this.executeBridgeAction(params);
      case "yield_deposit":
        return this.executeYieldDepositAction(params);
      case "yield_withdraw":
        return this.executeYieldWithdrawAction(params);
      case "transfer":
        return this.executeTransferAction(params);
      case "rebalance":
        return null;
      default:
        return null;
    }
  }

  async getPortfolioState(agent: Agent): Promise<PortfolioState> {
    const address = agent.aa_wallet_address || agent.vault_proxy_address;
    if (!address) {
      return { totalValueUsd: 0, holdings: [] };
    }

    const prices = await this.fetchMarketPrices();
    const holdings: PortfolioHolding[] = [];

    const balance = await provider.getBalance(address);
    const kiteBalance = Number.parseFloat(ethers.formatEther(balance));
    const kiteValueUsd = kiteBalance * (prices.KITE || 0);
    holdings.push({
      asset: "KITE",
      chain: "kite",
      amount: kiteBalance.toFixed(6),
      valueUsd: kiteValueUsd,
    });

    const config = parseObject(agent.config);
    const trackedTokens = parseTrackedTokens(config);
    for (const token of trackedTokens) {
      try {
        const contract = new ethers.Contract(token.address, ERC20_ABI, provider);
        const onChainDecimals = Number(await contract.decimals());
        const decimalsRaw =
          Number.isFinite(onChainDecimals) && onChainDecimals >= 0
            ? onChainDecimals
            : typeof token.decimals === "number"
              ? token.decimals
              : 18;
        const decimals = Number.isFinite(decimalsRaw) ? Math.max(Math.floor(decimalsRaw), 0) : 18;
        const symbolRaw =
          token.symbol ??
          (await contract.symbol().catch(() => "TOKEN"));
        const symbol = normalizeAssetSymbol(symbolRaw);
        const raw = await contract.balanceOf(address);
        const amount = Number.parseFloat(ethers.formatUnits(raw, decimals));
        if (!Number.isFinite(amount) || amount <= 0) {
          continue;
        }

        const price = prices[symbol] ?? (symbol.includes("USD") ? 1 : 0);
        holdings.push({
          asset: symbol,
          chain: "kite",
          amount: amount.toFixed(6),
          valueUsd: amount * price,
        });
      } catch {
        // Ignore broken/unavailable token contracts.
      }
    }

    const totalValueUsd = holdings.reduce((sum, item) => sum + item.valueUsd, 0);
    return {
      totalValueUsd,
      holdings,
    };
  }

  async fetchMarketPrices(): Promise<Record<string, number>> {
    const fallbackKite = Number.parseFloat(process.env.KITE_PRICE_USD ?? "0.01");

    try {
      const res = await fetch(
        "https://api.coingecko.com/api/v3/simple/price?ids=ethereum,usd-coin,bitcoin,tether,paypal-usd&vs_currencies=usd",
        { next: { revalidate: 60 } }
      );
      const data = await res.json();
      return {
        ETH: data?.ethereum?.usd ?? 0,
        USDC: data?.["usd-coin"]?.usd ?? 1,
        USDT: data?.tether?.usd ?? 1,
        BTC: data?.bitcoin?.usd ?? 0,
        PYUSD: data?.["paypal-usd"]?.usd ?? 1,
        KITE: Number.isFinite(fallbackKite) ? fallbackKite : 0.01,
      };
    } catch {
      return {
        ETH: 0,
        USDC: 1,
        USDT: 1,
        BTC: 0,
        PYUSD: 1,
        KITE: Number.isFinite(fallbackKite) ? fallbackKite : 0.01,
      };
    }
  }

  async fetchMarketData(): Promise<MarketData> {
    const prices = await this.fetchMarketPrices();
    return { prices, timestamp: Date.now() };
  }

  async makeDecision(
    portfolio: PortfolioState,
    marketData: MarketData,
    strategy: Strategy,
    agent: Agent
  ): Promise<AgentAction[]> {
    const systemPrompt = `You are an autonomous DeFi portfolio agent running on Kite AI chain.
Analyze the portfolio and market data, then decide what actions to take based on the strategy rules.
Return a JSON object with an "actions" array. Each action has: type, description, params.
Valid action types: swap, bridge, yield_deposit, yield_withdraw, transfer, rebalance.
If no action is needed, return {"actions": [], "reasoning": "..."}.
Be conservative - only suggest actions that are clearly supported by the strategy rules.`;

    const decisionInput = {
      portfolio,
      marketData,
      strategyRules: strategy.rules,
      strategyType: strategy.type,
      agentConfig: agent.config,
      spendingLimits: agent.spending_rules,
    };

    const providerName = resolveAIProvider();
    if (!providerName) {
      return applyMicroPositionSizing(
        fallbackActions(strategy, agent, marketData, portfolio),
        portfolio,
        strategy,
        agent
      );
    }

    try {
      let candidateActions: AgentAction[] = [];

      if (providerName === "openai") {
        if (!openai) {
          throw new Error("OPENAI_API_KEY not set");
        }

        const completion = await openai.chat.completions.create({
          model: process.env.OPENAI_MODEL ?? "gpt-4o-mini",
          messages: [
            {
              role: "system",
              content: systemPrompt,
            },
            {
              role: "user",
              content: JSON.stringify(decisionInput),
            },
          ],
          response_format: { type: "json_object" },
          temperature: 0.3,
        });

        const raw = completion.choices[0]?.message?.content ?? '{"actions":[]}';
        const parsed = parseDecisionJson(raw);
        candidateActions = normalizeActions((parsed as { actions?: unknown }).actions ?? []);
      } else {
        const geminiApiKey = process.env.GEMINI_API_KEY;
        if (!geminiApiKey) {
          throw new Error("GEMINI_API_KEY not set");
        }

        const geminiModel = process.env.GEMINI_MODEL ?? "gemini-2.5-flash";
        const geminiResponse = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
            geminiModel
          )}:generateContent`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-goog-api-key": geminiApiKey,
            },
            body: JSON.stringify({
              system_instruction: {
                parts: [{ text: systemPrompt }],
              },
              contents: [
                {
                  role: "user",
                  parts: [{ text: JSON.stringify(decisionInput) }],
                },
              ],
              generationConfig: {
                temperature: 0.3,
                responseMimeType: "application/json",
              },
            }),
          }
        );

        if (!geminiResponse.ok) {
          const errorText = await geminiResponse.text();
          throw new Error(
            `Gemini API request failed (${geminiResponse.status}): ${errorText.slice(0, 300)}`
          );
        }

        const geminiPayload = await geminiResponse.json();
        const rawText = extractGeminiText(geminiPayload);
        if (!rawText) {
          throw new Error("Gemini returned an empty response");
        }

        const parsed = parseDecisionJson(rawText);
        candidateActions = normalizeActions((parsed as { actions?: unknown }).actions ?? []);
      }

      const fallback = fallbackActions(strategy, agent, marketData, portfolio);
      return applyMicroPositionSizing(
        candidateActions.length > 0 ? candidateActions : fallback,
        portfolio,
        strategy,
        agent
      );
    } catch (error) {
      console.error("AI decision failed, using fallback actions:", error);
      return applyMicroPositionSizing(
        fallbackActions(strategy, agent, marketData, portfolio),
        portfolio,
        strategy,
        agent
      );
    }
  }

  async logDecisionOnChain(
    agent: Agent,
    decisionData: Record<string, unknown>,
    actionType: string
  ): Promise<{ hash: string | null }> {
    if (!this.decisionLogAddress) {
      console.warn("Decision log contract not configured - skipping on-chain attestation");
      return { hash: null };
    }

    const decisionHash = ethers.keccak256(
      ethers.toUtf8Bytes(JSON.stringify(decisionData))
    );
    const iface = new ethers.Interface(DECISION_LOG_ABI);
    const callData = iface.encodeFunctionData("logDecision", [
      decisionHash,
      actionType,
      "",
    ]);

    const credentials = resolveAgentSignerCredentials(agent);
    if (credentials) {
      try {
        const ownerSigner = new ethers.Wallet(credentials.privateKey);
        const signFunction = async (userOpHash: string) =>
          ownerSigner.signMessage(ethers.getBytes(userOpHash));

        const userOp = await this.aaSdk.sendUserOperationAndWait(
          credentials.ownerSignerAddress,
          {
            target: this.decisionLogAddress,
            value: BigInt(0),
            callData,
          },
          signFunction
        );

        const status = userOp.status as {
          transactionHash?: string;
          receipt?: {
            receipt?: {
              transactionHash?: string;
            };
          };
        };
        const txHash =
          status.transactionHash ?? status.receipt?.receipt?.transactionHash ?? null;
        if (txHash) {
          return { hash: txHash };
        }
      } catch (error) {
        console.error("AA attestation failed, trying fallback signer:", error);
      }
    }

    if (!this.fallbackDecisionLogContract) {
      return { hash: null };
    }

    try {
      const tx = await this.fallbackDecisionLogContract.logDecision(
        decisionHash,
        actionType,
        ""
      );
      const receipt = await tx.wait();
      return { hash: receipt?.hash ?? tx.hash ?? null };
    } catch (error) {
      console.error("Failed to log decision on-chain:", error);
      return { hash: null };
    }
  }

  async executeStrategy(
    agent: Agent,
    strategy: Strategy
  ): Promise<{
    actions: AgentAction[];
    txHashes: string[];
    actionResults: ActionExecutionResult[];
    attestationHash: string | null;
  }> {
    const portfolio = await this.getPortfolioState(agent);
    const marketData = await this.fetchMarketData();
    const actions = await this.makeDecision(portfolio, marketData, strategy, agent);

    if (actions.length === 0) {
      return { actions: [], txHashes: [], actionResults: [], attestationHash: null };
    }

    const walletAddress = this.resolveVaultAddress(agent);
    if (!walletAddress) {
      throw new Error("Agent has no AA/vault wallet configured for on-chain execution.");
    }

    const catalog = await this.buildTokenCatalog(agent);
    const txHashes: string[] = [];
    let firstAttestationHash: string | null = null;
    const actionResults: ActionExecutionResult[] = [];

    for (const action of actions) {
      let executionTxHash: string | null = null;
      let executionError: string | null = null;

      try {
        executionTxHash = await this.executeAction({
          agent,
          action,
          marketData,
          catalog,
          walletAddress,
        });
      } catch (error) {
        executionError = error instanceof Error ? error.message : "Unknown action execution error";
      }

      const decisionPayload = {
        portfolio,
        marketData,
        action,
        strategyId: strategy.id,
        agentId: agent.id,
        execution_tx_hash: executionTxHash,
        execution_error: executionError,
        timestamp: Date.now(),
      };

      const attestation = await this.logDecisionOnChain(
        agent,
        decisionPayload,
        action.type
      );

      if (!firstAttestationHash && attestation.hash) {
        firstAttestationHash = attestation.hash;
      }

      const canonicalTxHash = executionTxHash ?? attestation.hash ?? null;
      if (canonicalTxHash) {
        txHashes.push(canonicalTxHash);
      }

      actionResults.push({
        action,
        executionTxHash,
        attestationTxHash: attestation.hash,
        status: executionError ? "failed" : "success",
        error: executionError,
      });

    }

    return {
      actions,
      txHashes,
      actionResults,
      attestationHash: firstAttestationHash,
    };
  }
}

let engine: AgentEngine | null = null;

export function getAgentEngine(): AgentEngine {
  if (!engine) {
    engine = new AgentEngine();
  }
  return engine;
}


