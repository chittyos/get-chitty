import { ChatMessage, ChatOptions, ChatResult, Tool } from '../ai/types'
import { routeChat } from '../ai/router'

// Example tools (keep minimal; expand as needed)
const builtinTools: Tool[] = [
  {
    name: 'kv_get',
    description: 'Fetch a small string value from KV by key',
    parameters: {
      type: 'object',
      properties: { key: { type: 'string' } },
      required: ['key']
    },
    handler: async (args: any) => {
      return { value: await globalThis.env?.CHITTY_KV?.get(args.key) }
    }
  }
]

export async function runChittyAgent(env: any, messages: ChatMessage[], opts: ChatOptions = {}): Promise<ChatResult> {
  // Attach env for tools
  ;(globalThis as any).env = env

  // Basic RAG stub: you can add Vectorize lookup here and prepend context
  // const context = await searchVectorize(env, messages)
  // messages = [{ role: 'system', content: context }, ...messages]

  const tools = [...(opts.tools || []), ...builtinTools]
  const result = await routeChat(env, messages, { ...opts, tools })

  // If tool calls were returned, execute and re‑ask once with results
  if (result.toolCalls?.length) {
    const toolResults: any[] = []
    for (const call of result.toolCalls) {
      const tool = tools.find(t => t.name === call.name)
      if (!tool) continue
      const out = await tool.handler(call.args)
      toolResults.push({ name: call.name, args: call.args, result: out })
    }
    const followup: ChatMessage[] = [
      ...messages,
      { role: 'assistant', content: result.output || '' },
      { role: 'user', content: `Tool results: ${JSON.stringify(toolResults)}` }
    ]
    return routeChat(env, followup, { ...opts, tools: [] })
  }

  return result
}

