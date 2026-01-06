import { ChatMessage, ChatOptions, ChatResult } from '../types'

export async function chatAnthropic(env: any, messages: ChatMessage[], opts: ChatOptions = {}): Promise<ChatResult> {
  const base = env.AI_GATEWAY_BASE?.toString().replace(/\/$/, '')
  if (!base) throw new Error('AI_GATEWAY_BASE not configured')
  if (!env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY not configured')

  const system = messages.find(m => m.role === 'system')?.content
  const msgs = messages.filter(m => m.role !== 'system').map(m => ({ role: m.role, content: [{ type: 'text', text: m.content }] }))

  const body: any = {
    model: opts.model || env.ANTHROPIC_MODEL || 'claude-3-5-sonnet-20241022',
    max_tokens: opts.maxTokens ?? 1024,
    temperature: opts.temperature ?? 0.2,
    system,
    messages: msgs
  }

  if (opts.tools?.length) {
    body.tools = opts.tools.map(t => ({ name: t.name, description: t.description, input_schema: t.parameters ?? {} }))
    body.tool_choice = 'auto'
  }

  const res = await fetch(`${base}/anthropic/messages`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify(body)
  })

  if (!res.ok) throw new Error(`Anthropic error: ${res.status} ${await res.text()}`)
  const data: any = await res.json()
  const txt = data.content?.find((p: any) => p.type === 'text')?.text ?? ''

  const toolCalls = data?.content?.filter((p: any) => p.type === 'tool_use')?.map((p: any) => ({
    name: p.name,
    args: p.input || {}
  }))

  return {
    provider: 'anthropic',
    model: body.model,
    output: txt,
    toolCalls,
    usage: data.usage
  }
}

