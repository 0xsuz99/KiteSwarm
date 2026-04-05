import { getAgentEngine } from "@/lib/agent-engine";
import { createServiceClient } from "@/lib/supabase/server";
import type { Agent, ExecutionLog, Json, Strategy } from "@/types/database";

export type AgentExecutionTrigger = "manual" | "auto";

type ExecuteAgentStrategyParams = {
  agent: Agent;
  strategy: Strategy;
  triggeredBy: string;
  trigger: AgentExecutionTrigger;
};

type ExecuteAgentStrategyResult = {
  ok: true;
  executionLogId: string;
  actions: Array<{
    type: string;
    description: string;
    params: Record<string, unknown>;
  }>;
  txHashes: string[];
  attestationHash: string | null;
} | {
  ok: false;
  executionLogId: string | null;
  error: string;
};

export async function executeAgentStrategy(
  params: ExecuteAgentStrategyParams
): Promise<ExecuteAgentStrategyResult> {
  const { agent, strategy, triggeredBy, trigger } = params;
  const supabase = createServiceClient();

  const { data: logEntryData, error: logInsertError } = await supabase
    .from("execution_logs")
    .insert({
      agent_id: agent.id,
      action_type: "strategy_execution",
      description: `Executing strategy (${trigger}): ${strategy.name}`,
      status: "pending",
      input_data: {
        strategy_id: strategy.id,
        strategy_type: strategy.type,
        triggered_by: triggeredBy,
        trigger,
      },
    })
    .select()
    .single();
  const logEntry = logEntryData as ExecutionLog | null;

  if (logInsertError || !logEntry) {
    return {
      ok: false,
      executionLogId: null,
      error: "Failed to create execution log",
    };
  }

  try {
    await supabase
      .from("execution_logs")
      .update({ status: "executing" })
      .eq("id", logEntry.id);

    const engine = getAgentEngine();
    const result = await engine.executeStrategy(agent, strategy);

    const latestPortfolio = await engine.getPortfolioState(agent);
    const snapshotHoldings = latestPortfolio.holdings.map((holding) => ({
      asset: holding.asset,
      chain: holding.chain,
      amount: holding.amount,
      value_usd: holding.valueUsd,
    }));

    const { error: snapshotInsertError } = await supabase
      .from("portfolio_snapshots")
      .insert({
        agent_id: agent.id,
        total_value_usd: latestPortfolio.totalValueUsd,
        holdings: JSON.parse(JSON.stringify(snapshotHoldings)) as Json,
      });

    if (snapshotInsertError) {
      console.error(
        "Failed to insert portfolio snapshot:",
        snapshotInsertError.message
      );
    }

    await supabase
      .from("execution_logs")
      .update({
        status: "success",
        decision: JSON.parse(
          JSON.stringify({
            actions: result.actions,
            txHashes: result.txHashes,
            trigger,
          })
        ) as Json,
        tx_hash: result.txHashes[0] ?? null,
        attestation_tx_hash: result.attestationHash,
      })
      .eq("id", logEntry.id);

    const perActionLogs = result.actions.map((action, index) => ({
      agent_id: agent.id,
      action_type: action.type,
      description: action.description,
      input_data: JSON.parse(
        JSON.stringify({
          strategy_id: strategy.id,
          strategy_type: strategy.type,
          source_execution_log_id: logEntry.id,
          trigger,
          triggered_by: triggeredBy,
        })
      ) as Json,
      decision: JSON.parse(JSON.stringify(action)) as Json,
      tx_hash: result.txHashes[index] ?? null,
      attestation_tx_hash: result.txHashes[index] ?? result.attestationHash,
      status: "success" as const,
    }));

    if (perActionLogs.length > 0) {
      await supabase.from("execution_logs").insert(perActionLogs);
    }

    await supabase
      .from("agents")
      .update({ updated_at: new Date().toISOString() })
      .eq("id", agent.id);

    return {
      ok: true,
      executionLogId: logEntry.id,
      actions: result.actions,
      txHashes: result.txHashes,
      attestationHash: result.attestationHash,
    };
  } catch (execError) {
    const message =
      execError instanceof Error ? execError.message : "Unknown execution error";

    await supabase
      .from("execution_logs")
      .update({
        status: "failed",
        decision: { error: message, trigger },
      })
      .eq("id", logEntry.id);

    await supabase
      .from("agents")
      .update({ status: "error", updated_at: new Date().toISOString() })
      .eq("id", agent.id);

    return {
      ok: false,
      executionLogId: logEntry.id,
      error: message,
    };
  }
}
