export type Role = 'system' | 'user' | 'assistant'
export type ChatMessage = { role: Role; content: string }

export type Provider = 'workersai' | 'openai' | 'anthropic'

export interface ChatOptions {
  model?: string
  temperature?: number
  maxTokens?: number
  tools?: Tool[]
  provider?: Provider
}

export type Tool = {
  name: string
  description?: string
  // For simplicity we use any; real impls can use Zod/JSON Schema
  parameters?: any
  handler: (args: any) => Promise<any>
}

export interface ChatResult {
  provider: Provider
  model: string
  output: string
  toolCalls?: { name: string; args: any; result?: any }[]
  usage?: Record<string, number>
}
