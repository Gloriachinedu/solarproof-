import { createClient, SupabaseClient } from '@supabase/supabase-js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type CertificateEventType = 'issued' | 'verified' | 'failed' | 'retired';

export type NotificationChannel = 'in_app' | 'email' | 'webhook';

export type DeliveryStatus = 'pending' | 'sent' | 'failed';

export interface NotificationPreferences {
  id?: string;
  cooperative_id: string;
  in_app_enabled: boolean;
  email_enabled: boolean;
  webhook_enabled: boolean;
  email_address?: string | null;
  webhook_url?: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface NotificationRow {
  id: string;
  cooperative_id: string;
  event_type: CertificateEventType;
  certificate_id: string;
  title: string;
  body: string;
  data: Record<string, unknown> | null;
  read: boolean;
  created_at: string;
}

export interface NotificationDeliveryRow {
  id: string;
  notification_id: string;
  cooperative_id: string;
  channel: NotificationChannel;
  status: DeliveryStatus;
  attempts: number;
  max_attempts: number;
  next_attempt_at: string | null;
  last_error: string | null;
  payload: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}

export interface EmitCertificateEventResult {
  notification: NotificationRow | null;
  deliveries: NotificationDeliveryRow[];
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_ATTEMPTS = 3;
// Exponential back-off schedule (in ms) for retries: 2s, 4s, 8s.
const RETRY_BACKOFF_MS = [2000, 4000, 8000];

// ---------------------------------------------------------------------------
// Supabase client (lazy singleton)
// ---------------------------------------------------------------------------

let cachedClient: SupabaseClient | null = null;

function getClient(): SupabaseClient {
  if (cachedClient) return cachedClient;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !key) {
    throw new Error(
      'Supabase credentials are not configured. Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (or NEXT_PUBLIC_SUPABASE_ANON_KEY).',
    );
  }

  cachedClient = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return cachedClient;
}

// ---------------------------------------------------------------------------
// Delivery helpers (email / webhook)
// ---------------------------------------------------------------------------

interface EmailPayload {
  to: string;
  subject: string;
  body: string;
  data?: Record<string, unknown> | null;
}

interface WebhookPayload {
  url: string;
  event: string;
  notification: Record<string, unknown>;
}

/**
 * Sends an email via the configured email provider.
 * Throws on failure so the caller can schedule a retry.
 */
export async function sendEmail(payload: EmailPayload): Promise<void> {
  const apiKey = process.env.EMAIL_API_KEY;
  const from = process.env.EMAIL_FROM ?? 'notifications@example.com';

  if (!apiKey) {
    throw new Error('EMAIL_API_KEY is not configured; cannot send email.');
  }

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from,
      to: payload.to,
      subject: payload.subject,
      text: payload.body,
    }),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(
      `Email delivery failed (${response.status}): ${text || response.statusText}`,
    );
  }
}

/**
 * Fires a webhook POST request.
 * Throws on non-2xx responses so the caller can schedule a retry.
 */
export async function fireWebhook(payload: WebhookPayload): Promise<void> {
  const response = await fetch(payload.url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      event: payload.event,
      notification: payload.notification,
      timestamp: new Date().toISOString(),
    }),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(
      `Webhook delivery failed (${response.status}): ${text || response.statusText}`,
    );
  }
}

// ---------------------------------------------------------------------------
// Event formatting
// ---------------------------------------------------------------------------

const EVENT_TITLES: Record<CertificateEventType, string> = {
  issued: 'Certificate issued',
  verified: 'Certificate verified',
  failed: 'Certificate verification failed',
  retired: 'Certificate retired',
};

function buildNotificationContent(
  eventType: CertificateEventType,
  certificateId: string,
  data: Record<string, unknown> | null,
): { title: string; body: string } {
  const title = EVENT_TITLES[eventType] ?? 'Certificate update';
  const subjectName =
    (data && (data.subject_name as string | undefined)) ??
    (data && (data.product_name as string | undefined)) ??
    null;

  const parts: string[] = [];
  parts.push(`Certificate ${certificateId} was ${eventType}.`);
  if (subjectName) {
    parts.push(`Subject: ${subjectName}.`);
  }
  if (data && typeof data.message === 'string' && data.message) {
    parts.push(data.message);
  }

  return { title, body: parts.join(' ') };
}

// ---------------------------------------------------------------------------
// emitCertificateEvent
// ---------------------------------------------------------------------------

