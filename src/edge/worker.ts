/**
 * get.chitty.cc - ChittyOS Natural Language Onboarding Gateway
 *
 * The starting point for interacting with ChittyOS.
 * Users describe what they want in natural language and get routed
 * to the appropriate workflows, services, and commands.
 *
 * All operations tied to ChittyID for traceability and audit.
 */

import { Hono } from 'hono'
import { runChittyAgent } from '../agent/chittyagent'
import { routeChat } from '../ai/router'
import type { ChatMessage } from '../ai/types'

// Import from shared @chittyos/chittycontext package
import {
  chittyContextMiddleware,
  rateLimitByChittyId,
  requireAuthenticated
} from '@chittyos/chittycontext/middleware'
import {
  ChittyContext,
  createAuditEvent,
  logAudit,
  createContext,
  recordOutcome,
  promoteContext,
  getContextRouting,
  ContextEnv
} from '@chittyos/chittycontext'

// Re-export Workflow class for Cloudflare to discover
export { ApprovalWorkflow } from '../workflows/approval'

// Re-export queue consumer
export { default as queue } from '../pipelines/ingest'

// ChittyOS service routes for NL gateway
const CHITTY_SERVICES = {
  identity: { domain: 'id.chitty.cc', description: 'ChittyID creation and management' },
  auth: { domain: 'auth.chitty.cc', description: 'Authentication and authorization' },
  api: { domain: 'api.chitty.cc', description: 'API gateway and documentation' },
  connect: { domain: 'connect.chitty.cc', description: 'Service connections and integrations' },
  registry: { domain: 'registry.chitty.cc', description: 'Service registry and discovery' },
  schema: { domain: 'schema.chitty.cc', description: 'Schema definitions and validation' },
  agent: { domain: 'agent.chitty.cc', description: 'AI agent orchestration' },
  git: { domain: 'git.chitty.cc', description: 'ChittyOS source repositories and Git access' },
  chittycan: { domain: 'cli.chitty.cc', description: 'Universal CLI and Local Adapter for ChittyOS' },
  chittymarket: { domain: 'market.chitty.cc', description: 'Open marketplace for community MCP servers and free agents' },
  chittypro: { domain: 'pro.chitty.cc', description: 'Premium ChittyPro marketplace for enterprise-grade LLM tooling' }
} as const

type UserIntent =
  | 'create_identity'
  | 'authenticate'
  | 'api_access'
  | 'service_discovery'
  | 'connect_service'
  | 'clone_repo'
  | 'general_help'
  | 'unknown'

interface IntentResult {
  intent: UserIntent
  confidence: number
  services: (keyof typeof CHITTY_SERVICES)[]
  steps: string[]
  commands?: string[]
  endpoints?: string[]
}

export interface Env extends ContextEnv {
  // Storage
  CHITTY_KV: KVNamespace
  CHITTY_ASSETS: R2Bucket
  CHITTY_VECTORS: VectorizeIndex
  CHITTY_DB: Hyperdrive

  // Queues
  CHITTY_TASKS: Queue<any>

  // AI & Search
  AI: Ai
  CHITTY_SEARCH: any

  // Workflows
  APPROVAL_WORKFLOW: Workflow

  // Service bindings
  AGENT_ORCHESTRATOR?: Fetcher
}

const app = new Hono<{ Bindings: Env; Variables: { chittyContext: ChittyContext } }>()

// Apply ChittyContext middleware globally
// Public paths don't require ChittyID
app.use('*', chittyContextMiddleware({
  publicPaths: ['/health', '/api/v1/status', '/.well-known'],
  allowAnonymous: false
}))

// Rate limit AI endpoints by ChittyID
app.use('/api/ai/*', rateLimitByChittyId({
  maxRequests: 100,
  windowSeconds: 60
}))

// Health check (public)
app.get('/health', c => c.json({
  ok: true,
  service: 'get-chitty',
  version: '0.2.0',
  timestamp: new Date().toISOString()
}))

