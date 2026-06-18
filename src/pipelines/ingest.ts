// Queue consumer / pipeline entry for event ingestion and enrichment.

export interface Env {
  CHITTY_TASKS: Queue<any>
  CHITTY_DB: any
  CHITTY_VECTORS: any
  CHITTY_SEARCH: any // Cloudflare AI Search binding
}

export default {
  async queue(batch: MessageBatch<any>, env: Env, ctx: ExecutionContext) {
    for (const msg of batch.messages) {
      try {
        switch (msg.body?.type) {
          case 'approval.requested':
            // Optionally forward to workflow orchestrator or inline minimal handling
            break
          case 'index.document': {
            // Handles ingestion of marketplace registries, pentads, and architecture docs
            // Payload: { filename: string, content: string }
            if (env.CHITTY_SEARCH) {
              const instance = env.CHITTY_SEARCH.get('chitty-brain')
              const { filename, content } = msg.body.payload
              
              const encoder = new TextEncoder()
              const buffer = encoder.encode(content)
              
              // Upload to AI Search Items API for automatic chunking & indexing
              await instance.items.upload(filename, buffer.buffer)
              console.log(`Successfully ingested document: ${filename}`)
            } else {
              console.warn('CHITTY_SEARCH binding not configured, skipping ingestion.')
            }
            break
          }
          default:
            // no‑op
            break
        }
      } catch (err) {
        // Throw to let Workers retry and eventually DLQ
        throw err
      }
    }
  }
}

