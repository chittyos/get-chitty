import { ChatMessage, ChatOptions, ChatResult } from '../types'

export async function chatWorkersAI(env: any, messages: ChatMessage[], opts: ChatOptions = {}): Promise<ChatResult> {
  const model = opts.model || env.WORKERSAI_MODEL || '@cf/meta/llama-3.1-8b-instruct'
  const input = messages.map(m => `${m.role}: ${m.content}`).join('\n')

  // Prefer Workers AI binding if available
  if (env.AI && typeof env.AI.run === 'function') {
    const r = await env.AI.run(model, { prompt: input, temperature: opts.temperature ?? 0.2 })
    const output = r?.response || r?.text || ''
    return { provider: 'workersai', model, output }
  }

  // Fallback to REST API (requires account token; not recommended for prod)
  const accountId = env.CLOUDFLARE_ACCOUNT_ID
  const apiToken = env.CLOUDFLARE_API_TOKEN
  if (!accountId || !apiToken) throw new Error('Workers AI not bound (env.AI) and no REST credentials provided')
  const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${encodeURIComponent(model)}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'authorization': `Bearer ${apiToken}`
    },
    body: JSON.stringify({ prompt: input, temperature: opts.temperature ?? 0.2 })
  })
  if (!res.ok) throw new Error(`Workers AI error: ${res.status} ${await res.text()}`)
  const data: any = await res.json()
  const output = data?.result?.response || data?.result?.text || ''
  return { provider: 'workersai', model, output }
}