// ChittyRegister compliance: /api/v1/status (public)
app.get('/api/v1/status', c => c.json({
  status: 'operational',
  service: 'get-chitty',
  version: '0.2.0',
  capabilities: ['ai', 'workflows', 'files', 'audit', 'nl-gateway'],
  timestamp: new Date().toISOString()
}))

// ============================================================
// NL GATEWAY - Natural Language Onboarding
// ============================================================

// Root - Welcome and guidance
app.get('/', (c) => c.json({
  service: 'get.chitty.cc',
  purpose: 'ChittyOS Natural Language Onboarding Gateway',
  message: 'Tell me what you want to do!',
  endpoints: {
    ask: 'POST /ask - Natural language query',
    askGet: 'GET /ask?q=... - Quick query',
    services: 'GET /services - Available services',
    health: 'GET /health - Health check'
  },
  examples: [
    { query: 'I want to create a ChittyID', try: '/ask?q=I+want+to+create+a+ChittyID' },
    { query: 'How do I authenticate?', try: '/ask?q=How+do+I+authenticate' },
    { query: 'What services are available?', try: '/services' }
  ]
}))

// Service catalog
app.get('/services', (c) => c.json({
  services: CHITTY_SERVICES,
  message: 'Available ChittyOS services. Tell me what you want to do!'
}))

// Main NL gateway endpoint
app.post('/ask', async (c) => {
  const ctx = c.get('chittyContext')
  const { query, conversationId } = await c.req.json<{ query: string; conversationId?: string }>()

  if (!query || typeof query !== 'string') {
    return c.json({ error: 'Query is required', code: 'QUERY_REQUIRED' }, 400)
  }

  try {
    // Classify intent using AI
    const intentResult = await classifyIntent(c.env, query, ctx)

    // Build response with guidance
    const response = buildGuidance(intentResult, query)

    // Log interaction for auditability
    await logAudit(c.env, createAuditEvent(
      ctx,
      'gateway.ask',
      'classify',
      '/ask',
      {
        intent: intentResult.intent,
        confidence: intentResult.confidence,
        status: 'success'
      }
    ))

    return c.json({
      contextId: ctx.id,
      requestId: ctx.requestId,
      ...response,
      _meta: {
        chittyId: ctx.chittyId,
        traceable: true
      }
    })
  } catch (err: any) {
    return c.json({
      error: 'Failed to process request',
      message: err.message,
      requestId: ctx.requestId
    }, 500)
  }
})

// Shorthand: GET with query param (public - allows anonymous)
app.get('/ask', async (c) => {
  const query = c.req.query('q')
  if (!query) {
    return c.json({
      message: 'Welcome to get.chitty.cc!',
      help: 'Tell me what you want to do with ChittyOS.',
      examples: [
        'I want to create a ChittyID',
        'How do I authenticate my service?',
        'What APIs are available?',
        'I need to connect my app to ChittyOS'
      ],
      usage: 'GET /ask?q=your+question or POST /ask with {"query": "your question"}'
    })
  }

  try {
    const ctx = c.get('chittyContext') || null
    const intentResult = await classifyIntent(c.env, query, ctx)
    const response = buildGuidance(intentResult, query)

    return c.json({
      requestId: crypto.randomUUID(),
      ...response
    })
  } catch (err: any) {
    return c.json({
      error: 'Failed to process request',
      message: err.message
    }, 500)
  }
})

// ============================================================
// AI ENDPOINTS - All conversations tied to ChittyID
// ============================================================

