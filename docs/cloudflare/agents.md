# ChittyAgent & Service Integration

## Overview

get.chitty.cc integrates with the ChittyOS agent ecosystem through two layers:

1. **ChittyAgent (in-worker)** - Multi-model AI orchestrator that routes to Workers AI, Claude, or OpenAI
2. **Agent Orchestrator (service binding)** - Routes to specialized agents at agent.chitty.cc

```
┌─────────────────────────────────────────────────────────────────┐
│                        get.chitty.cc                            │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────────┐ │
│  │ /api/ai/*   │  │ /api/       │  │ /agent/*                │ │
│  │             │  │ approvals   │  │ (proxy)                 │ │
│  └──────┬──────┘  └──────┬──────┘  └────────────┬────────────┘ │
│         │                │                      │              │
│         ▼                ▼                      │              │
│  ┌─────────────┐  ┌─────────────┐               │              │
│  │ ChittyAgent │  │ Approval    │               │              │
│  │ (router)    │  │ Workflow    │               │              │
│  └──────┬──────┘  └──────┬──────┘               │              │
└─────────┼────────────────┼──────────────────────┼──────────────┘
          │                │                      │
          ▼                ▼                      ▼
┌─────────────────┐  ┌──────────────────────────────────────────┐
│ AI Providers    │  │            agent.chitty.cc               │
│ - Workers AI    │  │  ┌──────────────────────────────────────┐│
│ - Anthropic     │  │  │         Agent Orchestrator           ││
│ - OpenAI        │  │  │  /notify/* → Notification Agent      ││
└─────────────────┘  │  │  /notion/* → Notion Admin Ops        ││
                     │  │  /cloudflare/* → Cloudflare Ops      ││
                     │  └──────────────────────────────────────┘│
                     └──────────────────────────────────────────┘
```

## ChittyAgent (In-Worker AI)

The embedded ChittyAgent routes AI requests to multiple providers:

| Provider | Models | Use Case |
|----------|--------|----------|
| Workers AI | `@cf/meta/llama-3.1-8b-instruct` | Fast, cheap, edge inference |
| Anthropic | `claude-3-5-sonnet-20241022` | Complex reasoning, code |
| OpenAI | `gpt-4o-mini`, `gpt-4o` | General purpose |

### Location
- Router: `src/ai/router.ts`
- Providers: `src/ai/providers/{workersai,openai,anthropic}.ts`
- Agent: `src/agent/chittyagent.ts`

### Configuration
```bash
# Required for external providers
wrangler secret put AI_GATEWAY_BASE
wrangler secret put ANTHROPIC_API_KEY
wrangler secret put OPENAI_API_KEY

# Optional defaults
wrangler secret put DEFAULT_PROVIDER  # workersai | anthropic | openai
```

### Usage
```bash
curl -X POST https://get.chitty.cc/api/ai/chat \
  -H "Content-Type: application/json" \
  -d '{
    "messages": [{"role": "user", "content": "Hello"}],
    "provider": "anthropic",
    "model": "claude-3-5-sonnet-20241022"
  }'
```

## Agent Orchestrator Integration

get.chitty.cc has a service binding to agent.chitty.cc for routing to specialized agents.

### Service Binding (wrangler.toml)
```toml
[[services]]
binding = "AGENT_ORCHESTRATOR"
service = "agent-orchestrator"
environment = "production"
```

### Proxy Endpoint
All requests to `/agent/*` are proxied to agent.chitty.cc:

```bash
# List available agents
curl https://get.chitty.cc/agent/

# Call specific agent
curl https://get.chitty.cc/agent/notion/health
```

### Workflow Integration
The ApprovalWorkflow uses the agent orchestrator for notifications:

```typescript
// In workflow step
await this.env.AGENT_ORCHESTRATOR.fetch('https://internal/notify/approval', {
  method: 'POST',
  body: JSON.stringify({ type: 'approval.requested', ... })
})
```

## Cloudflare Workflows

get.chitty.cc uses Cloudflare Workflows for durable multi-step processes.

### ApprovalWorkflow
Location: `src/workflows/approval.ts`

Steps:
1. **validate-request** - Validate payload
2. **persist-request** - Store in KV/DB
3. **notify-approvers** - Call agent.chitty.cc notification agent
4. **wait-for-approval** - Sleep with timeout (1 hour)
5. **provision-identity** - Generate ChittyID if approved
6. **write-audit** - Queue audit log
7. **notify-outcome** - Notify requestor via agent

### Workflow Binding
```toml
[[workflows]]
name = "approval-workflow"
binding = "APPROVAL_WORKFLOW"
class_name = "ApprovalWorkflow"
```

### API Endpoints
```bash
# Start workflow
POST /api/approvals
{
  "entityType": "service",
  "entityData": { "name": "my-service" },
  "requestedBy": "user@example.com",
  "approvers": ["admin@example.com"]
}

# Check status
GET /api/approvals/:id

# Approve (external action)
POST /api/approvals/:id/approve
```

## Adding New Agents

To add a new agent to agent.chitty.cc:

1. Create worker in `chittyagent/workers/new-agent/`
2. Deploy with a service binding name
3. Add service binding to agent-orchestrator's wrangler.toml:
   ```toml
   [[services]]
   binding = "AGENT_NEW_AGENT"
   service = "new-agent-production"
   ```
4. The orchestrator auto-discovers `AGENT_*` bindings

To call from get.chitty.cc:
```bash
curl https://get.chitty.cc/agent/new-agent/endpoint
```
