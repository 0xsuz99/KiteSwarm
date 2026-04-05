import { config as loadEnv } from "dotenv";
import { defineConfig } from "hardhat/config";
import hardhatEthers from "@nomicfoundation/hardhat-ethers";

loadEnv({ path: ".env.local" });

const accounts = process.env.AGENT_MASTER_PRIVATE_KEY
  ? [process.env.AGENT_MASTER_PRIVATE_KEY]
  : [];

const config = defineConfig({
  plugins: [hardhatEthers],
  solidity: "0.8.20",
  networks: {
    kiteTestnet: {
      type: "http",
      url: process.env.KITE_RPC_URL ?? "https://rpc-testnet.gokite.ai",
      chainId: 2368,
      accounts,
    },
    kiteMainnet: {
      type: "http",
      url: "https://rpc.gokite.ai",
      chainId: 2366,
      accounts,
    },
  },
});

export default config;
