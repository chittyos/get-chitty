# Chitty Cloudflare Architecture (get.chittyy.cc)

This document proposes a pragmatic, Cloudflare‑first architecture for get.chittyy.cc and maps Chitty’s core capabilities onto Cloudflare products. It balances fast global performance with strong trust/identity guarantees and a clear path to scale.

## Goals
- Global, low‑latency APIs and web UX.
- Explicit trust/identity flows aligned to Chitty’s trust architecture.
- Cost‑efficient AI with guardrails and observability.
- Simple, automated deployments and safe rollouts.
- Clear separation of concerns across code, CI/CD, and infra.

## Product Mapping

1) Web + API Edge
- Cloudflare Workers (runtime) + Hono router for HTTP routes.
- Cloudflare Pages (optional) for static site or SSR frontends.
- Cloudflare KV for config/feature flags and ephemeral session data.
- Durable Objects only where strict coordination is required (e.g., chat rooms, rate limiter buckets, or multi‑step handshakes that need consistency).

2) Data Layer
- Primary relational: Postgres via Cloudflare Hyperdrive (Neon/Supabase/CloudSQL). Rationale: advanced SQL, migrations, and reliability for identity/trust schemas already modeled in `schema.sql`.
- Vector database: Cloudflare Vectorize for embeddings and similarity search.
- Object storage: R2 for documents, uploads, model artifacts, and large blobs.
- Edge cache: KV for small hot data; Cache API for response caching.

3) AI & Agents
- Workers AI for hosted, privacy‑preserving inference at the edge (text, embeddings, rerank, vision).
- AI Gateway for routing/observability if calling external AI providers (usage analytics, key management, provider failover).
- Vectorize + Workers AI for retrieval‑augmented generation (RAG).
- Workflows for trusted multi‑step agentic operations that coordinate storage, inference, human approvals, and notifications.

4) Events, Background Jobs, Dataflow
- Queues for background processing (ingest, fan‑out, long‑running work).
- Workflows for multi‑step orchestration (approval flows, provisioning, certificate issuance lifecycles).
- Pipelines (when applicable) for declarative data movement between R2/KV/Queues/Workers; until then, model as Workers + Queues.

5) Security & Access
- Zero Trust: Cloudflare Access for admin routes and backoffice. Turnstile for bot detection in public forms.
- Rate limiting at the edge (Rulesets) + in‑app token‑bucket (Durable Object) for fine‑grained control.
- Signed URLs for R2 downloads/uploads.

## High‑Level Flow

1) User lands on get.chittyy.cc → served by Worker or Pages.
2) Public UI actions (apply for approval, identity linking) hit API routes in Workers.
3) API writes to Postgres via Hyperdrive (approval_requests, chitty_ids, auth_users), caches hot reads in KV.
4) Long operations enqueue messages to Queues; Workflows orchestrate multi‑step processes (e.g., approval → ID provisioning → certificate issuance → notifications).
5) AI features use Workers AI directly when models are available, else through AI Gateway to third‑party providers.
6) Search & recommendations use Vectorize; heavy objects go to R2.

## Core Components

- Edge API (Workers):
  - Routes under `/api/*` (auth, approvals, chitty‑id, files, ai/*, events/*).
  - Hono router with typed bindings for D1/Hyperdrive, KV, R2, Vectorize.
  - Simple middleware for auth (JWT/API keys), rate limits, audit.

- Orchestration (Workflows):
  - `approval_provisioning`: create approval, wait for verification → allocate chitty_id → generate credentials → write audit.
  - `certificate_issuance`: CSR validation → sign → store in Postgres/R2 → notify.
  - `trust_score_update`: recalculate and persist trust levels on events.

- Background (Queues):
  - `ingest_events`: normalize telemetry into Postgres + Vectorize.
  - `notify`: webhook/email/SMS after key lifecycle transitions.

## Data Choices

- Use Postgres via Hyperdrive for the relational core matching `schema.sql` intent (identity, approvals, tokens, certificates).
- Use Vectorize for embeddings and similarity queries.
- Use R2 for PEMs, artifacts, attachments (never store secrets in plaintext; use envelope encryption and KMS if required).
- Use KV for small config, verifications, and one‑time tokens.

## Why Not D1 as Primary?

- D1 is excellent for lightweight global state but Chitty’s schema appears relationally rich (constraints, JSONB, complex indices). Postgres (managed) via Hyperdrive better fits these needs. If specific sub‑domains need edge‑replicated reads, introduce D1 as a read‑optimized projection later.

## Networking & Zones

- Route root and subpaths to Workers, isolate admin under Access policies.
- Use separate namespaces per environment (dev/stage/prod) for KV, Queues, Vectorize, R2 buckets, and Hyperdrive bindings.

## Observability

- Logs: Workers logs + Queues dead‑letter queues.
- Metrics: request counters, latency histograms, workflow step timings.
- Tracing: add request IDs, correlate across API/Queue/Workflow.

## Rollouts

- Trunk‑based, deploy on green.
- Canary via Workers traffic splits or staged route.
- Feature flags via KV.

## Minimal Code Layout

```
src/
  edge/worker.ts              # Hono‑based API entry
  ai/workers_ai.ts            # Workers AI helpers
  workflows/approval.ts       # Workflows orchestration definitions
  pipelines/ingest.ts         # Queue consumer / pipeline entry
  core/                       # Domain logic (pure, testable)
tests/
  edge/test_worker.spec.ts
docs/
  cloudflare/architecture.md
  cloudflare/implementation.md
cloudflare/
  wrangler.toml               # Workers config & bindings
```

