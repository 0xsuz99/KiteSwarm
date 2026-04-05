export type KiteToken = {
  symbol: string;
  address: `0x${string}`;
  decimals?: number;
  label?: string;
};

export const KITE_TESTNET_TOKENS: KiteToken[] = [
  {
    symbol: "USDT",
    address: "0x0fF5393387ad2f9f691FD6Fd28e07E3969e27e63",
    decimals: 6,
    label: "USDT (Kite Testnet)",
  },
  {
    symbol: "PYUSD",
    address: "0x8E04D099b1a8Dd20E6caD4b2Ab2B405B98242ec9",
    decimals: 6,
    label: "PYUSD (Kite Testnet)",
  },
];

export const KITE_MAINNET_TOKENS: KiteToken[] = [
  {
    symbol: "USDC",
    address: "0x7aB6f3ed87C42eF0aDb67Ed95090f8bF5240149e",
    decimals: 6,
    label: "USDC (Kite Mainnet)",
  },
];

export function getKiteTokensByChainId(chainId: number): KiteToken[] {
  if (chainId === 2366) {
    return KITE_MAINNET_TOKENS;
  }
  return KITE_TESTNET_TOKENS;
}

export function getServerDefaultKiteTokens(): KiteToken[] {
  const chainId = Number.parseInt(process.env.KITE_CHAIN_ID ?? "2368", 10);
  return getKiteTokensByChainId(chainId);
}