// AI chat - multi-provider (Workers AI, Claude, OpenAI)
// All interactions logged via ChittyContext for accountability
app.post('/api/ai/chat', async c => {
  const ctx = c.get('chittyContext')

  try {
    const body = await c.req.json<{
      messages: ChatMessage[]
      model?: string
      provider?: string
      temperature?: number
      conversationId?: string
    }>()

    // Use provided conversationId or create new
    const conversationId = body.conversationId || crypto.randomUUID()

    // Run AI with context
    const res = await runChittyAgent(
      c.env,
      body.messages,
      {
        model: body.model,
        temperature: body.temperature,
        provider: body.provider as any
      }
    )

    // Log AI usage via audit (traceable to ChittyID)
    await logAudit(c.env, createAuditEvent(
      ctx,
      'ai.chat',
      'generate',
      `/api/ai/chat`,
      {
        conversationId,
        provider: res.provider,
        model: res.model,
        inputTokens: res.usage?.prompt_tokens,
        outputTokens: res.usage?.completion_tokens,
        messageCount: body.messages.length,
        status: 'success'
      }
    ))

    return c.json({
      ...res,
      conversationId,
      contextId: ctx.id,
      requestId: ctx.requestId
    })
  } catch (err: any) {
    // Log error audit
    await logAudit(c.env, createAuditEvent(
      ctx,
      'ai.chat',
      'generate',
      `/api/ai/chat`,
      {
        status: 'error',
        errorMessage: err.message
      }
    ))

    return c.json({
      error: String(err?.message || 'invalid request'),
      requestId: ctx.requestId
    }, 400)
  }
})

// Get audit trail for conversation (filter by conversationId in metadata)
app.get('/api/ai/conversations/:conversationId', async c => {
  const ctx = c.get('chittyContext')
  const conversationId = c.req.param('conversationId')

  // Query audit events for this conversation
  const prefix = `audit:${ctx.chittyId}:`
  const list = await c.env.CHITTY_KV.list({ prefix, limit: 100 })

  const events: any[] = []
  for (const key of list.keys) {
    const data = await c.env.CHITTY_KV.get(key.name)
    if (data) {
      const event = JSON.parse(data)
      if (event.metadata?.conversationId === conversationId) {
        events.push(event)
      }
    }
  }

  return c.json({
    chittyId: ctx.chittyId,
    conversationId,
    events,
    count: events.length
  })
})

// ============================================================
// CHITTYBRAIN SEARCH - Centralized AI Search (RAG)
// ============================================================

// Initialize the central search index (Admin only)
app.post('/api/admin/search/init', async c => {
  const ctx = c.get('chittyContext')
  
  if (!c.env.CHITTY_SEARCH) {
    return c.json({ error: 'AI Search binding (CHITTY_SEARCH) is not configured' }, 501)
  }

  try {
    // Check if it already exists
    const { result } = await c.env.CHITTY_SEARCH.list()
    const exists = result.some((instance: any) => instance.id === 'chitty-brain')

    if (exists) {
      // Update existing instance to ensure hybrid search is active
      const updated = await c.env.CHITTY_SEARCH.get('chitty-brain').update({
        index_method: { vector: true, keyword: true },
        fusion_method: 'rrf',
        reranking: true,
        reranking_model: '@cf/baai/bge-reranker-base',
        rewrite_query: true
      })
      return c.json({ message: 'chitty-brain instance updated', config: updated })
    }

    // Create the central brain instance
    const instance = await c.env.CHITTY_SEARCH.create({
      id: 'chitty-brain',
      index_method: {
        vector: true,
        keyword: true
      },
      fusion_method: 'rrf',
      reranking: true,
      reranking_model: '@cf/baai/bge-reranker-base',
      rewrite_query: true,
      // Custom schema to support our new metadata filtering and boosting
      schema: {
        properties: {
          content: { type: "string" },
          is_agent_ready: { type: "boolean" },
          source_type: { type: "string" },
          url: { type: "string" },
          author: { type: "string" }
        }
      }
    })

    return c.json({ message: 'chitty-brain instance created successfully' })
  } catch (err: any) {
    return c.json({ error: 'Failed to initialize search instance', message: err.message }, 500)
  }
})

// Queue a document for background ingestion into AI Search
app.post('/api/admin/search/ingest', async c => {
  const ctx = c.get('chittyContext')
  const body = await c.req.json()

  if (!body.filename || !body.content) {
    return c.json({ error: 'Missing filename or content in request body' }, 400)
  }

  try {
    await c.env.CHITTY_TASKS.send({
      type: 'index.document',
      payload: {
        filename: body.filename,
        content: body.content
      }
    })
    
    // Audit the ingestion request
    await logAudit(c.env, createAuditEvent(
      ctx, 'ai.search', 'ingest.queued', '/api/admin/search/ingest', { filename: body.filename, status: 'queued' }
    ))

    return c.json({ message: 'Ingestion task queued successfully', filename: body.filename })
  } catch (err: any) {
    return c.json({ error: 'Failed to queue ingestion task', message: err.message }, 500)
  }
})

