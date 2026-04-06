-- KiteSwarm Database Schema
-- Run this in Supabase SQL editor to set up the database

-- Users table (extends Supabase auth)
CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID REFERENCES auth.users PRIMARY KEY,
  wallet_address TEXT UNIQUE,
  kite_passport_agent_id TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Strategy templates
CREATE TABLE IF NOT EXISTS public.strategies (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  type TEXT CHECK (type IN ('rebalance', 'yield_optimize', 'dca', 'momentum', 'custom')),
  rules JSONB NOT NULL,
  is_template BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Agent configurations
CREATE TABLE IF NOT EXISTS public.agents (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  aa_wallet_address TEXT,
  vault_proxy_address TEXT,
  status TEXT DEFAULT 'inactive' CHECK (status IN ('active', 'inactive', 'paused', 'error')),
  strategy_id UUID REFERENCES public.strategies(id),
  config JSONB DEFAULT '{}',
  spending_rules JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Execution log
CREATE TABLE IF NOT EXISTS public.execution_logs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  agent_id UUID REFERENCES public.agents(id) ON DELETE CASCADE,
  action_type TEXT NOT NULL,
  description TEXT,
  input_data JSONB,
  decision JSONB,
  tx_hash TEXT,
  attestation_tx_hash TEXT,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'executing', 'success', 'failed')),
  gas_used TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Portfolio snapshots
CREATE TABLE IF NOT EXISTS public.portfolio_snapshots (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  agent_id UUID REFERENCES public.agents(id) ON DELETE CASCADE,
  total_value_usd NUMERIC,
  holdings JSONB,
  snapshot_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.strategies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.execution_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.portfolio_snapshots ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Users can read own profile" ON public.profiles
  FOR SELECT USING (auth.uid() = id);

CREATE POLICY "Users can update own profile" ON public.profiles
  FOR UPDATE USING (auth.uid() = id);

CREATE POLICY "Users can insert own profile" ON public.profiles
  FOR INSERT WITH CHECK (auth.uid() = id);

CREATE POLICY "Users can read own agents" ON public.agents
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own agents" ON public.agents
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own agents" ON public.agents
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own agents" ON public.agents
  FOR DELETE USING (auth.uid() = user_id);

CREATE POLICY "Users can read own strategies and templates" ON public.strategies
  FOR SELECT USING (auth.uid() = user_id OR is_template = true);

CREATE POLICY "Users can insert own strategies" ON public.strategies
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own strategies" ON public.strategies
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own strategies" ON public.strategies
  FOR DELETE USING (auth.uid() = user_id);

CREATE POLICY "Users can read own execution logs" ON public.execution_logs
  FOR SELECT USING (
    agent_id IN (SELECT id FROM public.agents WHERE user_id = auth.uid())
  );

CREATE POLICY "Service can insert execution logs" ON public.execution_logs
  FOR INSERT WITH CHECK (true);

CREATE POLICY "Users can read own portfolio snapshots" ON public.portfolio_snapshots
  FOR SELECT USING (
    agent_id IN (SELECT id FROM public.agents WHERE user_id = auth.uid())
  );

CREATE POLICY "Service can insert portfolio snapshots" ON public.portfolio_snapshots
  FOR INSERT WITH CHECK (true);

-- Enable realtime for execution_logs
ALTER PUBLICATION supabase_realtime ADD TABLE public.execution_logs;
ALTER PUBLICATION supabase_realtime ADD TABLE public.portfolio_snapshots;

-- Seed template strategies
INSERT INTO public.strategies (id, user_id, name, description, type, rules, is_template)
VALUES
  (
    'a0000000-0000-0000-0000-000000000001',
    NULL,
    'Conservative Rebalancer',
    'Maintains a balanced portfolio with periodic rebalancing when allocations drift beyond threshold.',
    'rebalance',
    '{"trigger": "threshold", "interval_hours": 24, "allocations": [{"asset": "USDC", "chain": "kite", "target_pct": 40}, {"asset": "ETH", "chain": "kite", "target_pct": 30}, {"asset": "L-USDC", "chain": "kite", "target_pct": 30}], "rebalance_threshold_pct": 5, "max_slippage_pct": 1, "stop_loss_pct": 10}',
    true
  ),
  (
    'a0000000-0000-0000-0000-000000000002',
    NULL,
    'Yield Maximizer',
    'Automatically deposits idle stablecoins into Lucid L-USDC and Aave v3 liquidity pools for yield generation.',
    'yield_optimize',
    '{"trigger": "threshold", "idle_threshold_usd": 100, "min_yield_apy": 2, "target_protocols": ["lucid", "aave_v3"], "auto_compound": true, "pools": [{"protocol": "lucid", "asset": "USDC", "target_asset": "L-USDC", "allocation_pct": 60}, {"protocol": "aave_v3", "asset": "USDC", "pool": "usdc_lending", "allocation_pct": 40}]}',
    true
  ),
  (
    'a0000000-0000-0000-0000-000000000005',
    NULL,
    'Aave Liquidity Provider',
    'Stakes assets into Aave v3 lending pools on Kite to earn supply APY and protocol incentives.',
    'yield_optimize',
    '{"trigger": "threshold", "idle_threshold_usd": 50, "min_yield_apy": 1.5, "target_protocols": ["aave_v3"], "auto_compound": true, "pools": [{"protocol": "aave_v3", "asset": "USDC", "pool": "usdc_lending", "allocation_pct": 50}, {"protocol": "aave_v3", "asset": "ETH", "pool": "eth_lending", "allocation_pct": 50}]}',
    true
  ),
  (
    'a0000000-0000-0000-0000-000000000003',
    NULL,
    'DCA Bitcoin',
    'Dollar-cost averages into BTC on a regular schedule to reduce timing risk.',
    'dca',
    '{"trigger": "interval", "interval_hours": 168, "buy_asset": "BTC", "buy_chain": "kite", "spend_asset": "USDC", "spend_amount_usd": 50, "max_slippage_pct": 2}',
    true
  ),
  (
    'a0000000-0000-0000-0000-000000000004',
    NULL,
    'Momentum Trader',
    'AI-powered trend following that adjusts allocations based on market momentum signals.',
    'momentum',
    '{"trigger": "interval", "interval_hours": 6, "lookback_hours": 72, "momentum_threshold_pct": 3, "max_position_pct": 50, "assets": ["ETH", "BTC", "USDC"], "max_slippage_pct": 1.5, "stop_loss_pct": 8}',
    true
  )
ON CONFLICT DO NOTHING;
