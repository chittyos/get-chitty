# Environment & Secrets

Configure these via Cloudflare (Wrangler or Dashboard) per environment.

## Required Bindings
- CHITTY_KV — KV namespace id
- CHITTY_ASSETS — R2 bucket name
- CHITTY_VECTORS — Vectorize index name
- CHITTY_TASKS — Queue name; CHITTY_DLQ_QUEUE for dead‑letter
- CHITTY_HYPERDRIVE_ID — Hyperdrive binding id for Postgres
 - AI (optional but recommended) — Workers AI binding for local models

## Optional / AI
- Workers AI — enable in account; exposes `env.AI` binding (preferred path).
- AI Gateway — set `AI_GATEWAY_BASE` and provider keys as secrets.
- OPENAI_API_KEY — for OpenAI via Gateway
- ANTHROPIC_API_KEY — for Anthropic via Gateway
- DEFAULT_PROVIDER — `workersai` | `openai` | `anthropic`
- OPENAI_MODEL / ANTHROPIC_MODEL / WORKERSAI_MODEL — default models
- CLOUDFLARE_ACCOUNT_ID / CLOUDFLARE_API_TOKEN — only if using Workers AI REST fallback

## CLI Examples
```bash
wrangler kv namespace create CHITTY_KV
wrangler r2 bucket create $CHITTY_R2_BUCKET
wrangler vectorize create-index $CHITTY_VECTOR_INDEX --dims 1536
wrangler queues create $CHITTY_TASKS_QUEUE
wrangler queues create $CHITTY_DLQ_QUEUE
wrangler hyperdrive create chitty-db --connection-string $DATABASE_URL
wrangler secret put AI_GATEWAY_BASE
wrangler secret put OPENAI_API_KEY
wrangler secret put ANTHROPIC_API_KEY
```

Add env‑specific values through `[env.dev]`, `[env.stage]`, `[env.prod]` in `cloudflare/wrangler.toml` or via dashboard.
