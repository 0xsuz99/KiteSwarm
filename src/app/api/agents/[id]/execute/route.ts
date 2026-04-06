import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/supabase/require-user";
import { demoActorId, isDemoNoAuthMode } from "@/lib/supabase/demo-mode";
import { executeAgentStrategy } from "@/lib/execute-agent-strategy";
import type { Agent, Strategy } from "@/types/database";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function POST(_request: NextRequest, context: RouteContext) {
  try {
    const demoNoAuth = isDemoNoAuthMode();
    const { user, unauthorizedResponse } = await requireUser();
    if (!user) {
      return unauthorizedResponse;
    }

    const { id } = await context.params;
    const supabase = createServiceClient();

    let agentQuery = supabase
      .from("agents")
      .select("*")
      .eq("id", id);

    if (!demoNoAuth) {
      agentQuery = agentQuery.eq("user_id", user.id);
    }

    const { data: agentData, error: agentError } = await agentQuery.single();
    const agent = agentData as Agent | null;

    if (agentError || !agent) {
      return NextResponse.json({ error: "Agent not found" }, { status: 404 });
    }

    if (agent.status !== "active") {
      return NextResponse.json(
        { error: `Agent is not active. Current status: ${agent.status}` },
        { status: 400 }
      );
    }

    if (!agent.strategy_id) {
      return NextResponse.json(
        { error: "Agent has no strategy assigned" },
        { status: 400 }
      );
    }

    const { data: strategyData, error: strategyError } = await supabase
      .from("strategies")
      .select("*")
      .eq("id", agent.strategy_id)
      .single();
    const strategy = strategyData as Strategy | null;

    if (strategyError || !strategy) {
      return NextResponse.json({ error: "Strategy not found" }, { status: 404 });
    }

    const result = await executeAgentStrategy({
      agent,
      strategy,
      triggeredBy: demoNoAuth ? demoActorId() : user.id,
      trigger: "manual",
    });

    if (!result.ok) {
      return NextResponse.json(
        { error: "Execution failed", details: result.error },
        { status: 500 }
      );
    }

    return NextResponse.json({
      execution_log_id: result.executionLogId,
      actions: result.actions,
      txHashes: result.txHashes,
      attestationHash: result.attestationHash,
    });
  } catch (err) {
    console.error("POST /api/agents/[id]/execute error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
