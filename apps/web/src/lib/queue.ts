/**
 * Job queue powered by BullMQ + Redis.
 *
 * - `enqueue` adds a job to Redis and returns the job ID immediately.
 * - A `Worker` processes jobs asynchronously outside the HTTP request cycle.
 * - Failed jobs are retried up to 3 times with exponential back-off.
 * - Jobs that exhaust all attempts land in BullMQ's built-in failed set
 *   (acts as the dead-letter queue).
 *
 * The Supabase `jobs` table is kept in sync so callers can poll
 * `GET /api/jobs/:id` for status via the existing HTTP endpoint.
 */
import { Queue, Worker, type Job } from 'bullmq'
import { createServiceClient } from '@/lib/supabase'
import { getRedisConnection } from '@/lib/redis'
import { logger } from '@/lib/logger'
import { AppError } from '@/lib/errors'

export type JobType = 'anchor_and_mint' | 'notification_delivery'
export type JobStatus = 'pending' | 'running' | 'done' | 'failed'

const QUEUE_NAME = 'stellar-transactions'

const BACKOFF = {
  type: 'exponential' as const,
  delay: 2_000, // 2 s → 4 s → 8 s
}

// Lazily-created queue instance (safe to call during SSR/build)
let _queue: Queue | null = null
function getQueue(): Queue {
  if (!_queue) {
    _queue = new Queue(QUEUE_NAME, {
      connection: getRedisConnection() as never,
      defaultJobOptions: {
        attempts: 3,
        backoff: BACKOFF,
        removeOnComplete: { count: 500 },
        removeOnFail: false, // keep failed jobs for inspection (dead-letter)
      },
    })
  }
  return _queue
}

/**
 * Enqueue a background job and return its BullMQ job ID immediately.
 *
 * The reading has already been persisted before this call; this only
 * schedules the Stellar anchor + mint step asynchronously.
 *
 * @returns BullMQ job ID (string).
 */
export async function enqueue(
  type: JobType,
  payload: Record<string, unknown>
): Promise<string> {
  const db = createServiceClient()

  // Persist a job record so the HTTP poll endpoint works immediately
  const { data, error } = await db
    .from('jobs')
    .insert({ type, payload: payload as import('@/lib/database.types').Json, status: 'pending', attempts: 0 })
    .select('id')
    .single()

  if (error || !data) throw new Error(`Failed to persist job: ${error?.message}`)

  const dbJobId: string = data.id

  // Push to Redis queue; use the Supabase UUID as the BullMQ job name
  // so we can correlate them.
  await getQueue().add(type, { ...payload, dbJobId }, { jobId: dbJobId })

  return dbJobId
}

// ── Worker (runs in the same Node process for simplicity) ────────────────────

/**
 * Process a single job by ID, retrying up to `MAX_ATTEMPTS` times on failure.
 *
 * Retries use exponential back-off (2 s, 4 s, 8 s). After all attempts are
 * exhausted the job is marked `'failed'` and moved to the dead-letter queue.
 *
 * Call once from `apps/web/src/instrumentation.ts` (server-side only).
 */
export function startWorker(): Worker {
  const worker = new Worker(QUEUE_NAME, processJob, {
    connection: getRedisConnection() as never,
    concurrency: 2,
  })

  worker.on('failed', (job, err) => {
    console.error(`[queue] job ${job?.id} failed permanently`, err.message)
  })

  return worker
}

// ── Job handler ──────────────────────────────────────────────────────────────

async function processJob(job: Job): Promise<void> {
  const db = createServiceClient()
  const { dbJobId, ...payload } = job.data as Record<string, unknown> & { dbJobId: string }

  // Mark running in Supabase
  await db.from('jobs').update({ status: 'running', attempts: job.attemptsMade + 1 }).eq('id', dbJobId)

  try {
    const result = await runJob(job.name as JobType, payload)
    await db.from('jobs').update({ status: 'done', result: result as import('@/lib/database.types').Json }).eq('id', dbJobId)
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err)
    const category = err instanceof AppError ? err.category : 'INTERNAL'
    const isFinal = job.attemptsMade + 1 >= (job.opts.attempts ?? 3)
    logger.error('job.failed', { dbJobId, category, error: errorMsg, attempt: job.attemptsMade + 1, final: isFinal })
    await db
      .from('jobs')
      .update({ status: isFinal ? 'failed' : 'pending', error: errorMsg })
      .eq('id', dbJobId)
    throw err // re-throw so BullMQ applies back-off / moves to failed set
  }
}

// ── Job routing ──────────────────────────────────────────────────────────────

async function runJob(type: JobType, payload: Record<string, unknown>): Promise<Record<string, unknown>> {
  switch (type) {
    case 'anchor_and_mint':
      return runAnchorAndMint(payload as unknown as AnchorAndMintPayload)
    case 'notification_delivery':
      return runNotificationDelivery(payload as unknown as NotificationDeliveryPayload)
    default:
      throw new AppError(`Unknown job type: ${String(type)}`, 'INTERNAL')
  }
}

// ── Notification delivery handler ────────────────────────────────────────────

