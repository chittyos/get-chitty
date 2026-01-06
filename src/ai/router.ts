import { ChatMessage, ChatOptions, ChatResult, Provider } from './types'
import { chatOpenAI } from './providers/openai'
import { chatAnthropic } from './providers/anthropic'
import { chatWorkersAI } from './providers/workersai'

export async function routeChat(env: any, messages: ChatMessage[], opts: ChatOptions = {}): Promise<ChatResult> {
  const provider = (opts.provider as Provider) || (env.DEFAULT_PROVIDER as Provider) || inferProvider(opts?.model) || 'workersai'
  switch (provider) {
    case 'openai':
      return chatOpenAI(env, messages, opts)
    case 'anthropic':
      return chatAnthropic(env, messages, opts)
    case 'workersai':
    default:
      return chatWorkersAI(env, messages, opts)
  }
}

function inferProvider(model?: string): Provider | undefined {
  if (!model) return
  if (model.startsWith('gpt-') || model.includes('openai')) return 'openai'
  if (model.startsWith('claude-')) return 'anthropic'
  if (model.startsWith('@cf/')) return 'workersai'
}
