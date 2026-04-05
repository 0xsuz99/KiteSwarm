# KiteSwarm

KiteSwarm is an autonomous multi-agent DeFi portfolio manager built for the **Kite AI Global Hackathon 2026** (Agentic Trading & Portfolio Management track).

Users can create AI agents, fund their dedicated vaults, configure strategy and risk controls, activate autonomous execution, and verify each cycle with on-chain attestations on Kite.

## TL;DR Status

- Functional full-stack app: Next.js + Supabase + Kite integrations
- Agent creation, funding, activation, auto-execution, logs, and performance UI are live
- Decision attestations are recorded on-chain
- Fast Demo Mode is available for high-frequency cycles in demo sessions
- Cross-chain execution and real protocol adapters are partially scaffolded and marked in roadmap

## Core Value Proposition

1. **Autonomous agent lifecycle**: configure once, then agent runs in background.
2. **Verifiable AI actions**: each cycle is attested on-chain.
3. **User vault model**: each agent has a separate AA-derived vault address.
4. **Demo-ready UX**: one dashboard-centric flow, with real-time simulation and live logs.

## High-Level Architecture

```mermaid
flowchart TD
    U[User Wallet / Browser] --> N[Next.js App Router App]
    N --> API[Route Handlers / API]
    API --> ENG[Agent Engine]
    API --> SB[(Supabase Postgres + Auth)]
    ENG --> KITE[Kite Chain RPC + AA SDK]
    ENG --> AI[AI Provider: Gemini / OpenAI]
    ENG --> MKT[Market Data APIs]
    KITE --> DL[DecisionLog Contract]
    DL --> EXP[Kitescan / On-chain Proof]
    SB --> UI[Dashboard / Agent Detail / Activity]
```

## Implemented vs Planned

### Implemented

- Supabase auth and profile sync
- Agent CRUD + strategy assignment
- Dedicated agent signer identity and AA-derived vault address
- Vault funding (KITE + ERC20)
- Vault withdrawals (KITE + ERC20)
- Editable spending rules
- Tracked tokens and vault holdings valuation
- Auto-execution scheduler
- On-chain decision attestation
- Portfolio snapshots and P/L trend chart
- Activity feed and pagination
- Fast Demo Mode (faster scheduler cadence)
- Live economy simulation (UI-side stress test)

### Planned / Partial

- True cross-chain bridge execution via LayerZero
- Production-grade swap routing / DEX integrations
- Lucid/Aave native yield adapters with real deposit/withdraw execution
- Marketplace mechanics (public agents, staking into third-party agents, fee-share)

## Execution Lifecycle

```mermaid
sequenceDiagram
    participant User
    participant UI as Next.js UI
    participant API as /api/agents/auto-execute
    participant DB as Supabase
    participant Engine as AgentEngine
    participant Chain as Kite Chain

    User->>UI: Create + fund + activate agent
    UI->>DB: Save agent config + spending rules + tracked tokens
    UI->>API: Trigger auto execution loop (background polling)
    API->>DB: Fetch active agents + latest execution log
    API->>Engine: executeStrategy(agent, strategy)
    Engine->>Engine: Build decision (AI or deterministic fallback)
    Engine->>Chain: Attest decision hash on-chain
    Engine-->>API: Return actions + tx hashes
    API->>DB: Write execution_logs + portfolio_snapshots
    DB-->>UI: Updated metrics/logs
    UI->>User: Live status, tx links, performance chart
```

## Agent Vault Model

- Each agent is derived from its own signer identity.
- Vault address is shown in agent detail and can be funded directly.
- Assets inside vault are used by the strategy engine.
- Users can withdraw vault assets back to their wallet using the built-in withdrawal actions.

## Fast Demo Mode

Fast Demo Mode is a UI toggle in the app header.

When enabled:

- Auto-executor polling interval becomes much faster.
- Server scheduler min interval is reduced.
- Strategy interval checks are reduced to demo cadence.

This helps you show repeated autonomous cycles quickly in a hackathon demo.

Important: Fast Demo Mode accelerates cadence, but **does not fabricate on-chain profit**.

## Real Profit Expectations

On testnet, real profit depends on real protocol operations and market conditions.

Current implementation gives you:

- Real vault balances
- Real execution logs
- Real attestation transactions
- Strategy cycle automation

It does **not guarantee yield/profit** without full protocol adapters (swap/LP/yield deposit contracts).

## Decimals and Token Unit Safety

Incorrect decimals can inflate displayed balances massively (e.g., USDT treated as 18 instead of 6).

