// Edge API entrypoint for get.chittyy.cc
// Router: Hono (minimal, fast, Worker‑friendly)

import { Hono } from 'hono'
import { runChittyAgent } from '../agent/chittyagent'
// Export queue consumer from the same worker bundle
// eslint-disable-next-line import/no-default-export
// @ts-ignore
export { default as queue } from '../pipelines/ingest'
import type { ChatMessage } from '../ai/types'

export interface Env {
  CHITTY_KV: KVNamespace
  CHITTY_ASSETS: R2Bucket
  CHITTY_VECTORS: any
  CHITTY_DB: any // Hyperdrive binding (Postgres)
  CHITTY_TASKS: Queue<any>
}

const app = new Hono<{ Bindings: Env }>()

// Liveness / readiness
app.get('/health', c => c.json({ ok: true }))

// Example: AI chat proxy (Workers AI or AI Gateway)
app.post('/api/ai/chat', async c => {
  try {
    const body = await c.req.json<{ messages: ChatMessage[]; model?: string; provider?: string; temperature?: number }>()
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

// Example: Signed R2 URL (upload)
app.post('/api/files/signed-upload', async c => {
  const key = `uploads/${crypto.randomUUID()}`
  // Use R2 pre‑signed urls (FormData policy) or direct put with signed headers
  // For now, just reserve the key and return it to the client.
  await c.env.CHITTY_KV.put(`reserved:${key}`, '1', { expirationTtl: 600 })
  return c.json({ key })
})

// Example: Approval request (enqueue workflow)
app.post('/api/approvals', async c => {
  try {
    const payload = await c.req.json<any>()
    // Queue a background job; a Workflow will orchestrate steps.
    await c.env.CHITTY_TASKS.send({ type: 'approval.requested', payload })
    return c.json({ status: 'queued' }, 202)
  } catch (err) {
    return c.json({ error: 'invalid request' }, 400)
  }
})

export default app
