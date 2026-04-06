import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/supabase/require-user";
import { isDemoNoAuthMode } from "@/lib/supabase/demo-mode";
import { getAgentEngine } from "@/lib/agent-engine";
import type { Agent } from "@/types/database";

type AgentRow = {
  id: string;
  name: string;
  status: string;
  aa_wallet_address: string | null;
  vault_proxy_address: string | null;
  config: unknown;
  spending_rules: unknown;
  created_at: string;
  updated_at: string;
  description: string | null;
  strategy_id: string | null;
  user_id: string | null;
};

type SnapshotRow = {
  agent_id: string;
  total_value_usd: number | null;
  holdings?: unknown;
  snapshot_at: string | null;
};

export async function GET() {
  try {
    const demoNoAuth = isDemoNoAuthMode();
    const { user, unauthorizedResponse } = await requireUser();
    if (!user) {
      return unauthorizedResponse;
    }

    const supabase = createServiceClient();
    const engine = getAgentEngine();

    let agentsQuery = supabase
      .from("agents")
      .select("*");

    if (!demoNoAuth) {
      agentsQuery = agentsQuery.eq("user_id", user.id);
    }

    const { data: agents, error: agentsError } = await agentsQuery;

    if (agentsError) {
      return NextResponse.json({ error: agentsError.message }, { status: 500 });
    }

    const agentRows = (agents ?? []) as AgentRow[];
    if (agentRows.length === 0) {
      return NextResponse.json({
        total_value_usd: 0,
        agents: [],
        snapshots: [],
      });
    }

    const agentIds = agentRows.map((agent) => agent.id);

    const { data: snapshots, error: snapshotError } = await supabase
      .from("portfolio_snapshots")
      .select("*")
      .in("agent_id", agentIds)
      .order("snapshot_at", { ascending: false });

    if (snapshotError) {
      return NextResponse.json({ error: snapshotError.message }, { status: 500 });
    }

    const snapshotRows = (snapshots ?? []) as SnapshotRow[];
    const latestByAgent = new Map<string, SnapshotRow>();
    for (const snap of snapshotRows) {
      if (!latestByAgent.has(snap.agent_id)) {
        latestByAgent.set(snap.agent_id, snap);
      }
    }

    const latestSnapshots = Array.from(latestByAgent.values());
    const activeAgentIds = agentRows
      .filter((row) => row.status === "active")
      .map((row) => row.id);

    let seriesByAgent: Record<
      string,
      Array<{
        snapshot_at: string;
        total_value_usd: number;
      }>
    > = {};

    if (activeAgentIds.length > 0) {
      const { data: historyData, error: historyError } = await supabase
        .from("portfolio_snapshots")
        .select("agent_id,total_value_usd,snapshot_at")
        .in("agent_id", activeAgentIds)
        .order("snapshot_at", { ascending: true })
        .limit(1500);

      if (historyError) {
        return NextResponse.json({ error: historyError.message }, { status: 500 });
      }

      const historyRows = (historyData ?? []) as SnapshotRow[];
      const grouped: Record<
        string,
        Array<{
          snapshot_at: string;
          total_value_usd: number;
        }>
      > = {};

      for (const row of historyRows) {
        if (!row.snapshot_at) {
          continue;
        }
        if (!grouped[row.agent_id]) {
          grouped[row.agent_id] = [];
        }
        grouped[row.agent_id].push({
          snapshot_at: row.snapshot_at,
          total_value_usd: Number(row.total_value_usd ?? 0),
        });
      }

      seriesByAgent = grouped;
    }

    const agentSummaries = await Promise.all(
      agentRows.map(async (agent) => {
        const snapshot = latestByAgent.get(agent.id) ?? null;
        if (snapshot) {
          return {
            id: agent.id,
            name: agent.name,
            status: agent.status,
            total_value_usd: snapshot.total_value_usd ?? 0,
            holdings: snapshot.holdings ?? null,
            last_snapshot_at: snapshot.snapshot_at ?? null,
          };
        }

        const vaultAddress = agent.aa_wallet_address ?? agent.vault_proxy_address;
        if (!vaultAddress) {
          return {
            id: agent.id,
            name: agent.name,
            status: agent.status,
            total_value_usd: 0,
            holdings: null,
            last_snapshot_at: null,
          };
        }

        try {
          const portfolio = await engine.getPortfolioState(agent as Agent);
          return {
            id: agent.id,
            name: agent.name,
            status: agent.status,
            total_value_usd: portfolio.totalValueUsd,
            holdings: portfolio.holdings.map((holding) => ({
              asset: holding.asset,
              chain: holding.chain,
              amount: holding.amount,
              value_usd: holding.valueUsd,
            })),
            last_snapshot_at: null,
          };
        } catch {
          return {
            id: agent.id,
            name: agent.name,
            status: agent.status,
            total_value_usd: 0,
            holdings: null,
            last_snapshot_at: null,
          };
        }
      })
    );

    const totalValueUsd = agentSummaries.reduce(
      (sum, summary) => sum + (summary.total_value_usd ?? 0),
      0
    );

    return NextResponse.json({
      total_value_usd: totalValueUsd,
      agents: agentSummaries,
      snapshots: latestSnapshots,
      series_by_agent: seriesByAgent,
    });
  } catch (err) {
    console.error("GET /api/portfolio error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