app.get('/api/search', async c => {
  const ctx = c.get('chittyContext')
  const query = c.req.query('q')

  if (!query) {
    return c.json({ error: 'Missing query parameter "q"' }, 400)
  }

  if (!c.env.CHITTY_SEARCH) {
    return c.json({ error: 'AI Search binding (CHITTY_SEARCH) is not configured' }, 501)
  }

  try {
    // We get a lazy handle to the global "chitty-ecosystem" instance
    // which holds marketplace JSONs, MCP docs, pentad files, etc.
    const instance = c.env.CHITTY_SEARCH.get("chitty-brain")
    
    // Hit the managed vector + hybrid search backend with built-in query rewriting
    // Inject the Prompt Normalizer/Enhancer as a system prompt to guide the retrieval and generation
    const systemPrompt = `You are the ChittyBrain context synthesizer. 
Analyze the user's query and extract the most relevant technical specifications, 
MCP capabilities, and architecture patterns from the knowledge base.
Format your response in structured Markdown, prioritizing exact configuration snippets, 
API endpoints, and tool specifications. 
Be concise and avoid conversational filler.`;

    const results = await instance.search({
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: query }
      ],
      ai_search_options: {
        retrieval: {
          retrieval_type: "hybrid",
          fusion_method: "rrf",
          // 1. Reranking (Cross-Encoder)
          reranking: true,
          reranking_model: "@cf/baai/bge-reranker-base",
          // 2. Query Rewriting (Expands short NLP into precise search vectors)
          rewrite_query: true,
          // 3. Metadata Filtering (Limit to agent-actionable context)
          filter: {
            "metadata.is_agent_ready": { "$eq": true }
          },
          // 4. Relevance Boosting (Prioritize highly authoritative MCP docs)
          boost: {
            "metadata.source_type": { "mcp_spec": 1.5, "official_doc": 1.2 }
          }
        },
        // 5. Similarity Caching (Bypass LLM for exact match repeated queries)
        cache: {
          similarity_threshold: 0.95
        }
      }
    })

    // Audit the search for traceability
    await logAudit(c.env, createAuditEvent(
      ctx,
      'ai.search',
      'query',
      '/api/search',
      { query, status: 'success' }
    ))

    return c.json({
      requestId: ctx.requestId,
      chittyId: ctx.chittyId,
      query,
      results
    })
  } catch (err: any) {
    // Audit failure
    await logAudit(c.env, createAuditEvent(
      ctx,
      'ai.search',
      'query',
      '/api/search',
      { query, status: 'error', errorMessage: err.message }
    ))
    return c.json({ error: 'Search failed', message: err.message }, 500)
  }
})

// ============================================================
// AUDIT ENDPOINTS - View your own audit trail
// ============================================================

// Get audit trail for current ChittyID
app.get('/api/audit', async c => {
  const ctx = c.get('chittyContext')
  const eventType = c.req.query('eventType')
  const limit = parseInt(c.req.query('limit') || '50', 10)

  // Query audit events from KV
  const prefix = `audit:${ctx.chittyId}:`
  const list = await c.env.CHITTY_KV.list({ prefix, limit })

  const events: any[] = []
  for (const key of list.keys) {
    const data = await c.env.CHITTY_KV.get(key.name)
    if (data) {
      const event = JSON.parse(data)
      if (!eventType || event.eventType === eventType) {
        events.push(event)
      }
    }
  }

  return c.json({
    chittyId: ctx.chittyId,
    events,
    count: events.length
  })
})

// ============================================================
// FILE ENDPOINTS
// ============================================================

// Signed R2 URL for uploads - tied to ChittyID
app.post('/api/files/signed-upload', async c => {
  const ctx = c.get('chittyContext')

  const key = `uploads/${ctx.chittyId}/${crypto.randomUUID()}`
  await c.env.CHITTY_KV.put(`reserved:${key}`, JSON.stringify({
    chittyId: ctx.chittyId,
    requestId: ctx.requestId,
    createdAt: new Date().toISOString()
  }), { expirationTtl: 600 })

  // Audit file reservation
  await logAudit(c.env, createAuditEvent(
    ctx,
    'file.upload',
    'reserve',
    key
  ))

  return c.json({ key, requestId: ctx.requestId })
})