Protections added:

- Common tokens use locked known decimals
- Custom token transfer/withdraw requires on-chain metadata detection
- UI warning for suspiciously large stablecoin balances

If wrong funding happened:

1. Withdraw token back to wallet.
2. Re-fund with correct token/decimals path.

## Tech Stack

- Next.js (App Router) + TypeScript
- Tailwind + shadcn/ui
- Supabase (Auth + Postgres)
- wagmi + viem + RainbowKit
- ethers v6
- gokite-aa-sdk
- Hardhat (contract deployment)

## Project Structure

```text
src/
  app/
    (dashboard)/
    api/
  components/
    agents/
    auth/
    ui/
    wallet/
  lib/
    agent-engine.ts
    execute-agent-strategy.ts
    kite-aa.ts
    kite-chain.ts
    kite-tokens.ts
    supabase/
  types/
contracts/
scripts/
supabase/
```

## Environment Variables

Create `.env.local` with:

```bash
# Supabase
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=

# Wallet / UI
NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID=

# Kite Chain
KITE_RPC_URL=https://rpc-testnet.gokite.ai
KITE_CHAIN_ID=2368
KITE_BUNDLER_URL=https://bundler-service.staging.gokite.ai/rpc/
DECISION_LOG_CONTRACT=
NEXT_PUBLIC_DECISION_LOG_CONTRACT=

# Agent signing
AGENT_MASTER_PRIVATE_KEY=
AGENT_SIGNER_ENCRYPTION_KEY=

# AI provider
AI_PROVIDER=gemini
GEMINI_API_KEY=
GEMINI_MODEL=gemini-2.5-flash
# Optional alternative:
# AI_PROVIDER=openai
# OPENAI_API_KEY=

# Optional tuning
KITE_PRICE_USD=0.01
AGENT_AUTO_MIN_INTERVAL_SECONDS=90
AGENT_AUTO_MAX_AGENTS_PER_TICK=6
NEXT_PUBLIC_AGENT_AUTO_POLL_MS=45000
```

## Local Setup

1. Install dependencies:

```bash
npm install
```

2. Run Supabase SQL schema:

- Use `supabase/schema.sql` in Supabase SQL Editor.

3. Run app:

```bash
npm run dev
```

4. Verify quality:

```bash
npm run lint
npm run build
```

## Contract Deployment

Compile:

```bash
npm run contracts:compile
```

Deploy to Kite testnet:

```bash
npm run contracts:deploy:testnet
```

After deployment, set:

- `DECISION_LOG_CONTRACT`
- `NEXT_PUBLIC_DECISION_LOG_CONTRACT`

## API Surface (Selected)

- `GET/POST /api/agents`
- `GET/PUT/DELETE /api/agents/[id]`
- `POST /api/agents/[id]/execute`
- `POST /api/agents/[id]/reset`
- `POST /api/agents/[id]/withdraw`
- `GET /api/agents/[id]/logs`
- `GET /api/agents/[id]/performance`
- `POST /api/agents/auto-execute`
- `GET /api/portfolio`
- `GET /api/activity`

## Judge Demo Flow

1. Connect wallet and open dashboard.
2. Enable **Fast Demo Mode**.
3. Create agent (e.g., Yield Optimizer).
4. Fund vault (KITE + USDT).
5. Activate agent.
6. Show auto-execution logs filling in without manual trigger.
7. Open tx links on Kitescan (attestation proof).
8. Show holdings snapshot and P/L trend.
9. Demonstrate withdraw back to wallet.

## Honest Demo Notes

For judges, use this framing:

- "Autonomous orchestration and attested execution loops are production-oriented and live."
- "Some advanced execution adapters (cross-chain, protocol-native yield/swap routing) are in-progress roadmap components."
- "Fast Demo Mode is for cadence acceleration during demo time; it does not fake on-chain outcomes."

## Troubleshooting

### Build passes but no agent cycles happening

- Agent must be `active`.
- Agent must have strategy and vault funds.
- Check auto-exec interval and latest execution log status.

### Very large stablecoin valuation

- Usually a decimals mismatch.
- Withdraw and re-fund with locked common token path.

### No on-chain tx hash for execution

- Verify `DECISION_LOG_CONTRACT` and signer env variables.
- Check RPC/bundler availability.

## Security Notes

- Use `AGENT_SIGNER_ENCRYPTION_KEY` in non-local environments.
- Never expose private keys in client-side code.
- Restrict service-role key to server route handlers only.

## License

Hackathon project. Add your preferred license before production use.
