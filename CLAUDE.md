# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

`get-chitty` is `get.chitty.cc` — the **natural language onboarding gateway** for ChittyOS, deployed as a single Cloudflare Worker. Users POST a query in plain English to `/ask`; the Worker classifies intent against the ChittyOS service catalog (id/auth/api/connect/registry/schema/agent/git) and returns step-by-step routing guidance. It also exposes `/api/ai/chat` (multi-provider), `/api/approvals` (durable Workflow), `/api/files/signed-upload` (R2), `/api/audit`, and `/agent/*` (proxy to `agent.chitty.cc`).

Tier-2 platform service. ChittyConnect-managed. Production routes to `get.chitty.cc`.

## Commands

`Makefile` is canonical — prefer it over raw npm/wrangler.

```bash
make setup              # npm install
make dev                # wrangler dev --env dev   (override: make dev DEV=stage)
make build              # wrangler deploy --dry-run --env dev (validates bindings)
make deploy             # wrangler deploy --env dev
make typecheck          # tsc --noEmit (strict + noUncheckedIndexedAccess)
make lint               # eslint . --ext .ts
make test               # vitest run --reporter basic
```

Single test: `npx vitest run path/to/file.spec.ts -t "test name"`. Note: `tests/` directory is referenced in `AGENTS.md` but does not exist yet — create it mirroring `src/` when adding the first spec.

Production deploy: `scripts/deploy prod` (wraps `wrangler deploy --env prod`). GitHub Actions auto-deploys `prod` on push to `main` (`.github/workflows/deploy.yml`).

## Non-Obvious Layout

- **`wrangler.toml` lives in `cloudflare/`, not repo root.** Wrangler 4+ auto-discovers it, but if you invoke wrangler with explicit config, use `--config cloudflare/wrangler.toml`. Bindings reference `${CHITTY_KV_NAMESPACE_ID}`, `${CHITTY_R2_BUCKET}`, etc. — these are placeholder template vars expected to be substituted at deploy time (or replaced with literals before shipping).
- **`schema.sql` at repo root is corrupted** (binary garbage). Treat it as a known-broken artifact; do not edit-in-place — regenerate from a clean source if needed.
- **No `tests/` directory exists** despite AGENTS.md referencing it. Vitest is configured but has no specs yet.

## Architecture

### Entry point: `src/edge/worker.ts`
Hono app + two re-exports that Cloudflare uses for runtime discovery:

```ts
export { ApprovalWorkflow } from '../workflows/approval'   // Workflows entrypoint
export { default as queue } from '../pipelines/ingest'     // Queue consumer
```

Both must remain top-level named exports from `worker.ts` — Cloudflare's runtime looks them up by name when the binding fires. Don't move them to a barrel file.

### ChittyContext middleware is mandatory
Every request goes through `chittyContextMiddleware` from `@chittyos/chittycontext` (a GitHub-pinned dep: `github:chittyos/chittycontext#main`). Public paths (`/health`, `/api/v1/status`, `/.well-known`) skip ChittyID requirement; everything else requires an authenticated ChittyID and rejects anonymous (`allowAnonymous: false`).

In handlers, **always** retrieve context via `const ctx = c.get('chittyContext')` and **always** audit via `logAudit(c.env, createAuditEvent(ctx, eventType, action, resource, metadata))`. Audit events are persisted to KV under `audit:${chittyId}:${ts}` and read back by `/api/audit` and `/api/ai/conversations/:id`. Skipping `logAudit` breaks the traceability contract this service exists to provide.

`AGENT_ORCHESTRATOR` is a service binding (not HTTP) to the production `agent-orchestrator` worker. The `/agent/*` proxy forwards `X-Chitty-ID`, `X-Request-ID`, `X-Session-ID` headers — keep those headers when adding new proxy paths.

### Multi-provider AI router: `src/ai/router.ts`
`routeChat(env, messages, opts)` dispatches by `opts.provider` → `env.DEFAULT_PROVIDER` → model-prefix inference (`gpt-*` → openai, `claude-*` → anthropic, `@cf/*` → workersai) → workersai default. OpenAI/Anthropic both go through Cloudflare AI Gateway (`AI_GATEWAY_BASE`, never direct provider URLs). Workers AI prefers the `env.AI` binding and falls back to REST only with explicit account creds.

