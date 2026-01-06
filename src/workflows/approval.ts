import { WorkflowEntrypoint, WorkflowStep, WorkflowEvent } from 'cloudflare:workers'

export interface ApprovalParams {
  requestId: string
  entityType: 'user' | 'service' | 'device'
  entityData: Record<string, any>
  requestedBy: string
  approvers?: string[]
}

export interface Env {
  CHITTY_DB: any
  CHITTY_KV: KVNamespace
  CHITTY_TASKS: Queue<any>
  AGENT_ORCHESTRATOR?: Fetcher // Service binding to agent.chitty.cc
}

/**
 * ApprovalWorkflow - Durable multi-step approval provisioning
 *
 * Steps:
 * 1. Validate request payload
 * 2. Persist initial approval request to DB
 * 3. Notify approvers (via agent.chitty.cc or direct)
 * 4. Wait for approval (with timeout)
 * 5. On approval: allocate ChittyID, generate credentials
 * 6. Persist results, write audit log
 * 7. Notify requestor of outcome
 */
export class ApprovalWorkflow extends WorkflowEntrypoint<Env, ApprovalParams> {

  async run(event: WorkflowEvent<ApprovalParams>, step: WorkflowStep) {
    const { requestId, entityType, entityData, requestedBy, approvers } = event.payload

    // Step 1: Validate request
    const validation = await step.do('validate-request', async () => {
      if (!requestId || !entityType || !entityData) {
        throw new Error('Missing required fields: requestId, entityType, entityData')
      }
      if (!['user', 'service', 'device'].includes(entityType)) {
        throw new Error(`Invalid entityType: ${entityType}`)
      }
      return { valid: true, timestamp: new Date().toISOString() }
    })

    // Step 2: Persist initial request to DB
    const dbRecord = await step.do('persist-request', async () => {
      // TODO: Use Hyperdrive binding to insert into approval_requests table
      // For now, store in KV as placeholder
      const record = {
        id: requestId,
        entityType,
        entityData,
        requestedBy,
        status: 'pending',
        createdAt: new Date().toISOString()
      }
      await this.env.CHITTY_KV.put(`approval:${requestId}`, JSON.stringify(record), { expirationTtl: 86400 * 7 })
      return record
    })

    // Step 3: Notify approvers via agent.chitty.cc (if bound)
    await step.do('notify-approvers', async () => {
      if (this.env.AGENT_ORCHESTRATOR && approvers?.length) {
        // Route through agent orchestrator to notification agent
        await this.env.AGENT_ORCHESTRATOR.fetch('https://internal/notify/approval', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            type: 'approval.requested',
            requestId,
            approvers,
            entityType,
            requestedBy
          })
        })
      }
      return { notified: approvers?.length ?? 0 }
    })

    // Step 4: Wait for approval (sleep with timeout - can be resumed by event)
    // In production, this would wait for an external signal
    await step.sleep('wait-for-approval', '1 hour')

    // Step 5: Check approval status and provision if approved
    const provisionResult = await step.do('provision-identity', async () => {
      const stored = await this.env.CHITTY_KV.get(`approval:${requestId}`)
      const record = stored ? JSON.parse(stored) : null

      if (!record) {
        return { provisioned: false, reason: 'Request not found' }
      }

      // Check if approved (in real impl, this would be set by approver action)
      if (record.status === 'approved') {
        // Generate ChittyID - format: VV-G-LLL-SSSS-T-YM-C-X
        const chittyId = generateChittyId(entityType)

        // Update record with provisioned identity
        record.status = 'provisioned'
        record.chittyId = chittyId
        record.provisionedAt = new Date().toISOString()
        await this.env.CHITTY_KV.put(`approval:${requestId}`, JSON.stringify(record))

        return { provisioned: true, chittyId }
      }

      return { provisioned: false, reason: `Status is ${record.status}` }
    })

    // Step 6: Write audit log
    await step.do('write-audit', async () => {
      await this.env.CHITTY_TASKS.send({
        type: 'audit.log',
        event: 'approval.workflow.completed',
        requestId,
        result: provisionResult,
        timestamp: new Date().toISOString()
      })
      return { logged: true }
    })

    // Step 7: Notify requestor of outcome
    await step.do('notify-outcome', async () => {
      if (this.env.AGENT_ORCHESTRATOR) {
        await this.env.AGENT_ORCHESTRATOR.fetch('https://internal/notify/outcome', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            type: 'approval.completed',
            requestId,
            requestedBy,
            result: provisionResult
          })
        })
      }
      return { notified: true }
    })

    return {
      requestId,
      status: provisionResult.provisioned ? 'provisioned' : 'not_provisioned',
      chittyId: provisionResult.chittyId,
      completedAt: new Date().toISOString()
    }
  }
}

/**
 * Generate a ChittyID in format: VV-G-LLL-SSSS-T-YM-C-X
 * Simplified version - real impl should use ChittyID service
 */
function generateChittyId(entityType: string): string {
  const version = '01'
  const group = entityType === 'user' ? 'U' : entityType === 'service' ? 'S' : 'D'
  const location = 'USA'
  const sequence = Math.random().toString(36).substring(2, 6).toUpperCase()
  const tier = '0'
  const yearMonth = new Date().toISOString().slice(2, 7).replace('-', '')
  const checksum = 'A'
  const suffix = 'X'

  return `${version}-${group}-${location}-${sequence}-${tier}-${yearMonth}-${checksum}-${suffix}`
}

export default ApprovalWorkflow