/**
 * Emits a certificate lifecycle event to the notification delivery layer.
 *
 * - Loads the cooperative's notification preferences.
 * - Inserts a `notifications` row when in-app notifications are enabled.
 * - Creates `notification_deliveries` rows for email and webhook channels.
 *
 * Returns the created notification (if any) and the queued deliveries.
 */
export async function emitCertificateEvent(
  cooperative_id: string,
  event_type: CertificateEventType,
  certificate_id: string,
  data: Record<string, unknown> = {},
): Promise<EmitCertificateEventResult> {
  const supabase = getClient();
  const payload = data ?? {};

  // 1. Load notification preferences.
  const { data: prefs, error: prefsError } = await supabase
    .from('notification_preferences')
    .select('*')
    .eq('cooperative_id', cooperative_id)
    .maybeSingle<NotificationPreferences>();

  if (prefsError) {
    throw new Error(
      `Failed to load notification preferences: ${prefsError.message}`,
    );
  }

  // Default to in-app only when no preferences exist.
  const preferences: NotificationPreferences = prefs ?? {
    cooperative_id,
    in_app_enabled: true,
    email_enabled: false,
    webhook_enabled: false,
  };

  const { title, body } = buildNotificationContent(
    event_type,
    certificate_id,
    payload,
  );

  let notification: NotificationRow | null = null;

  // 2. Insert in-app notification when enabled.
  if (preferences.in_app_enabled) {
    const { data: inserted, error: insertError } = await supabase
      .from('notifications')
      .insert({
        cooperative_id,
        event_type,
        certificate_id,
        title,
        body,
        data: payload,
        read: false,
      })
      .select('*')
      .single<NotificationRow>();

    if (insertError) {
      throw new Error(
        `Failed to create notification: ${insertError.message}`,
      );
    }
    notification = inserted;
  }

  // 3. Build delivery rows for email / webhook channels.
  const deliveriesToInsert: Array<Record<string, unknown>> = [];

  if (preferences.email_enabled && preferences.email_address) {
    deliveriesToInsert.push({
      notification_id: notification?.id ?? null,
      cooperative_id,
      channel: 'email',
      status: 'pending',
      attempts: 0,
      max_attempts: MAX_ATTEMPTS,
      next_attempt_at: new Date().toISOString(),
      last_error: null,
      payload: {
        to: preferences.email_address,
        subject: title,
        body,
        data: payload,
        event_type,
        certificate_id,
      },
    });
  }

  if (preferences.webhook_enabled && preferences.webhook_url) {
    deliveriesToInsert.push({
      notification_id: notification?.id ?? null,
      cooperative_id,
      channel: 'webhook',
      status: 'pending',
      attempts: 0,
      max_attempts: MAX_ATTEMPTS,
      next_attempt_at: new Date().toISOString(),
      last_error: null,
      payload: {
        url: preferences.webhook_url,
        event: `certificate.${event_type}`,
        notification: {
          id: notification?.id ?? null,
          cooperative_id,
          event_type,
          certificate_id,
          title,
          body,
          data: payload,
        },
      },
    });
  }

  let deliveries: NotificationDeliveryRow[] = [];

  if (deliveriesToInsert.length > 0) {
    const { data: insertedDeliveries, error: deliveryError } = await supabase
      .from('notification_deliveries')
      .insert(deliveriesToInsert)
      .select('*');

    if (deliveryError) {
      throw new Error(
        `Failed to create notification deliveries: ${deliveryError.message}`,
      );
    }
    deliveries = (insertedDeliveries ?? []) as NotificationDeliveryRow[];
  }

  return { notification, deliveries };
}

// ---------------------------------------------------------------------------
// processDelivery
// ---------------------------------------------------------------------------

/**
 * Processes a single notification delivery.
 *
 * Dispatches via the appropriate channel helper, updates status/attempts,
 * and on failure schedules a retry with exponential back-off
 * (2s, 4s, 8s) up to 3 attempts. Marks the delivery failed after exhaustion.
 */