// ============================================================
// APPROVAL WORKFLOW ENDPOINTS
// ============================================================

// Create approval request - triggers Workflow
app.post('/api/approvals', async c => {
  const ctx = c.get('chittyContext')

  try {
    const body = await c.req.json<{
      entityType: 'user' | 'service' | 'device'
      entityData: Record<string, any>
      approvers?: string[]
    }>()

    const requestId = crypto.randomUUID()

    // Create workflow instance with ChittyID context
    const instance = await c.env.APPROVAL_WORKFLOW.create({
      id: requestId,
      params: {
        requestId,
        chittyId: ctx.chittyId,        // Track who requested
        sessionId: ctx.sessionId,       // Track session
        entityType: body.entityType,
        entityData: body.entityData,
        requestedBy: ctx.chittyId,      // Use ChittyID as requestor
        approvers: body.approvers
      }
    })

    // Audit workflow creation
    await logAudit(c.env, createAuditEvent(
      ctx,
      'workflow.approval',
      'create',
      requestId,
      { workflowId: instance.id }
    ))

    return c.json({
      status: 'workflow_started',
      requestId,
      workflowId: instance.id,
      chittyId: ctx.chittyId
    }, 202)
  } catch (err: any) {
    return c.json({
      error: String(err?.message || 'invalid request'),
      requestId: ctx.requestId
    }, 400)
  }
})

// Get approval status
app.get('/api/approvals/:id', async c => {
  const ctx = c.get('chittyContext')
  const id = c.req.param('id')

  try {
    const instance = await c.env.APPROVAL_WORKFLOW.get(id)
    const status = await instance.status()
    const record = await c.env.CHITTY_KV.get(`approval:${id}`)
    const details = record ? JSON.parse(record) : null

    // Only allow viewing own approvals or if you're an approver
    if (details && details.chittyId !== ctx.chittyId &&
        !details.approvers?.includes(ctx.chittyId)) {
      return c.json({ error: 'Not authorized to view this approval' }, 403)
    }

    return c.json({
      requestId: id,
      workflowStatus: status.status,
      details
    })
  } catch (err: any) {
    return c.json({ error: 'Approval not found' }, 404)
  }
})

// Approve a pending request (external action)
app.post('/api/approvals/:id/approve', async c => {
  const ctx = c.get('chittyContext')
  const id = c.req.param('id')

  try {
    const record = await c.env.CHITTY_KV.get(`approval:${id}`)
    if (!record) {
      return c.json({ error: 'Approval not found' }, 404)
    }

    const data = JSON.parse(record)

    // Check if caller is an authorized approver
    if (!data.approvers?.includes(ctx.chittyId)) {
      return c.json({
        error: 'Not authorized to approve',
        message: 'Your ChittyID is not in the approvers list'
      }, 403)
    }

    data.status = 'approved'
    data.approvedAt = new Date().toISOString()
    data.approvedBy = ctx.chittyId

    await c.env.CHITTY_KV.put(`approval:${id}`, JSON.stringify(data))

    // Audit approval action
    await logAudit(c.env, createAuditEvent(
      ctx,
      'workflow.approval',
      'approve',
      id,
      { workflowId: data.workflowId }
    ))

    return c.json({
      status: 'approved',
      requestId: id,
      approvedBy: ctx.chittyId
    })
  } catch (err: any) {
    return c.json({ error: String(err?.message || 'failed') }, 400)
  }
})

// ============================================================
// AGENT PROXY - Routes to agent.chitty.cc with ChittyID
// ============================================================

