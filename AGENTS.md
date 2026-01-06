# Repository Guidelines

This repository hosts get.chitty.cc - the ChittyOS multi-model AI gateway.

## Project Structure & Module Organization
- `src/edge/` — Hono-based Worker entry point
- `src/ai/` — AI provider routing and implementations
- `src/ai/providers/` — Individual provider clients (Anthropic, OpenAI, Workers AI)
- `src/agent/` — ChittyAgent orchestrator with tool support
- `src/workflows/` — Cloudflare Workflows for multi-step processes
- `src/pipelines/` — Queue consumers for background processing
- `cloudflare/` — Wrangler configuration and bindings
- `docs/` — Architecture and implementation documentation
- `tests/` — Test suite mirroring `src/`

## Build, Test, and Development Commands
Prefer `Makefile` tasks:
- `make setup` — install dependencies via npm
- `make dev` — run local development server (`wrangler dev`)
- `make test` — run the full test suite
- `make lint` / `make fmt` — lint and auto-format the codebase
- `make build` — dry-run deploy to validate
- `make deploy` — deploy to Cloudflare

## Coding Style & Naming Conventions
- Language: TypeScript (ES modules). Indentation 2 spaces; max line length ~100.
- Naming: functions `camelCase`; classes `PascalCase`; files lowercase (e.g., `router.ts`).
- Imports: use `.js` extension in source for ESM compatibility.
- Linting: type safety enforced via `tsc`. Keep diffs minimal.

## Testing Guidelines
- Framework: Vitest. Place specs under `tests/` and mirror `src/` layout.
- Naming: `*.spec.ts` (e.g., `tests/ai/router.spec.ts`).
- Aim for ≥80% coverage; add regression tests for fixes.
- Run: `make test` (CI should run the same).

## Commit & Pull Request Guidelines
- Conventional Commits: `feat:`, `fix:`, `chore:`, `docs:`, `refactor:`, `test:`.
- Commit subjects in imperative mood; ~72 chars.
- PRs: clear description, linked issues, scope/rationale.

## Security & Configuration
- Do not commit secrets. Use `wrangler secret put` for API keys.
- Required secrets: `AI_GATEWAY_BASE`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`
- See `docs/cloudflare/env.md` for full configuration guide.
