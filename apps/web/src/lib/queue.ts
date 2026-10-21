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

export type JobType = 'anchor_and_mint' | 'retirement_report' | 'erc1888_issuance'
export type JobStatus = 'pending' | 'running' | 'done' | 'failed'

const QUEUE_NAME = 'stellar-transactions'
const REPORT_QUEUE_NAME = 'retirement-reports'
const BRIDGE_QUEUE_NAME = 'erc1888-issuance'

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

// Lazily-created queue for monthly retirement reports
let _reportQueue: Queue | null = null
function getReportQueue(): Queue {
  if (!_reportQueue) {
    _reportQueue = new Queue(REPORT_QUEUE_NAME, {
      connection: getRedisConnection() as never,
      defaultJobOptions: {
        attempts: 3,
        backoff: BACKOFF,
        removeOnComplete: { count: 500 },
        removeOnFail: false, // keep failed jobs for inspection (dead-letter)
      },
    })
  }
  return _reportQueue
}

// Lazily-created queue for Energy Web Chain ERC-1888 issuance
let _bridgeQueue: Queue | null = null
function getBridgeQueue(): Queue {
  if (!_bridgeQueue) {
    _bridgeQueue = new Queue(BRIDGE_QUEUE_NAME, {
      connection: getRedisConnection() as never,
      defaultJobOptions: {
        attempts: 3,
        backoff: BACKOFF,
        removeOnComplete: { count: 500 },
        removeOnFail: false, // keep failed jobs for inspection (dead-letter)
      },
    })
  }
  return _bridgeQueue
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

/**
 * Enqueue an ERC-1888 bridge issuance job for a newly-inserted certificate.
 *
 * This is fire-and-forget: failures here must never block the mint flow, so
 * errors are logged and swallowed. The certificate row's
 * `erc1888_issuance_status` is set to `'pending'` so the bridge worker can
 * pick it up and update it to `'issued'` / `'failed'`.
 */
export async function enqueueErc1888Issuance(certificateId: string): Promise<void> {
  try {
    const db = createServiceClient()
    await db
      .from('certificates')
      .update({ erc1888_issuance_status: 'pending' })
      .eq('id', certificateId)

    await getBridgeQueue().add(
      'erc1888_issuance',
      { certificateId },
      { jobId: `erc1888-${certificateId}` }
    )
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    logger.error('job.erc1888.enqueue_failed', { certificate_id: certificateId, error: message })
  }
}

/**
 * Schedule the monthly retirement report as a BullMQ repeatable job.
 *
 * Runs on the 1st of every month at 06:00 UTC and reports on the previous
 * calendar month. Safe to call multiple times — BullMQ deduplicates repeatable
 * jobs by their repeat key.
 */
export async function scheduleMonthlyRetirementReport(): Promise<void> {
  await getReportQueue().add(
    'retirement_report',
    {},
    {
      repeat: { pattern: '0 6 1 * *' },
      jobId: 'retirement-report-monthly',
    }
  )
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

  // Monthly retirement report worker
  const reportWorker = new Worker(REPORT_QUEUE_NAME, processRetirementReportJob, {
    connection: getRedisConnection() as never,
    concurrency: 1,
  })
  reportWorker.on('failed', (job, err) => {
    console.error(`[queue] report job ${job?.id} failed permanently`, err.message)
  })

  // ERC-1888 bridge issuance worker
  const bridgeWorker = new Worker(BRIDGE_QUEUE_NAME, processErc1888IssuanceJob, {
    connection: getRedisConnection() as never,
    concurrency: 2,
  })
  bridgeWorker.on('failed', (job, err) => {
    console.error(`[queue] bridge job ${job?.id} failed permanently`, err.message)
  })

  // Register the monthly repeatable schedule (idempotent).
  void scheduleMonthlyRetirementReport().catch((err) => {
    console.error('[queue] failed to schedule monthly retirement report', err)
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
    const result = await runAnchorAndMint(payload as unknown as AnchorAndMintPayload)
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

// ── Retirement report handler ────────────────────────────────────────────────

/**
 * Generate the previous month's retirement report for every cooperative and
 * email it to each cooperative admin.
 */
async function processRetirementReportJob(_job: Job): Promise<void> {
  const db = createServiceClient()
  const { buildRetirementReport } = await import('@/lib/retirement-report')
  const { sendRetirementReportEmail } = await import('@/lib/email')

  const now = new Date()
  const prev = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1))
  const month = `${prev.getUTCFullYear()}-${String(prev.getUTCMonth() + 1).padStart(2, '0')}`

  const { data: coops, error } = await db
    .from('cooperatives')
    .select('id, name, admin_email')
  if (error) throw new Error(`Failed to load cooperatives: ${error.message}`)

  for (const coop of coops ?? []) {
    const adminEmail = (coop as { admin_email?: string | null }).admin_email
    if (!adminEmail) continue
    try {
      const report = await buildRetirementReport(coop.id, month)
      await sendRetirementReportEmail({
        to: adminEmail,
        cooperativeName: (coop as { name?: string }).name ?? coop.id,
        month,
        report,
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      logger.error('job.retirement_report.failed', { cooperative_id: coop.id, month, error: message })
      throw err // let BullMQ retry / dead-letter
    }
  }
}

// ── ERC-1888 bridge issuance handler ─────────────────────────────────────────

/**
 * Issue an ERC-1888 EAC token on Energy Web Chain for a certificate and store
 * the resulting token ID back on the certificate record.
 */
async function processErc1888IssuanceJob(job: Job): Promise<void> {
  const db = createServiceClient()
  const { certificateId } = job.data as { certificateId: string }

  try {
    const { issueErc1888Token } = await import('@/lib/energyweb')
    const { tokenId } = await issueErc1888Token(certificateId)
    await db
      .from('certificates')
      .update({ erc1888_token_id: tokenId, erc1888_issuance_status: 'issued' })
      .eq('id', certificateId)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    const isFinal = job.attemptsMade + 1 >= (job.opts.attempts ?? 3)
    logger.error('job.erc1888.failed', { certificate_id: certificateId, error: message, final: isFinal })
    if (isFinal) {
      await db
        .from('certificates')
        .update({ erc1888_issuance_status: 'failed' })
        .eq('id', certificateId)
    }
    throw err
  }
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
    const { data: cert } = await db
      .from('certificates')
      .insert({
        cooperative_id: cooperativeId,
        reading_id: readingId,
        reading_hash: readingHashHex,
        anchor_tx_hash: anchorTxHash,
        mint_tx_hash: mintTxHash,
        kwh,
        issued_at: new Date().toISOString(),
        retired: false,
        erc1888_issuance_status: 'pending',
      })
      .select('id')
      .single()

    await invalidateCert(readingId, readingHashHex, mintTxHash)
    await fireWebhook(cooperativeId, 'anchor', { reading_id: readingId, anchor_tx_hash: anchorTxHash })
    await fireWebhook(cooperativeId, 'mint', { reading_id: readingId, mint_tx_hash: mintTxHash, kwh })

    // Trigger Energy Web Chain ERC-1888 issuance without blocking the mint flow.
    if (cert?.id) {
      await enqueueErc1888Issuance(cert.id)
    }
  }

  return { anchor_tx_hash: anchorTxHash, mint_tx_hash: mintTxHash }
}