app.all('/agent/*', async c => {
  const ctx = c.get('chittyContext')

  if (!c.env.AGENT_ORCHESTRATOR) {
    return c.json({ error: 'Agent orchestrator not bound' }, 503)
  }

  const path = c.req.path.replace('/agent', '')
  const url = new URL(path || '/', 'https://internal')
  url.search = new URL(c.req.url).search

  // Forward ChittyID context to agent
  const headers = new Headers(c.req.raw.headers)
  headers.set('X-Chitty-ID', ctx.chittyId)
  headers.set('X-Request-ID', ctx.requestId)
  headers.set('X-Session-ID', ctx.sessionId)

  const response = await c.env.AGENT_ORCHESTRATOR.fetch(url.toString(), {
    method: c.req.method,
    headers,
    body: c.req.raw.body
  })

  // Audit agent call
  await logAudit(c.env, createAuditEvent(
    ctx,
    'agent.proxy',
    c.req.method,
    path,
    { status: response.ok ? 'success' : 'error' }
  ))

  return new Response(response.body, {
    status: response.status,
    headers: response.headers
  })
})

// ============================================================
// NL GATEWAY HELPER FUNCTIONS
// ============================================================

/**
 * Classify user intent using AI
 */
async function classifyIntent(env: Env, query: string, ctx?: any): Promise<IntentResult> {
  let systemPrompt = `You are a routing assistant for ChittyOS. Analyze the user's query and classify their intent.

Available core services:
- identity (id.chitty.cc): ChittyID creation and management
- auth (auth.chitty.cc): Authentication, OAuth, tokens, API keys
- api (api.chitty.cc): API access, documentation
- connect (connect.chitty.cc): Service connections, integrations
- registry (registry.chitty.cc): Base service discovery
- schema (schema.chitty.cc): Schema validation
- agent (agent.chitty.cc): AI agents
- git (git.chitty.cc): Source repositories, clone repos, Git access

Available ecosystem tools & marketplaces:
- chittycan (cli.chitty.cc / npm i -g chittycan): The universal CLI for ChittyOS. Guides users to the terminal.
- chittymarket (market.chitty.cc): The open marketplace for community MCP servers, plugins, and free agents.
- chittypro (pro.chitty.cc): The premium ChittyPro™ marketplace for enterprise-grade LLM tooling, advanced agents, and SLA-backed services.

Respond with JSON only:
{
  "intent": "create_identity" | "authenticate" | "api_access" | "service_discovery" | "connect_service" | "clone_repo" | "general_help" | "install_cli" | "browse_market" | "browse_pro" | "unknown",
  "confidence": 0.0-1.0,
  "services": ["identity", "auth", "chittycan", "chittymarket", "chittypro", etc.],
  "steps": ["Step 1: ...", "Step 2: ..."],
  "commands": ["npm i -g chittycan", "can config setup", "can market pull", etc.] (optional),
  "endpoints": ["https://market.chitty.cc/...", "https://pro.chitty.cc/...", etc.] (optional)
}`

  // Dynamic Context Injection
  if (!ctx || !ctx.chittyId) {
    systemPrompt += `\n\nCRITICAL CONTEXT: The user making this request is currently ANONYMOUS. If the function or service they are asking for requires authorization or a ChittyID, Step 1 of your response MUST explicitly guide them to register at id.chitty.cc before proceeding to the actual steps.`
  } else {
    systemPrompt += `\n\nCRITICAL CONTEXT: The user is currently AUTHENTICATED with ChittyID: ${ctx.chittyId}. You do not need to ask them to register.`
  }

  const messages: ChatMessage[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: query }
  ]

  try {
    const result = await routeChat(env, messages, {
      model: '@cf/meta/llama-3.1-8b-instruct',
      maxTokens: 500
    })

    // Parse AI response
    const text = result.output.trim()
    const jsonMatch = text.match(/\{[\s\S]*\}/)
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]) as IntentResult
    }
  } catch (err) {
    console.error('AI classification failed:', err)
  }

  // Fallback: simple keyword matching
  return fallbackClassify(query)
}

/**
 * Fallback classification using keywords
 */