interface NotificationDeliveryPayload {
  deliveryId: string
}

async function runNotificationDelivery(payload: NotificationDeliveryPayload): Promise<Record<string, unknown>> {
  const { processDelivery } = await import('@/lib/notifications')
  const result = await processDelivery(payload.deliveryId)
  return { delivery_id: payload.deliveryId, status: result.status }
}

// ── Anchor-and-mint handler ──────────────────────────────────────────────────

interface AnchorAndMintPayload {
  readingId: string
  readingHashHex: string
  recipientAddress: string
  kwh: number
  correlationId?: string
}

async function runAnchorAndMint(payload: AnchorAndMintPayload): Promise<Record<string, unknown>> {
  const { anchorReading, mintCertificates } = await import('@/lib/stellar')
  const { createServiceClient: svc } = await import('@/lib/supabase')
  const { invalidateCert } = await import('@/lib/cache')
  const { fireWebhook } = await import('@/lib/webhooks')

  const { readingId, readingHashHex, recipientAddress, kwh, correlationId } = payload
  const db = svc()
  const readingHash = Buffer.from(readingHashHex, 'hex')
  // Re-read the reading record to handle duplicates / already-processed entries
  const { data: existing } = await db.from('readings').select('anchored, anchor_tx_hash, minted, mint_tx_hash').eq('id', readingId).maybeSingle()
  if (existing) {
    if (existing.anchored && existing.minted) {
      return { anchor_tx_hash: existing.anchor_tx_hash, mint_tx_hash: existing.mint_tx_hash }
    }
  }

  const log = correlationId ? logger.withCorrelationId(correlationId) : logger

  log.info('job.anchor.start', { reading_id: readingId, reading_hash: readingHashHex })
  let anchorTxHash: string
  try {
    anchorTxHash = await anchorReading({ readingHash, correlationId })
    await db.from('readings').update({ anchored: true, anchor_tx_hash: anchorTxHash }).eq('id', readingId)
    log.info('job.anchor.success', { reading_id: readingId, anchor_tx_hash: anchorTxHash })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    const category = err instanceof AppError ? err.category : 'INTERNAL'
    log.error('job.anchor.failed', { reading_id: readingId, category, error: message })
    throw err
  }

  log.info('job.mint.start', { reading_id: readingId, recipient: recipientAddress, kwh })
  let mintTxHash: string
  try {
    mintTxHash = await mintCertificates(recipientAddress, kwh, correlationId)
    await db.from('readings').update({ minted: true, mint_tx_hash: mintTxHash }).eq('id', readingId)
    log.info('job.mint.success', { reading_id: readingId, mint_tx_hash: mintTxHash })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    const category = err instanceof AppError ? err.category : 'INTERNAL'
    log.error('job.mint.failed', { reading_id: readingId, category, error: message })

    // Dispatch certificate-failed notifications (best-effort; never mask the error)
    try {
      const { data: failedReading } = await db
        .from('readings')
        .select('meters(cooperative_id)')
        .eq('id', readingId)
        .maybeSingle()
      const failedCoopId = (failedReading?.meters as { cooperative_id: string } | null)?.cooperative_id
      if (failedCoopId) {
        const { emitCertificateEvent } = await import('@/lib/notifications')
        await emitCertificateEvent(failedCoopId, 'failed', {
          reading_id: readingId,
          error: message,
          category,
        })
      }
    } catch (notifyErr) {
      const notifyMsg = notifyErr instanceof Error ? notifyErr.message : String(notifyErr)
      log.error('job.notify.failed.failed', { reading_id: readingId, error: notifyMsg })
    }

    throw err
  }

  // Fetch cooperative_id for certificate insert and webhooks
  const { data: reading } = await db
    .from('readings')
    .select('meter_id, meters(cooperative_id)')
    .eq('id', readingId)
    .single()

  const cooperativeId = (reading?.meters as { cooperative_id: string } | null)?.cooperative_id
  if (cooperativeId) {
    await db.from('certificates').insert({
      cooperative_id: cooperativeId,
      reading_id: readingId,
      reading_hash: readingHashHex,
      anchor_tx_hash: anchorTxHash,
      mint_tx_hash: mintTxHash,
      kwh,
      issued_at: new Date().toISOString(),
      retired: false,
    })
    await invalidateCert(readingId, readingHashHex, mintTxHash)
    await fireWebhook(cooperativeId, 'anchor', { reading_id: readingId, anchor_tx_hash: anchorTxHash })
    await fireWebhook(cooperativeId, 'mint', { reading_id: readingId, mint_tx_hash: mintTxHash, kwh })

    // Dispatch certificate-issued notifications (best-effort; never fail the job)
    try {
      const { emitCertificateEvent } = await import('@/lib/notifications')
      await emitCertificateEvent(cooperativeId, 'issued', {
        reading_id: readingId,
        anchor_tx_hash: anchorTxHash,
        mint_tx_hash: mintTxHash,
        kwh,
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      log.error('job.notify.issued.failed', { reading_id: readingId, error: message })
    }
  }

  return { anchor_tx_hash: anchorTxHash, mint_tx_hash: mintTxHash }
}
