import "server-only";
import { GokiteAASDK } from "gokite-aa-sdk";

type KiteNetwork = "kite_testnet" | "kite_mainnet";

function resolveNetwork(): KiteNetwork {
  const chainId = Number.parseInt(process.env.KITE_CHAIN_ID ?? "2368", 10);
  return chainId === 2366 ? "kite_mainnet" : "kite_testnet";
}

function resolveRpcUrl(network: KiteNetwork) {
  if (network === "kite_mainnet") {
    return process.env.KITE_RPC_URL ?? "https://rpc.gokite.ai";
  }
  return process.env.KITE_RPC_URL ?? "https://rpc-testnet.gokite.ai";
}

function resolveBundlerUrl() {
  return process.env.KITE_BUNDLER_URL ?? "https://bundler-service.staging.gokite.ai/rpc/";
}

export function createKiteAASdk() {
  const network = resolveNetwork();
  return new GokiteAASDK(network, resolveRpcUrl(network), resolveBundlerUrl());
}

export function getAgentAAWalletAddress(ownerSignerAddress: string) {
  const sdk = createKiteAASdk();
  return sdk.getAccountAddress(ownerSignerAddress);
}
