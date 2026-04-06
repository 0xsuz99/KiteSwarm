import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/supabase/require-user";
import { isDemoNoAuthMode } from "@/lib/supabase/demo-mode";
import type { Agent } from "@/types/database";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(_request: NextRequest, context: RouteContext) {
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

    const { data, error } = await supabase
      .from("execution_logs")
      .select("*")
      .eq("agent_id", id)
      .order("created_at", { ascending: false })
      .limit(100);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ logs: data ?? [] });
  } catch (error) {
    console.error("GET /api/agents/[id]/logs error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
