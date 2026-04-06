import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/supabase/require-user";
import { isDemoNoAuthMode } from "@/lib/supabase/demo-mode";
import type { StrategyInsert } from "@/types/database";

const DEFAULT_STRATEGY_TEMPLATES: StrategyInsert[] = [
  {
    user_id: null,
    name: "Yield Maximizer",
    description: "Deploy idle stablecoins into yield-bearing pools with safety limits.",
    type: "yield_optimize",
    is_template: true,
    rules: {
      trigger: "interval",
      interval_hours: 8,
      target_protocols: ["lucid", "aave_v3"],
      min_balance_usd: 100,
      max_single_deposit_usd: 500,
      auto_compound: true,
      pools: [
        {
          protocol: "lucid",
          pool: "L-USDC",
          asset: "USDC",
          allocation_pct: 100,
        },
      ],
    },
  },
  {
    user_id: null,
    name: "Core Rebalancer",
    description: "Maintains portfolio weights and periodically rebalances to target allocation.",
    type: "rebalance",
    is_template: true,
    rules: {
      trigger: "interval",
      interval_hours: 24,
      allocations: [
        { asset: "USDC", chain: "kite", target_pct: 50 },
        { asset: "ETH", chain: "kite", target_pct: 25 },
        { asset: "BTC", chain: "kite", target_pct: 25 },
      ],
      rebalance_threshold_pct: 5,
      max_slippage_pct: 1,
    },
  },
  {
    user_id: null,
    name: "Steady DCA",
    description: "Buys target assets at fixed intervals from stablecoin reserves.",
    type: "dca",
    is_template: true,
    rules: {
      trigger: "interval",
      interval_hours: 12,
      spend_asset: "USDC",
      spend_amount_usd: 25,
      buy_asset: "ETH",
      max_slippage_pct: 1,
    },
  },
  {
    user_id: null,
    name: "Trend Rider",
    description: "Follows short-term momentum with conservative stop-loss controls.",
    type: "momentum",
    is_template: true,
    rules: {
      trigger: "signal",
      check_interval_hours: 4,
      lookback_hours: 24,
      assets: ["ETH", "BTC", "USDC"],
      momentum_threshold_pct: 3,
      stop_loss_pct: 10,
    },
  },
];

async function ensureTemplateStrategies() {
  const supabase = createServiceClient();

  const { data: existing, error: existingError } = await supabase
    .from("strategies")
    .select("id")
    .eq("is_template", true)
    .limit(1);

  if (existingError) {
    console.error("Failed checking template strategies:", existingError.message);
    return;
  }

  if ((existing ?? []).length > 0) {
    return;
  }

  const { error: insertError } = await supabase
    .from("strategies")
    .insert(DEFAULT_STRATEGY_TEMPLATES);

  if (insertError) {
    console.error("Failed seeding template strategies:", insertError.message);
  }
}

export async function GET() {
  try {
    const demoNoAuth = isDemoNoAuthMode();
    const { user, unauthorizedResponse } = await requireUser();
    if (!user) {
      return unauthorizedResponse;
    }

    await ensureTemplateStrategies();

    const supabase = createServiceClient();

    let query = supabase
      .from("strategies")
      .select("*")
      .order("is_template", { ascending: false })
      .order("created_at", { ascending: false });

    if (!demoNoAuth) {
      query = query.or(`user_id.eq.${user.id},is_template.eq.true`);
    }

    const { data, error } = await query;

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ strategies: data });
  } catch (err) {
    console.error("GET /api/strategies error:", err);
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
    const { name, description, type, rules, is_template } = body;

    if (!name || !type || !rules) {
      return NextResponse.json(
        { error: "name, type, and rules are required" },
        { status: 400 }
      );
    }

    const validTypes = [
      "rebalance",
      "yield_optimize",
      "dca",
      "momentum",
      "custom",
    ];
    if (!validTypes.includes(type)) {
      return NextResponse.json(
        { error: `Invalid strategy type. Must be one of: ${validTypes.join(", ")}` },
        { status: 400 }
      );
    }

    const strategyData: StrategyInsert = {
      user_id: demoNoAuth ? null : user.id,
      name,
      description: description ?? null,
      type,
      rules,
      is_template: is_template ?? false,
    };

    const supabase = createServiceClient();

    const { data, error } = await supabase
      .from("strategies")
      .insert(strategyData)
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ strategy: data }, { status: 201 });
  } catch (err) {
    console.error("POST /api/strategies error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