export async function processDelivery(
  deliveryId: string,
): Promise<NotificationDeliveryRow> {
  const supabase = getClient();

  const { data: delivery, error: fetchError } = await supabase
    .from('notification_deliveries')
    .select('*')
    .eq('id', deliveryId)
    .single<NotificationDeliveryRow>();

  if (fetchError || !delivery) {
    throw new Error(
      `Failed to load delivery ${deliveryId}: ${
        fetchError?.message ?? 'not found'
      }`,
    );
  }

  // Skip deliveries that are already terminal.
  if (delivery.status === 'sent' || delivery.status === 'failed') {
    return delivery;
  }

  const attempt = delivery.attempts + 1;
  const payload = (delivery.payload ?? {}) as Record<string, any>;

  try {
    if (delivery.channel === 'email') {
      await sendEmail({
        to: payload.to,
        subject: payload.subject,
        body: payload.body,
        data: payload.data ?? null,
      });
    } else if (delivery.channel === 'webhook') {
      await fireWebhook({
        url: payload.url,
        event: payload.event,
        notification: payload.notification ?? {},
      });
    } else {
      throw new Error(`Unsupported delivery channel: ${delivery.channel}`);
    }

    // Success.
    const { data: updated, error: updateError } = await supabase
      .from('notification_deliveries')
      .update({
        status: 'sent',
        attempts: attempt,
        next_attempt_at: null,
        last_error: null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', deliveryId)
      .select('*')
      .single<NotificationDeliveryRow>();

    if (updateError) {
      throw new Error(
        `Failed to mark delivery ${deliveryId} as sent: ${updateError.message}`,
      );
    }
    return updated;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const maxAttempts = delivery.max_attempts ?? MAX_ATTEMPTS;
    const exhausted = attempt >= maxAttempts;

    const backoffMs = exhausted
      ? null
      : RETRY_BACKOFF_MS[Math.min(attempt - 1, RETRY_BACKOFF_MS.length - 1)];

    const nextAttemptAt =
      backoffMs !== null
        ? new Date(Date.now() + backoffMs).toISOString()
        : null;

    const { data: updated, error: updateError } = await supabase
      .from('notification_deliveries')
      .update({
        status: exhausted ? 'failed' : 'pending',
        attempts: attempt,
        next_attempt_at: nextAttemptAt,
        last_error: message,
        updated_at: new Date().toISOString(),
      })
      .eq('id', deliveryId)
      .select('*')
      .single<NotificationDeliveryRow>();

    if (updateError) {
      throw new Error(
        `Failed to update delivery ${deliveryId} after error: ${updateError.message}`,
      );
    }
    return updated;
  }
}

// ---------------------------------------------------------------------------
// History helpers
// ---------------------------------------------------------------------------

export interface NotificationHistoryOptions {
  limit?: number;
  offset?: number;
  eventType?: CertificateEventType;
  unreadOnly?: boolean;
}

export interface NotificationHistoryResult {
  notifications: NotificationRow[];
  total: number;
}

/**
 * Fetches notification history for a cooperative, newest first.
 */
export async function getNotificationHistory(
  cooperative_id: string,
  options: NotificationHistoryOptions = {},
): Promise<NotificationHistoryResult> {
  const supabase = getClient();
  const limit = options.limit ?? 50;
  const offset = options.offset ?? 0;

  let query = supabase
    .from('notifications')
    .select('*', { count: 'exact' })
    .eq('cooperative_id', cooperative_id)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (options.eventType) {
    query = query.eq('event_type', options.eventType);
  }
  if (options.unreadOnly) {
    query = query.eq('read', false);
  }

  const { data, error, count } = await query;

  if (error) {
    throw new Error(
      `Failed to fetch notification history: ${error.message}`,
    );
  }

  return {
    notifications: (data ?? []) as NotificationRow[],
    total: count ?? 0,
  };
}

/**
 * Marks a notification as read.
 */
export async function markNotificationRead(
  notificationId: string,
): Promise<void> {
  const supabase = getClient();
  const { error } = await supabase
    .from('notifications')
    .update({ read: true })
    .eq('id', notificationId);

  if (error) {
    throw new Error(`Failed to mark notification as read: ${error.message}`);
  }
}

/**
 * Fetches pending deliveries that are due for processing.
 * Useful for a cron/worker that drains the delivery queue.
 */
export async function getDueDeliveries(
  limit = 50,
): Promise<NotificationDeliveryRow[]> {
  const supabase = getClient();
  const now = new Date().toISOString();

  const { data, error } = await supabase
    .from('notification_deliveries')
    .select('*')
    .eq('status', 'pending')
    .lte('next_attempt_at', now)
    .order('next_attempt_at', { ascending: true })
    .limit(limit);

  if (error) {
    throw new Error(`Failed to fetch due deliveries: ${error.message}`);
  }

  return (data ?? []) as NotificationDeliveryRow[];
}