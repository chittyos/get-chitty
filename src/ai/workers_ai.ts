// Minimal helpers for Workers AI integration.
// Wire this into /api/ai/* endpoints in src/edge/worker.ts.

export type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string }

export interface AiEnv {
  // When Workers AI is enabled, many accounts expose `env.AI` for @cloudflare/ai
  // Declare as any to avoid coupling here. Configure in wrangler/secrets.
  AI?: any
}

export async function runChat(env: AiEnv, messages: ChatMessage[]): Promise<string> {
  // Placeholder: integrate with Workers AI SDK or AI Gateway.
  // Example (Workers AI):
  //   import { Ai } from '@cloudflare/ai'
  //   const ai = new Ai(env.AI)
  //   const res = await ai.run('@cf/meta/llama-3-8b-instruct', { messages })
  //   return res.response
  return 'AI integration not yet configured'
}

