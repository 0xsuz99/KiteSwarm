import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/supabase/require-user";
import { demoActorId, isDemoNoAuthMode } from "@/lib/supabase/demo-mode";
import { executeAgentStrategy } from "@/lib/execute-agent-strategy";
import type { Agent, ExecutionLog, Strategy } from "@/types/database";

const DEFAULT_MIN_INTERVAL_SECONDS = 90;
const DEFAULT_MAX_AGENTS_PER_TICK = 6;
const DEFAULT_STRATEGY_INTERVAL_SECONDS = 3600;
const FAST_DEMO_MIN_INTERVAL_SECONDS = 8;
const FAST_DEMO_MAX_AGENTS_PER_TICK = 20;
const FAST_DEMO_STRATEGY_INTERVAL_SECONDS = 20;

function envNumber(name: string, fallback: number) {
  const raw = process.env[name];
  const parsed = raw ? Number.parseInt(raw, 10) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : fallback;
}

function toObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function toFiniteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number.parseFloat(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return null;
}

function resolveStrategyIntervalSeconds(strategy: Strategy, fastMode: boolean): number {
  if (fastMode) {
    return FAST_DEMO_STRATEGY_INTERVAL_SECONDS;
  }

  const rules = toObject(strategy.rules);
  const trigger =
    typeof rules.trigger === "string" ? rules.trigger.toLowerCase() : "interval";

  if (trigger !== "interval" && trigger !== "signal") {
    return DEFAULT_STRATEGY_INTERVAL_SECONDS;
  }

  const intervalHours = toFiniteNumber(
    rules.interval_hours ?? rules.check_interval_hours
  );
  if (intervalHours && intervalHours > 0) {
    return Math.max(Math.floor(intervalHours * 3600), 60);
  }

  switch (strategy.type) {
    case "dca":
      return 12 * 3600;
    case "rebalance":
      return 24 * 3600;
    case "yield_optimize":
      return 8 * 3600;
    case "momentum":
      return 4 * 3600;
    default:
      return DEFAULT_STRATEGY_INTERVAL_SECONDS;
  }
}

export async function POST(request: Request) {
  try {
    const demoNoAuth = isDemoNoAuthMode();
    const { user, unauthorizedResponse } = await requireUser();
    if (!user) {
      return unauthorizedResponse;
    }

    const url = new URL(request.url);
    const fastMode = url.searchParams.get("mode") === "fast";

    const minIntervalSeconds = fastMode
      ? FAST_DEMO_MIN_INTERVAL_SECONDS
      : envNumber(
          "AGENT_AUTO_MIN_INTERVAL_SECONDS",
          DEFAULT_MIN_INTERVAL_SECONDS
        );
    const maxAgentsPerTick = fastMode
      ? FAST_DEMO_MAX_AGENTS_PER_TICK
      : envNumber(
          "AGENT_AUTO_MAX_AGENTS_PER_TICK",
          DEFAULT_MAX_AGENTS_PER_TICK
        );

    const supabase = createServiceClient();

    let activeAgentsQuery = supabase
      .from("agents")
      .select("*")
      .eq("status", "active")
      .not("strategy_id", "is", null)
      .order("updated_at", { ascending: true })
      .limit(maxAgentsPerTick);

    if (!demoNoAuth) {
      activeAgentsQuery = activeAgentsQuery.eq("user_id", user.id);
    }

    const { data: activeAgentData, error: activeAgentError } = await activeAgentsQuery;
    const activeAgents = (activeAgentData ?? []) as Agent[];

    if (activeAgentError) {
      return NextResponse.json(
        { error: activeAgentError.message },
        { status: 500 }
      );
    }

    if (activeAgents.length === 0) {
      return NextResponse.json({
        processed: 0,
        executed: 0,
        failed: 0,
        skipped: 0,
        results: [],
      });
    }

    const now = Date.now();
    const minIntervalMs = Math.max(minIntervalSeconds, 5) * 1000;
    const results: Array<{
      agentId: string;
      agentName: string;
      status: "executed" | "skipped" | "failed";
      reason?: string;
      executionLogId?: string;
    }> = [];

    for (const agent of activeAgents) {
      const { data: latestLogData } = await supabase
        .from("execution_logs")
        .select("id, created_at, status")
        .eq("agent_id", agent.id)
        .eq("action_type", "strategy_execution")
        .order("created_at", { ascending: false })
        .limit(1);
      const latestLog = (latestLogData?.[0] ?? null) as
        | Pick<ExecutionLog, "id" | "created_at" | "status">
        | null;

      if (latestLog?.status === "executing" || latestLog?.status === "pending") {
        results.push({
          agentId: agent.id,
          agentName: agent.name,
          status: "skipped",
          reason: "Previous cycle still running",
        });
        continue;
      }

      if (latestLog) {
        const elapsed = now - new Date(latestLog.created_at).getTime();
        if (elapsed < minIntervalMs) {
          results.push({
            agentId: agent.id,
            agentName: agent.name,
            status: "skipped",
            reason: `Throttled (${Math.ceil((minIntervalMs - elapsed) / 1000)}s remaining)`,
          });
          continue;
        }
      }

      const { data: strategyData, error: strategyError } = await supabase
        .from("strategies")
        .select("*")
        .eq("id", agent.strategy_id as string)
        .single();
      const strategy = strategyData as Strategy | null;

      if (strategyError || !strategy) {
        results.push({
          agentId: agent.id,
          agentName: agent.name,
          status: "failed",
          reason: "Strategy not found",
        });
        continue;
      }

      if (latestLog) {
        const elapsed = now - new Date(latestLog.created_at).getTime();
        const strategyIntervalMs =
          resolveStrategyIntervalSeconds(strategy, fastMode) * 1000;
        if (elapsed < strategyIntervalMs) {
          results.push({
            agentId: agent.id,
            agentName: agent.name,
            status: "skipped",
            reason: `Waiting for strategy interval (${Math.ceil(
              (strategyIntervalMs - elapsed) / 1000
            )}s remaining)`,
          });
          continue;
        }
      }

      const execution = await executeAgentStrategy({
        agent,
        strategy,
        triggeredBy: demoNoAuth ? demoActorId() : user.id,
        trigger: "auto",
      });

      if (!execution.ok) {
        results.push({
          agentId: agent.id,
          agentName: agent.name,
          status: "failed",
          reason: execution.error,
          executionLogId: execution.executionLogId ?? undefined,
        });
        continue;
      }

      results.push({
        agentId: agent.id,
        agentName: agent.name,
        status: "executed",
        executionLogId: execution.executionLogId,
      });
    }

    const executed = results.filter((row) => row.status === "executed").length;
    const failed = results.filter((row) => row.status === "failed").length;
    const skipped = results.filter((row) => row.status === "skipped").length;

    return NextResponse.json({
      processed: results.length,
      executed,
      failed,
      skipped,
      fastMode,
      minIntervalSeconds,
      maxAgentsPerTick,
      results,
    });
  } catch (err) {
    console.error("POST /api/agents/auto-execute error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
