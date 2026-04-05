import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/supabase/require-user";
import { getAgentEngine } from "@/lib/agent-engine";
import type { Agent } from "@/types/database";

interface RouteContext {
  params: Promise<{ id: string }>;
}

type SnapshotRow = {
  total_value_usd: number | null;
  snapshot_at: string;
};

export async function GET(_request: NextRequest, context: RouteContext) {
  try {
    const { user, unauthorizedResponse } = await requireUser();
    if (!user) {
      return unauthorizedResponse;
    }

    const { id } = await context.params;
    const supabase = createServiceClient();

    const { data: agentData, error: agentError } = await supabase
      .from("agents")
      .select("*")
      .eq("id", id)
      .eq("user_id", user.id)
      .single();
    const agent = agentData as Agent | null;

    if (agentError || !agent) {
      return NextResponse.json({ error: "Agent not found" }, { status: 404 });
    }

    const { data: snapshotsData, error: snapshotsError } = await supabase
      .from("portfolio_snapshots")
      .select("total_value_usd, snapshot_at")
      .eq("agent_id", id)
      .order("snapshot_at", { ascending: true })
      .limit(300);
    const snapshots = (snapshotsData ?? []) as SnapshotRow[];

    let points = snapshots
      .map((row) => ({
        snapshot_at: row.snapshot_at,
        total_value_usd: Number(row.total_value_usd ?? 0),
      }))
      .filter((row) => Number.isFinite(row.total_value_usd));

    if (points.length === 0) {
      const engine = getAgentEngine();
      const current = await engine.getPortfolioState(agent);
      points = [
        {
          snapshot_at: new Date().toISOString(),
          total_value_usd: Number(current.totalValueUsd ?? 0),
        },
      ];
    }

    const first = points[0]?.total_value_usd ?? 0;
    const latest = points[points.length - 1]?.total_value_usd ?? 0;
    const pnlUsd = latest - first;
    const pnlPct = first > 0 ? (pnlUsd / first) * 100 : 0;

    if (snapshotsError) {
      return NextResponse.json({ error: snapshotsError.message }, { status: 500 });
    }

    return NextResponse.json({
      points,
      metrics: {
        first_value_usd: first,
        latest_value_usd: latest,
        pnl_usd: pnlUsd,
        pnl_pct: pnlPct,
      },
    });
  } catch (error) {
    console.error("GET /api/agents/[id]/performance error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
