// Edge API entrypoint for get.chitty.cc
// Router: Hono (minimal, fast, Worker-friendly)

import { Hono } from 'hono'
import { runChittyAgent } from '../agent/chittyagent'
import type { ChatMessage } from '../ai/types'

// Re-export Workflow class for Cloudflare to discover
export { ApprovalWorkflow } from '../workflows/approval'

// Re-export queue consumer
export { default as queue } from '../pipelines/ingest'

export interface Env {
  // Storage
  CHITTY_KV: KVNamespace
  CHITTY_ASSETS: R2Bucket
  CHITTY_VECTORS: VectorizeIndex
  CHITTY_DB: Hyperdrive

  // Queues
  CHITTY_TASKS: Queue<any>

  // AI
  AI: Ai

  // Workflows
  APPROVAL_WORKFLOW: Workflow

  // Service bindings
  AGENT_ORCHESTRATOR?: Fetcher
}

const app = new Hono<{ Bindings: Env }>()

// Health check
app.get('/health', c => c.json({
  ok: true,
  service: 'get-chitty',
  version: '0.1.0',
  timestamp: new Date().toISOString()
}))

// ChittyRegister compliance: /api/v1/status
app.get('/api/v1/status', c => c.json({
  status: 'operational',
  service: 'get-chitty',
  version: '0.1.0',
  capabilities: ['ai', 'workflows', 'files'],
  timestamp: new Date().toISOString()
}))

// AI chat - multi-provider (Workers AI, Claude, OpenAI)
app.post('/api/ai/chat', async c => {
  try {
    const body = await c.req.json<{
      messages: ChatMessage[]
      model?: string
      provider?: string
      temperature?: number
    }>()

    const res = await runChittyAgent(
      c.env,
      body.messages,
      { model: body.model, temperature: body.temperature, provider: body.provider as any }
    )
    return c.json(res)
  } catch (err: any) {
    return c.json({ error: String(err?.message || 'invalid request') }, 400)
  }
})

// Signed R2 URL for uploads
app.post('/api/files/signed-upload', async c => {
  const key = `uploads/${crypto.randomUUID()}`
  await c.env.CHITTY_KV.put(`reserved:${key}`, '1', { expirationTtl: 600 })
  return c.json({ key })
})

// Create approval request - triggers Workflow
app.post('/api/approvals', async c => {
  try {
    const body = await c.req.json<{
      entityType: 'user' | 'service' | 'device'
      entityData: Record<string, any>
      requestedBy: string
      approvers?: string[]
    }>()

    const requestId = crypto.randomUUID()

    // Create workflow instance
    const instance = await c.env.APPROVAL_WORKFLOW.create({
      id: requestId,
      params: {
        requestId,
        entityType: body.entityType,
        entityData: body.entityData,
        requestedBy: body.requestedBy,
        approvers: body.approvers
      }
    })

    return c.json({
      status: 'workflow_started',
      requestId,
      workflowId: instance.id
    }, 202)
  } catch (err: any) {
    return c.json({ error: String(err?.message || 'invalid request') }, 400)
  }
})

// Get approval status
app.get('/api/approvals/:id', async c => {
  const id = c.req.param('id')

  try {
    // Check workflow status
    const instance = await c.env.APPROVAL_WORKFLOW.get(id)
    const status = await instance.status()

    // Also get KV record for details
    const record = await c.env.CHITTY_KV.get(`approval:${id}`)

    return c.json({
      requestId: id,
      workflowStatus: status.status,
      details: record ? JSON.parse(record) : null
    })
  } catch (err: any) {
    return c.json({ error: 'Approval not found' }, 404)
  }
})

// Approve a pending request (external action)
app.post('/api/approvals/:id/approve', async c => {
  const id = c.req.param('id')

  try {
    const record = await c.env.CHITTY_KV.get(`approval:${id}`)
    if (!record) {
      return c.json({ error: 'Approval not found' }, 404)
    }

    const data = JSON.parse(record)
    data.status = 'approved'
    data.approvedAt = new Date().toISOString()

    await c.env.CHITTY_KV.put(`approval:${id}`, JSON.stringify(data))

    return c.json({ status: 'approved', requestId: id })
  } catch (err: any) {
    return c.json({ error: String(err?.message || 'failed') }, 400)
  }
})

// Proxy to agent.chitty.cc
app.all('/agent/*', async c => {
  if (!c.env.AGENT_ORCHESTRATOR) {
    return c.json({ error: 'Agent orchestrator not bound' }, 503)
  }

  const path = c.req.path.replace('/agent', '')
  const url = new URL(path || '/', 'https://internal')
  url.search = new URL(c.req.url).search

  const response = await c.env.AGENT_ORCHESTRATOR.fetch(url.toString(), {
    method: c.req.method,
    headers: c.req.raw.headers,
    body: c.req.raw.body
  })

  return new Response(response.body, {
    status: response.status,
    headers: response.headers
  })
})

export default app
