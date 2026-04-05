import { getDefaultConfig } from "@rainbow-me/rainbowkit";
import { http } from "viem";
import { kiteTestnet } from "./kite-chain";

export const wagmiConfig = getDefaultConfig({
  appName: "KiteSwarm",
  projectId: process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID || "demo",
  chains: [kiteTestnet],
  transports: {
    [kiteTestnet.id]: http(kiteTestnet.rpcUrls.default.http[0]),
  },
  ssr: true,
});
