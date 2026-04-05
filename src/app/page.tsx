import Link from "next/link";
import { Bot, Shield, Zap } from "lucide-react";

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

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-gradient-to-b from-white via-indigo-50/30 to-white text-gray-900">
      {/* Hero */}
      <div className="flex flex-col items-center justify-center px-6 pt-32 pb-20">
        <div className="flex items-center gap-3 mb-6">
          <div className="h-12 w-12 rounded-xl bg-indigo-600 flex items-center justify-center">
            <Zap className="h-6 w-6 text-white" />
          </div>
          <h1 className="text-5xl font-bold tracking-tight text-gray-900">KiteSwarm</h1>
        </div>
        <p className="text-xl text-gray-500 text-center max-w-xl mb-10">
          Autonomous Multi-Agent DeFi Portfolio Manager on Kite AI
        </p>
        <Link
          href="/dashboard"
          className="inline-flex items-center justify-center h-12 px-8 rounded-lg bg-indigo-600 hover:bg-indigo-700 transition-colors text-white font-medium text-lg shadow-lg shadow-indigo-200"
        >
          Launch App
        </Link>
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
      </div>
    </div>
  );
}
