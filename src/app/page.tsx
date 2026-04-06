import { Bot, Shield, Zap } from "lucide-react";
import { LaunchAppButton } from "@/components/landing/launch-app-button";

const features = [
  {
    icon: Bot,
    title: "Multi-Agent Swarm",
    description:
      "Deploy autonomous AI agents that collaborate to manage your DeFi portfolio across multiple protocols and chains.",
  },
  {
    icon: Shield,
    title: "On-Chain Attestation",
    description:
      "Every AI decision is recorded on-chain with cryptographic attestations, ensuring full transparency and auditability.",
  },
  {
    icon: Zap,
    title: "Cross-Chain DeFi",
    description:
      "Seamlessly execute strategies across multiple chains and protocols. Your agents find the best opportunities everywhere.",
  },
];

const flow = [
  {
    title: "1. Connect & Create",
    description:
      "Connect your wallet, create an agent, and configure strategy plus spending constraints.",
  },
  {
    title: "2. Fund & Activate",
    description:
      "Fund the agent vault with KITE or tracked ERC-20 tokens, then activate autonomous execution.",
  },
  {
    title: "3. Verify & Withdraw",
    description:
      "Monitor live logs, verify on-chain attestations, and withdraw funds back to your wallet.",
  },
];

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-950 via-slate-900 to-slate-950 text-gray-900">
      {/* Hero */}
      <div className="flex flex-col items-center justify-center px-6 pt-32 pb-20">
        <div className="flex items-center gap-3 mb-6">
          <div className="h-12 w-12 rounded-xl bg-indigo-600 flex items-center justify-center">
            <Zap className="h-6 w-6 text-white" />
          </div>
          <h1 className="text-5xl font-bold tracking-tight text-gray-900">KiteSwarm</h1>
        </div>
        <p className="text-xl text-gray-700 text-center max-w-xl mb-10">
          Autonomous Multi-Agent DeFi Portfolio Manager on Kite AI
        </p>
        <LaunchAppButton />
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <span className="rounded-full border border-indigo-200 bg-indigo-50 px-3 py-1 text-xs text-indigo-600">
            Kite Testnet
          </span>
          <span className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs text-emerald-600">
            On-Chain Attestations
          </span>
          <span className="rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs text-amber-600">
            Autonomous Agents
          </span>
        </div>
      </div>

      {/* Features */}
      <div className="max-w-5xl mx-auto px-6 pb-32">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {features.map((feature) => (
            <div
              key={feature.title}
              className="rounded-xl border border-gray-200 bg-white p-6 hover:border-indigo-300 hover:shadow-lg transition-all"
            >
              <div className="h-10 w-10 rounded-lg bg-indigo-50 flex items-center justify-center mb-4">
                <feature.icon className="h-5 w-5 text-indigo-600" />
              </div>
              <h3 className="text-lg font-semibold text-gray-900 mb-2">
                {feature.title}
              </h3>
              <p className="text-sm text-gray-500 leading-relaxed">
                {feature.description}
              </p>
            </div>
          ))}
        </div>

        <div className="mt-10 rounded-xl border border-gray-200 bg-white p-6">
          <h2 className="text-lg font-semibold text-gray-900">How KiteSwarm Works</h2>
          <p className="mt-1 text-sm text-gray-500">
            A simple flow built for fast, judge-friendly demos.
          </p>
          <div className="mt-5 grid grid-cols-1 md:grid-cols-3 gap-4">
            {flow.map((step) => (
              <div key={step.title} className="rounded-lg border border-gray-200 bg-gray-50 p-4">
                <p className="text-sm font-semibold text-gray-900">{step.title}</p>
                <p className="mt-2 text-xs leading-relaxed text-gray-500">{step.description}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
