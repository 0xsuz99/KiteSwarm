import type { WalletClient } from "viem";
import { toHex } from "viem";
import { kiteTestnet, kiteTestnetAddChainParams } from "@/lib/kite-chain";

function isMissingChainError(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: number }).code === 4902
  );
}

export async function ensureKiteChain(walletClient: WalletClient) {
  try {
    await walletClient.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: toHex(kiteTestnet.id) }],
    });
    return;
  } catch (switchError) {
    if (!isMissingChainError(switchError)) {
      throw switchError;
    }
  }

  await walletClient.request({
    method: "wallet_addEthereumChain",
    params: [kiteTestnetAddChainParams],
  });

  await walletClient.request({
    method: "wallet_switchEthereumChain",
    params: [{ chainId: toHex(kiteTestnet.id) }],
  });
}
