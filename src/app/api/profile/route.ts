import { NextRequest, NextResponse } from "next/server";
import { ethers } from "ethers";
import { createServiceClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/supabase/require-user";

export async function GET() {
  try {
    const { user, unauthorizedResponse } = await requireUser();
    if (!user) {
      return unauthorizedResponse;
    }

    const supabase = createServiceClient();
    const { data, error } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", user.id)
      .maybeSingle();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ profile: data ?? null });
  } catch (error) {
    console.error("GET /api/profile error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

export async function PUT(request: NextRequest) {
  try {
    const { user, unauthorizedResponse } = await requireUser();
    if (!user) {
      return unauthorizedResponse;
    }

    const body = await request.json();
    const hasWallet = Object.prototype.hasOwnProperty.call(body, "wallet_address");
    const hasPassport = Object.prototype.hasOwnProperty.call(
      body,
      "kite_passport_agent_id"
    );

    const walletAddress =
      typeof body.wallet_address === "string"
        ? body.wallet_address
        : body.wallet_address === null
          ? null
          : undefined;
    const kitePassportAgentId =
      typeof body.kite_passport_agent_id === "string"
        ? body.kite_passport_agent_id
        : body.kite_passport_agent_id === null
          ? null
          : undefined;

    if (walletAddress && !ethers.isAddress(walletAddress)) {
      return NextResponse.json(
        { error: "wallet_address must be a valid EVM address" },
        { status: 400 }
      );
    }

    const supabase = createServiceClient();
    const { data: existing, error: existingError } = await supabase
      .from("profiles")
      .select()
      .eq("id", user.id)
      .maybeSingle();

    if (existingError) {
      return NextResponse.json({ error: existingError.message }, { status: 500 });
    }

    if (!existing) {
      const { data, error } = await supabase
        .from("profiles")
        .insert({
          id: user.id,
          wallet_address: hasWallet ? walletAddress?.toLowerCase() ?? null : null,
          kite_passport_agent_id: hasPassport ? kitePassportAgentId ?? null : null,
        })
        .select()
        .single();

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
      }

      return NextResponse.json({ profile: data });
    }

    const updateData: Record<string, string | null> = {};
    if (hasWallet) {
      updateData.wallet_address = walletAddress?.toLowerCase() ?? null;
    }
    if (hasPassport) {
      updateData.kite_passport_agent_id = kitePassportAgentId ?? null;
    }

    if (Object.keys(updateData).length === 0) {
      return NextResponse.json({ profile: existing });
    }

    const { data, error } = await supabase
      .from("profiles")
      .update(updateData)
      .eq("id", user.id)
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ profile: data });
  } catch (error) {
    console.error("PUT /api/profile error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

