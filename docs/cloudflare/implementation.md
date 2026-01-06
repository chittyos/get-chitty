# Implementation Plan (Workers, AI, Workflows, Queues, Vectorize, R2)

This plan ties Cloudflare products to concrete code locations, bindings, and CI/CD steps.

## Environments
- dev: preview deployments on PRs, non‑prod bindings.
- stage: pre‑prod with Access‑gated admin.
- prod: get.chittyy.cc live traffic.

All bindings use suffixes by environment (e.g., `CHITTY_DB_DEV`, `CHITTY_DB_PROD`).

## Bindings (wrangler)
- Postgres via Hyperdrive: `CHITTY_DB` (connection string in Cloudflare), driver via `@neondatabase/serverless` or `postgres` over Hyperdrive.
- KV (flags/sessions): `CHITTY_KV`.
- R2 (artifacts/uploads): `CHITTY_ASSETS`.
- Vectorize (embeddings): `CHITTY_VECTORS`.
- Queues (bg work): `CHITTY_TASKS` (producer) and `CHITTY_TASKS_CONSUMER` (consumer).
- Workflows: enabled in account; referenced in code in `src/workflows/*`.

## Code Map
- `src/edge/worker.ts` — Hono router, API entrypoint.
  - `/health` — liveness.
  - `/api/approvals` — create + fetch approval requests.
  - `/api/ai/chat` — proxy to Workers AI, with optional RAG over Vectorize.
  - `/api/files/*` — signed R2 URLs.
- `src/ai/workers_ai.ts` — small client for Workers AI and embedding helpers.
- `src/workflows/*.ts` — durable workflows (approval provisioning, certificate issuance).
- `src/pipelines/ingest.ts` — Queue consumer for event ingest & enrichment.

## Data Access
- Prefer Postgres via Hyperdrive for relational state aligned to `schema.sql`.
- Add a migration system outside Workers (Flyway/Liquibase/SQL‑based) or managed in CI with `scripts/db/migrate`.

## AI/RAG
- Embeddings: `text-embedding` model in Workers AI → store in Vectorize `CHITTY_VECTORS` with metadata (ids, types, access controls).
- Generation: Start with Workers AI `Llama`/`Mistral` models; switch via env var and AI Gateway for external providers.
- Safety: prompt templates with system guardrails; rate limit + audit log on `/api/ai/*` endpoints.

## Orchestration
- Workflows implement: create approval → verify → allocate chitty_id → write credentials → notify.
- Steps emit audit events to Queues and write relational results to Postgres.

## CI/CD
- Lint/format/typecheck on PR (`make lint`).
- Unit tests (`make test`).
- Preview deploy on PR (`wrangler deploy --dry-run --out=pr-preview` or Pages preview if using Pages for UI).
- Main deployments: GitHub Actions → `wrangler deploy` with `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`.
- Post‑deploy smoke: hit `/health` and basic API endpoints.

## Security
- Cloudflare Access on `/admin/*`, staging zones, and workflow consoles.
- Turnstile on public forms.
- Signed R2 URLs; never store secrets in KV; use Secrets store in Cloudflare and repository `.env.example` for documentation only.

## Observability
- Structured logs (JSON) with requestId across API, Queues, Workflows.
- Dead‑letter Queue for failed jobs.
- Optional: ship logs to R2 (batch) via Queues.

## Rollout Strategy
- Feature flags in KV; default off in prod.
- Canary by setting alternate Worker route for a percentage of traffic.

## Next Steps
1) Create Cloudflare resources (KV, R2, Vectorize index, Queue, Hyperdrive binding) per env.
2) Fill secrets and bindings via `wrangler secret put`.
3) Implement `src/core` domain logic for approval and chitty_id allocation.
4) Add tests in `tests/edge` and `tests/core`.
5) Wire GitHub Actions for deploy.