function fallbackClassify(query: string): IntentResult {
  const q = query.toLowerCase()

  if (q.includes('chittyid') || q.includes('identity') || q.includes('create') || q.includes('register')) {
    return {
      intent: 'create_identity',
      confidence: 0.7,
      services: ['identity', 'auth'],
      steps: [
        'Step 1: Go to id.chitty.cc to create your ChittyID',
        'Step 2: Complete verification at auth.chitty.cc',
        'Step 3: Your ChittyID will be provisioned'
      ],
      endpoints: ['https://id.chitty.cc/register', 'https://auth.chitty.cc/verify']
    }
  }

  if (q.includes('auth') || q.includes('login') || q.includes('token') || q.includes('oauth')) {
    return {
      intent: 'authenticate',
      confidence: 0.7,
      services: ['auth'],
      steps: [
        'Step 1: Authenticate at auth.chitty.cc',
        'Step 2: Obtain your access token',
        'Step 3: Include token in X-Chitty-Token header'
      ],
      endpoints: ['https://auth.chitty.cc/oauth/authorize', 'https://auth.chitty.cc/oauth/token']
    }
  }

  if (q.includes('api') || q.includes('endpoint') || q.includes('documentation')) {
    return {
      intent: 'api_access',
      confidence: 0.7,
      services: ['api'],
      steps: [
        'Step 1: Get your ChittyID and authenticate',
        'Step 2: Visit api.chitty.cc for documentation',
        'Step 3: Use your token to access endpoints'
      ],
      endpoints: ['https://api.chitty.cc/docs', 'https://api.chitty.cc/v1']
    }
  }

  if (q.includes('service') || q.includes('discover') || q.includes('available') || q.includes('what')) {
    return {
      intent: 'service_discovery',
      confidence: 0.6,
      services: ['registry'],
      steps: [
        'Step 1: Browse available services at registry.chitty.cc',
        'Step 2: Each service has its own documentation',
        'Step 3: Connect via connect.chitty.cc for integrations'
      ],
      endpoints: ['https://registry.chitty.cc/services', 'https://connect.chitty.cc']
    }
  }

  if (q.includes('connect') || q.includes('integrate') || q.includes('link')) {
    return {
      intent: 'connect_service',
      confidence: 0.7,
      services: ['connect'],
      steps: [
        'Step 1: Ensure you have a ChittyID',
        'Step 2: Register your service with registry.chitty.cc',
        'Step 3: Configure connection at connect.chitty.cc'
      ],
      endpoints: ['https://connect.chitty.cc/services', 'https://registry.chitty.cc/register']
    }
  }

  if (q.includes('git') || q.includes('clone') || q.includes('repo') || q.includes('source') || q.includes('code')) {
    return {
      intent: 'clone_repo',
      confidence: 0.7,
      services: ['git'],
      steps: [
        'Step 1: Browse available repos at git.chitty.cc',
        'Step 2: Clone with git clone https://git.chitty.cc/[org]/[repo]',
        'Step 3: Or use gh repo clone chittyos/[repo]'
      ],
      commands: [
        'git clone https://git.chitty.cc/chittyos/[repo-name]',
        'gh repo clone chittyos/[repo-name]'
      ],
      endpoints: ['https://git.chitty.cc', 'https://github.com/chittyos']
    }
  }

  return {
    intent: 'general_help',
    confidence: 0.5,
    services: ['registry'],
    steps: [
      'Step 1: Start by creating a ChittyID at id.chitty.cc',
      'Step 2: Authenticate at auth.chitty.cc',
      'Step 3: Explore services at registry.chitty.cc',
      'Step 4: Connect and build at api.chitty.cc'
    ]
  }
}

/**
 * Build user-friendly guidance from intent result
 */
function buildGuidance(intent: IntentResult, originalQuery: string): object {
  const serviceLinks = intent.services.map(s => ({
    name: s,
    url: `https://${CHITTY_SERVICES[s].domain}`,
    description: CHITTY_SERVICES[s].description
  }))

  return {
    understood: originalQuery,
    intent: intent.intent,
    confidence: intent.confidence,
    guidance: {
      steps: intent.steps,
      services: serviceLinks,
      ...(intent.commands && { commands: intent.commands }),
      ...(intent.endpoints && { endpoints: intent.endpoints })
    },
    next: intent.endpoints?.[0] || serviceLinks[0]?.url || 'https://id.chitty.cc'
  }
}

export default app
