import { defineChain } from "viem";

const defaultRpcUrl = "https://rpc-testnet.gokite.ai";
const configuredChainId = Number.parseInt(
  process.env.NEXT_PUBLIC_KITE_CHAIN_ID ?? "2368",
  10
);
const kiteChainId = Number.isFinite(configuredChainId) ? configuredChainId : 2368;
const kiteRpcUrl = process.env.NEXT_PUBLIC_KITE_RPC_URL ?? defaultRpcUrl;

export const kiteTestnet = defineChain({
  id: kiteChainId,
  name: "Kite AI Testnet",
  nativeCurrency: {
    decimals: 18,
    name: "KITE",
    symbol: "KITE",
  },
  rpcUrls: {
    default: {
      http: [kiteRpcUrl],
    },
  },
  blockExplorers: {
    default: {
      name: "KiteScan",
      url: "https://testnet.kitescan.ai",
    },
  },
  testnet: true,
});

export const kiteMainnet = defineChain({
  id: 2366,
  name: "Kite AI",
  nativeCurrency: {
    decimals: 18,
    name: "KITE",
    symbol: "KITE",
  },
  rpcUrls: {
    default: {
      http: ["https://rpc.gokite.ai"],
    },
  },
  blockExplorers: {
    default: {
      name: "KiteScan",
      url: "https://kitescan.ai",
    },
  },
});

// Contract addresses (Kite Testnet)
export const CONTRACTS = {
  settlementToken: "0x0fF5393387ad2f9f691FD6Fd28e07E3969e27e63" as const,
  settlementContract: "0x8d9FaD78d5Ce247aA01C140798B9558fd64a63E3" as const,
  clientAgentVault: "0xB5AAFCC6DD4DFc2B80fb8BCcf406E1a2Fd559e23" as const,
  gaslessPYUSD: "0x8E04D099b1a8Dd20E6caD4b2Ab2B405B98242ec9" as const,
  decisionLog: process.env.NEXT_PUBLIC_DECISION_LOG_CONTRACT ?? "",
} as const;

// Mainnet addresses
export const MAINNET_CONTRACTS = {
  usdc: "0x7aB6f3ed87C42eF0aDb67Ed95090f8bF5240149e" as const,
  lucidController: "0x92E2391d0836e10b9e5EAB5d56BfC286Fadec25b" as const,
} as const;

export const KITE_EXPLORER_URL = "https://testnet.kitescan.ai";

export const kiteTestnetAddChainParams = {
  chainId: `0x${kiteTestnet.id.toString(16)}`,
  chainName: kiteTestnet.name,
  nativeCurrency: kiteTestnet.nativeCurrency,
  rpcUrls: kiteTestnet.rpcUrls.default.http,
  blockExplorerUrls: [kiteTestnet.blockExplorers.default.url],
};

export function getExplorerTxUrl(txHash: string) {
  return `${KITE_EXPLORER_URL}/tx/${txHash}`;
}

export function getExplorerAddressUrl(address: string) {
  return `${KITE_EXPLORER_URL}/address/${address}`;
}
