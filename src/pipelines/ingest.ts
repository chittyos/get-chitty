// Queue consumer / pipeline entry for event ingestion and enrichment.

export interface Env {
  CHITTY_TASKS: Queue<any>
  CHITTY_DB: any
  CHITTY_VECTORS: any
}

export default {
  async queue(batch: MessageBatch<any>, env: Env, ctx: ExecutionContext) {
    for (const msg of batch.messages) {
      try {
        switch (msg.body?.type) {
          case 'approval.requested':
            // Optionally forward to workflow orchestrator or inline minimal handling
            break
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

