import { network } from "hardhat";

async function main() {
  const { ethers } = await network.connect();
  console.log("Deploying DecisionLog contract to Kite...");

  const DecisionLog = await ethers.getContractFactory("DecisionLog");
  const decisionLog = await DecisionLog.deploy();
  await decisionLog.waitForDeployment();

  const address = await decisionLog.getAddress();
  console.log("DecisionLog deployed to:", address);
  console.log("Set DECISION_LOG_CONTRACT and NEXT_PUBLIC_DECISION_LOG_CONTRACT to this value.");
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
