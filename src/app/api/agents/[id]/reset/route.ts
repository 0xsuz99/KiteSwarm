import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/supabase/require-user";
import type { Agent } from "@/types/database";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function POST(_request: NextRequest, context: RouteContext) {
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

    const { error: logsError } = await supabase
      .from("execution_logs")
      .delete()
      .eq("agent_id", id);
    if (logsError) {
      return NextResponse.json({ error: logsError.message }, { status: 500 });
    }

    const { error: snapshotError } = await supabase
      .from("portfolio_snapshots")
      .delete()
      .eq("agent_id", id);
    if (snapshotError) {
      return NextResponse.json({ error: snapshotError.message }, { status: 500 });
    }

    const { data: updated, error: updateError } = await supabase
      .from("agents")
      .update({
        status: "inactive",
        updated_at: new Date().toISOString(),
      })
      .eq("id", id)
      .eq("user_id", user.id)
      .select()
      .single();
    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      agent: updated,
      message: "Agent reset complete. Execution history and snapshots were cleared.",
    });
  } catch (error) {
    console.error("POST /api/agents/[id]/reset error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
