import { NextRequest, NextResponse } from "next/server";
import { ethers } from "ethers";
import { createServiceClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/supabase/require-user";
import { isDemoNoAuthMode } from "@/lib/supabase/demo-mode";
import { createKiteAASdk } from "@/lib/kite-aa";
import { decryptAgentSignerPrivateKey } from "@/lib/agent-signer";

interface RouteContext {
  params: Promise<{ id: string }>;
}

type WithdrawRequestBody = {
  kind?: "native" | "erc20";
  amount?: string;
  recipient?: string;
  tokenAddress?: string;
  decimals?: number;
};

function toObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function resolveAgentSignerCredentials(config: unknown): {
  ownerSignerAddress: string;
  privateKey: string;
} | null {
  const cfg = toObject(config);
  const ownerSignerAddress =
    typeof cfg.agent_signer_address === "string" ? cfg.agent_signer_address : null;
  if (!ownerSignerAddress || !ethers.isAddress(ownerSignerAddress)) {
    return null;
  }

  const encryptedPrivateKey =
    typeof cfg.agent_signer_private_key_enc === "string"
      ? cfg.agent_signer_private_key_enc
      : null;
  const encryption =
    typeof cfg.agent_signer_key_encryption === "string"
      ? cfg.agent_signer_key_encryption
      : "none";

  const privateKey = decryptAgentSignerPrivateKey({
    encryptedPrivateKey,
    encryption,
  });
  if (!privateKey) {
    return null;
  }

  return { ownerSignerAddress, privateKey };
}

function resolveTxHash(status: unknown): string | null {
  if (!status || typeof status !== "object") {
    return null;
  }

  const row = status as {
    transactionHash?: unknown;
    receipt?: {
      receipt?: {
        transactionHash?: unknown;
      };
    };
  };

  if (typeof row.transactionHash === "string") {
    return row.transactionHash;
  }
  if (typeof row.receipt?.receipt?.transactionHash === "string") {
    return row.receipt.receipt.transactionHash;
  }
  return null;
}

export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const demoNoAuth = isDemoNoAuthMode();
    const { user, unauthorizedResponse } = await requireUser();
    if (!user) {
      return unauthorizedResponse;
    }

    const { id } = await context.params;
    const body = (await request.json()) as WithdrawRequestBody;

    const kind = body.kind === "erc20" ? "erc20" : "native";
    const amount = typeof body.amount === "string" ? body.amount.trim() : "";
    const recipient = typeof body.recipient === "string" ? body.recipient.trim() : "";

    if (!amount || !Number.isFinite(Number.parseFloat(amount)) || Number.parseFloat(amount) <= 0) {
      return NextResponse.json({ error: "Amount must be a positive number." }, { status: 400 });
    }

    if (!recipient || !ethers.isAddress(recipient)) {
      return NextResponse.json({ error: "Recipient must be a valid EVM address." }, { status: 400 });
    }

    const supabase = createServiceClient();

    let agentQuery = supabase
      .from("agents")
      .select("*")
      .eq("id", id);

    if (!demoNoAuth) {
      agentQuery = agentQuery.eq("user_id", user.id);
    }

    const { data: agent, error: agentError } = await agentQuery.single();

    if (agentError || !agent) {
      return NextResponse.json({ error: "Agent not found." }, { status: 404 });
    }

    const credentials = resolveAgentSignerCredentials(agent.config);
    if (!credentials) {
      return NextResponse.json(
        { error: "Agent signer credentials unavailable. Recreate this agent in the latest flow." },
        { status: 400 }
      );
    }

    const signer = new ethers.Wallet(credentials.privateKey);
    const signFunction = async (userOpHash: string) =>
      signer.signMessage(ethers.getBytes(userOpHash));

    const sdk = createKiteAASdk();

    let requestData:
      | { target: string; value: bigint; callData: string }
      | null = null;
    let description = "";

    if (kind === "native") {
      requestData = {
        target: recipient,
        value: ethers.parseEther(amount),
        callData: "0x",
      };
      description = `Withdraw ${amount} KITE from agent vault to ${recipient}`;
    } else {
      const tokenAddress =
        typeof body.tokenAddress === "string" ? body.tokenAddress.trim() : "";
      if (!tokenAddress || !ethers.isAddress(tokenAddress)) {
        return NextResponse.json(
          { error: "tokenAddress must be a valid ERC-20 contract address." },
          { status: 400 }
        );
      }

      const decimals =
        typeof body.decimals === "number"
          ? body.decimals
          : Number.parseInt(String(body.decimals ?? ""), 10);
      if (!Number.isFinite(decimals) || decimals < 0 || decimals > 30) {
        return NextResponse.json(
          { error: "Token decimals must be between 0 and 30." },
          { status: 400 }
        );
      }

      const erc20Iface = new ethers.Interface([
        "function transfer(address to, uint256 amount) returns (bool)",
      ]);
      const callData = erc20Iface.encodeFunctionData("transfer", [
        recipient,
        ethers.parseUnits(amount, decimals),
      ]);

      requestData = {
        target: tokenAddress,
        value: BigInt(0),
        callData,
      };
      description = `Withdraw ${amount} ERC-20 tokens from agent vault to ${recipient}`;
    }

    const result = await sdk.sendUserOperationAndWait(
      credentials.ownerSignerAddress,
      requestData,
      signFunction
    );

    const txHash = resolveTxHash(result.status);
    const statusRaw =
      result.status && typeof result.status === "object" && "status" in result.status
        ? String((result.status as { status?: unknown }).status ?? "")
        : "";
    const logStatus =
      statusRaw === "failed" || statusRaw === "reverted"
        ? "failed"
        : txHash
          ? "success"
          : "executing";

    const { error: logError } = await supabase.from("execution_logs").insert({
      agent_id: agent.id,
      action_type: "withdraw",
      description,
      input_data: {
        kind,
        amount,
        recipient,
        tokenAddress: kind === "erc20" ? body.tokenAddress ?? null : null,
      },
      decision: {
        mode: "agent_vault_withdrawal",
        userOpHash: result.userOpHash,
        userOpStatus: statusRaw || null,
      },
      tx_hash: txHash,
      status: logStatus,
    });

    if (logError) {
      console.error("Failed to insert withdrawal execution log:", logError.message);
    }

    return NextResponse.json({
      success: true,
      userOpHash: result.userOpHash,
      txHash,
      status: statusRaw || null,
    });
  } catch (error) {
    console.error("POST /api/agents/[id]/withdraw error:", error);
    return NextResponse.json(
      { error: "Failed to submit vault withdrawal." },
      { status: 500 }
    );
  }
}
