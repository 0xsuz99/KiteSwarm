import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/supabase/require-user";
import { isDemoNoAuthMode } from "@/lib/supabase/demo-mode";

type ActivityRow = {
  id: string;
  created_at: string;
  action_type: string;
  description: string | null;
  status: string;
  tx_hash: string | null;
  attestation_tx_hash: string | null;
  agent: {
    id: string;
    name: string;
  } | null;
};

type ActivityJoinRow = {
  id: string;
  created_at: string;
  action_type: string;
  description: string | null;
  status: string;
  tx_hash: string | null;
  attestation_tx_hash: string | null;
  agents:
    | {
        id: string;
        name: string;
      }
    | Array<{
        id: string;
        name: string;
      }>
    | null;
};

export async function GET(request: Request) {
  try {
    const demoNoAuth = isDemoNoAuthMode();
    const { user, unauthorizedResponse } = await requireUser();
    if (!user) {
      return unauthorizedResponse;
    }

    const { searchParams } = new URL(request.url);
    const page = Math.max(Number.parseInt(searchParams.get("page") ?? "1", 10), 1);
    const pageSizeRaw = Number.parseInt(searchParams.get("pageSize") ?? "25", 10);
    const pageSize = Math.min(Math.max(pageSizeRaw, 1), 100);
    const offset = (page - 1) * pageSize;

    const supabase = createServiceClient();

    let agentIds: string[] = [];

    if (demoNoAuth) {
      const { data: demoAgents, error: demoAgentError } = await supabase
        .from("agents")
        .select("id");
      if (demoAgentError) {
        return NextResponse.json({ error: demoAgentError.message }, { status: 500 });
      }
      agentIds = (demoAgents ?? []).map((agent) => agent.id);
    } else {
      const { data: agents, error: agentError } = await supabase
        .from("agents")
        .select("id")
        .eq("user_id", user.id);

      if (agentError) {
        return NextResponse.json({ error: agentError.message }, { status: 500 });
      }
      agentIds = (agents ?? []).map((agent) => agent.id);
    }

    if (agentIds.length === 0) {
      return NextResponse.json({ activity: [] });
    }

    const { data, error } = await supabase
      .from("execution_logs")
      .select("id, created_at, action_type, description, status, tx_hash, attestation_tx_hash, agents(id, name)")
      .in("agent_id", agentIds)
      .order("created_at", { ascending: false })
      .range(offset, offset + pageSize);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const activity = ((data ?? []) as ActivityJoinRow[]).map((row) => {
      const agentData = Array.isArray(row.agents) ? row.agents[0] : row.agents;
      return {
        id: row.id,
        created_at: row.created_at,
        action_type: row.action_type,
        description: row.description,
        status: row.status,
        tx_hash: row.tx_hash,
        attestation_tx_hash: row.attestation_tx_hash,
        agent: agentData
          ? {
              id: agentData.id,
              name: agentData.name,
            }
          : null,
      };
    }) as ActivityRow[];

    const hasMore = activity.length > pageSize;
    const sliced = hasMore ? activity.slice(0, pageSize) : activity;

    return NextResponse.json({
      activity: sliced,
      pagination: {
        page,
        pageSize,
        hasMore,
      },
    });
  } catch (error) {
    console.error("GET /api/activity error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
