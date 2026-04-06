import { NextRequest, NextResponse } from "next/server";
import { ethers } from "ethers";
import { createServiceClient } from "@/lib/supabase/server";
import { getAgentAAWalletAddress } from "@/lib/kite-aa";
import { generateAgentSigner } from "@/lib/agent-signer";
import { requireUser } from "@/lib/supabase/require-user";
import { DECISION_LOG_ABI } from "@/lib/contracts/decision-log-abi";
import { demoActorId, isDemoNoAuthMode } from "@/lib/supabase/demo-mode";
import type { AgentInsert } from "@/types/database";

function toConfigObject(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

async function attestAgentCreationOnChain(params: {
  userId: string;
  agentId: string;
  aaWalletAddress: string | null;
  payload: Record<string, unknown>;
}) {
  const masterKey = process.env.AGENT_MASTER_PRIVATE_KEY;
  const decisionLog = process.env.DECISION_LOG_CONTRACT;

  if (!masterKey || !decisionLog) {
    return {
      txHash: null as string | null,
      error:
        "Missing AGENT_MASTER_PRIVATE_KEY or DECISION_LOG_CONTRACT; skipped on-chain creation attestation.",
    };
  }

  try {
    const provider = new ethers.JsonRpcProvider(
      process.env.KITE_RPC_URL ??
        process.env.NEXT_PUBLIC_KITE_RPC_URL ??
        "https://rpc-testnet.gokite.ai"
    );
    const signer = new ethers.Wallet(masterKey, provider);
    const contract = new ethers.Contract(decisionLog, DECISION_LOG_ABI, signer);

    const decisionHash = ethers.keccak256(
      ethers.toUtf8Bytes(
        JSON.stringify({
          ...params.payload,
          agent_id: params.agentId,
          user_id: params.userId,
          aa_wallet_address: params.aaWalletAddress,
          event: "agent_create",
          timestamp: Date.now(),
        })
      )
    );

    const tx = await contract.logDecision(decisionHash, "agent_create", "");
    const receipt = await tx.wait();

    return { txHash: receipt?.hash ?? tx.hash, error: null as string | null };
  } catch (error) {
    return {
      txHash: null,
      error:
        error instanceof Error
          ? error.message
          : "Unknown on-chain attestation error",
    };
  }
}

export async function GET() {
  try {
    const demoNoAuth = isDemoNoAuthMode();
    const { user, unauthorizedResponse } = await requireUser();
    if (!user) {
      return unauthorizedResponse;
    }

    const supabase = createServiceClient();

    let query = supabase
      .from("agents")
      .select("*, strategies(*)")
      .order("created_at", { ascending: false });
    if (!demoNoAuth) {
      query = query.eq("user_id", user.id);
    }

    const { data, error } = await query;

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ agents: data });
  } catch (err) {
    console.error("GET /api/agents error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const demoNoAuth = isDemoNoAuthMode();
    const { user, unauthorizedResponse } = await requireUser();
    if (!user) {
      return unauthorizedResponse;
    }

    const body = await request.json();
    const {
      name,
      description,
      strategy_id,
      config,
      spending_rules,
      owner_signer_address,
    } = body;

    if (!name) {
      return NextResponse.json(
        { error: "Agent name is required" },
        { status: 400 }
      );
    }

    if (owner_signer_address && !ethers.isAddress(owner_signer_address)) {
      return NextResponse.json(
        { error: "owner_signer_address must be a valid EVM address" },
        { status: 400 }
      );
    }

    const agentSigner = generateAgentSigner();
    if (agentSigner.encryption === "none") {
      console.warn(
        "AGENT_SIGNER_ENCRYPTION_KEY not set - storing agent signer private key in plain config for local/dev execution."
      );
    }

    const baseConfig = toConfigObject(config);
    const enrichedConfig = {
      ...baseConfig,
      owner_wallet_address: owner_signer_address ?? null,
      agent_signer_address: agentSigner.address,
      agent_signer_key_encryption: agentSigner.encryption,
      agent_signer_private_key_enc: agentSigner.encryptedPrivateKey,
    };

    const agentData: AgentInsert = {
      user_id: demoNoAuth ? null : user.id,
      name,
      description: description ?? null,
      strategy_id: strategy_id ?? null,
      aa_wallet_address: getAgentAAWalletAddress(agentSigner.address),
      config: enrichedConfig,
      spending_rules: spending_rules ?? {},
      status: "inactive",
    };

    const supabase = createServiceClient();

    const { data, error } = await supabase
      .from("agents")
      .insert(agentData)
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const attestation = await attestAgentCreationOnChain({
      userId: demoNoAuth ? demoActorId() : user.id,
      agentId: data.id,
      aaWalletAddress: data.aa_wallet_address,
      payload: {
        name,
        description: description ?? null,
        strategy_id: strategy_id ?? null,
      },
    });

    const { error: logError } = await supabase.from("execution_logs").insert({
      agent_id: data.id,
      action_type: "agent_create",
      description: attestation.txHash
        ? "Agent created and attested on Kite chain."
        : `Agent created off-chain. ${attestation.error ?? "On-chain attestation unavailable."}`,
      input_data: {
        strategy_id: strategy_id ?? null,
        owner_signer_address: owner_signer_address ?? null,
        agent_signer_address: agentSigner.address,
      },
      decision: {
        event: "agent_create",
        aa_wallet_address: data.aa_wallet_address,
        vault_proxy_address: data.vault_proxy_address,
        agent_signer_address: agentSigner.address,
        agent_signer_key_encryption: agentSigner.encryption,
        attestation_error: attestation.error,
      },
      tx_hash: attestation.txHash,
      attestation_tx_hash: attestation.txHash,
      status: attestation.txHash ? "success" : "failed",
    });

    if (logError) {
      console.error("Failed to insert creation execution log:", logError.message);
    }

    return NextResponse.json(
      { agent: data, onchain_attestation_tx: attestation.txHash },
      { status: 201 }
    );
  } catch (err) {
    console.error("POST /api/agents error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
