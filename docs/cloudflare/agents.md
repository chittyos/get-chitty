# ChittyAgent (Cloudflare Agent)

ChittyAgent is the central agent orchestration layer that can call:
- Local edge models (Workers AI) for fast/cheap inference
- Third‑party models (Claude/Claude‑Code via Anthropic; ChatGPT via OpenAI)
- Optional self‑hosted models via HTTP

It routes through Cloudflare AI Gateway for observability, quotas, and key isolation.

## Where It Lives
- Router: `src/ai/router.ts`
- Providers: `src/ai/providers/{workersai,openai,anthropic}.ts`
- Agent orchestrator (tools/RAG/policy): `src/agent/chittyagent.ts`
- API entry (uses agent): `src/edge/worker.ts`

## Configure Providers
Set these secrets in Cloudflare (Dashboard or `wrangler secret put`):
- `AI_GATEWAY_BASE` — e.g. `https://gateway.ai.cloudflare.com/v1/<account>/<gateway>`
- `OPENAI_API_KEY` — if using OpenAI via Gateway
- `ANTHROPIC_API_KEY` — if using Anthropic via Gateway
- Workers AI: enable in account. Many accounts expose `env.AI` for Workers AI SDK.

Optional knobs:
- `DEFAULT_PROVIDER` — `workersai` | `anthropic` | `openai`
- `OPENAI_MODEL` — e.g., `gpt-4o-mini`
- `ANTHROPIC_MODEL` — e.g., `claude-3-5-sonnet-20241022`
- `WORKERSAI_MODEL` — e.g., `@cf/meta/llama-3.1-8b-instruct`

## AI Gateway Paths
- OpenAI: `${AI_GATEWAY_BASE}/openai/chat/completions`
- Anthropic: `${AI_GATEWAY_BASE}/anthropic/messages`

Provider keys are sent to Gateway, or stored in the Gateway config. Keep keys only in Cloudflare secrets.

## Tools & RAG
ChittyAgent supports:
- Tools (function calls) — define in `src/agent/chittyagent.ts`
- Retrieval — integrates with Vectorize to augment prompts

Start with a small set (KV lookup, HTTP fetch), then grow.

