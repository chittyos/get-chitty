import { ChatMessage, ChatOptions, ChatResult } from '../types'

export async function chatOpenAI(env: any, messages: ChatMessage[], opts: ChatOptions = {}): Promise<ChatResult> {
  const base = env.AI_GATEWAY_BASE?.toString().replace(/\/$/, '')
  if (!base) throw new Error('AI_GATEWAY_BASE not configured')
  if (!env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY not configured')

  const body: any = {
    model: opts.model || env.OPENAI_MODEL || 'gpt-4o-mini',
    messages: messages.map(m => ({ role: m.role, content: m.content })),
    temperature: opts.temperature ?? 0.2,
    tools: opts.tools?.length ? opts.tools.map(t => ({
      type: 'function',
      function: { name: t.name, description: t.description, parameters: t.parameters ?? {} }
    })) : undefined
  }

  const res = await fetch(`${base}/openai/chat/completions`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'authorization': `Bearer ${env.OPENAI_API_KEY}`
    },
    body: JSON.stringify(body)
  })

  if (!res.ok) throw new Error(`OpenAI error: ${res.status} ${await res.text()}`)
  const data: any = await res.json()
  const choice = data.choices?.[0]
  const output = choice?.message?.content ?? ''
  const toolCalls = choice?.message?.tool_calls?.map((tc: any) => ({
    name: tc.function?.name,
    args: tc.function?.arguments ? safeJson(tc.function.arguments) : {}
  }))

  return {
    provider: 'openai',
    model: body.model,
    output,
    toolCalls,
    usage: data.usage
  }
}

function safeJson(s: string) {
  try { return JSON.parse(s) } catch { return {} }
}