Adding a new provider = new file in `src/ai/providers/`, add to `Provider` union in `types.ts`, add a case in `router.ts`, extend `inferProvider`. Don't bypass the router from handlers.

### Agent loop: `src/agent/chittyagent.ts`
`runChittyAgent` is a one-round tool-execution loop: call model → if `toolCalls` returned, run handlers → call model again with results, no further iteration. Built-in `kv_get` tool reads from `globalThis.env.CHITTY_KV` (set at the top of `runChittyAgent`). If you add multi-round loops, put a hard step cap.

### Workflow: `src/workflows/approval.ts`
`ApprovalWorkflow` is a 7-step durable workflow (validate → persist → notify → sleep 1h → provision → audit → notify-outcome). It's bound as `APPROVAL_WORKFLOW` and started from `/api/approvals`.

**Known gap:** persistence is currently KV (`approval:${requestId}`) with a TODO to use Hyperdrive (`CHITTY_DB`). Per the user's global "no mocks/placeholders" rule, finishing this means writing real SQL against the bound Hyperdrive Postgres before any further work on this workflow ships. The local `generateChittyId` helper is also a stub — real ChittyID minting goes through `id.chitty.cc`, not inline.

### Queue consumer: `src/pipelines/ingest.ts`
Currently a no-op switch that throws on error to drive retries → DLQ. Add new message types as `case` arms; do not silently swallow unknown types — let them DLQ so they're visible.

## Bindings (cloudflare/wrangler.toml)

| Binding | Resource | Used by |
|---------|----------|---------|
| `AI` | Workers AI | `chatWorkersAI` (default provider) |
| `CHITTY_KV` | KV namespace | audit log, file reservations, approval records, KV tool |
| `CHITTY_ASSETS` | R2 bucket | `/api/files/signed-upload` |
| `CHITTY_VECTORS` | Vectorize | RAG (stubbed in `runChittyAgent`) |
| `CHITTY_DB` | Hyperdrive → Postgres | not yet wired (workflow TODO) |
| `CHITTY_TASKS` | Queue producer + consumer | audit fan-out, ingest pipeline |
| `APPROVAL_WORKFLOW` | Workflow | approval provisioning |
| `AGENT_ORCHESTRATOR` | Service binding | `/agent/*` proxy + workflow notifications |

Required secrets (`wrangler secret put` per env): `AI_GATEWAY_BASE`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`. Optional: `DEFAULT_PROVIDER`, `OPENAI_MODEL`, `ANTHROPIC_MODEL`, `WORKERSAI_MODEL`. Full list in `docs/cloudflare/env.md`.

## TypeScript Conventions

`tsconfig.json` runs strict + `noUncheckedIndexedAccess`, ES2022/WebWorker libs, `@cloudflare/workers-types`. Imports use `.js` extension on relative paths for ESM (the build target is the Workers runtime; bundler resolution handles `.ts` source). Files are lowercase; classes PascalCase; functions camelCase.

## Things That Will Bite You

- **Removing `chittyContextMiddleware` from a route** silently breaks audit + ChittyID rate limiting. If a handler genuinely needs to be public, add the path to the `publicPaths` array — don't bypass the middleware.
- **Editing `worker.ts` re-exports.** Removing or renaming `ApprovalWorkflow` / `queue` exports will fail deploy with cryptic Workflow/Queue binding errors, not a TS error.
- **The `tests/` reference in `AGENTS.md`** is aspirational. `make test` returns success on no specs (`|| true` in Makefile) — don't trust a green test run as evidence of correctness.
- **Production routes from `[env.prod]`** with `custom_domain = true` for `get.chitty.cc`. `[env.dev]` and `[env.stage]` are empty stanzas — they share the base bindings but need namespace IDs filled in before they actually work.

## Documentation

- `AGENTS.md` — repo guidelines (commit style, test layout intent, secrets policy).
- `docs/cloudflare/architecture.md` — high-level Cloudflare product mapping and flow.
- `docs/cloudflare/implementation.md` — code map, CI/CD, rollout plan.
- `docs/cloudflare/env.md` — bindings + secrets reference.
- `.chittyconnect.yml` — ChittyConnect service registration (auth, secrets vault, monitoring).
