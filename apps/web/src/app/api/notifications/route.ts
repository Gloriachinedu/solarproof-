import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createServiceClient } from '@/lib/supabase/service';
import { getSession } from '@/lib/auth/session';

export const dynamic = 'force-dynamic';

const notificationChannelSchema = z.enum(['in_app', 'email', 'webhook']);

const notificationEventSchema = z.enum([
  'certificate.issued',
  'certificate.verified',
  'certificate.failed',
  'certificate.retired',
]);

const preferencesSchema = z.object({
  channels: z.array(notificationChannelSchema).min(1).max(3),
  events: z.array(notificationEventSchema).min(1),
  email_address: z.string().email().nullable().optional(),
  webhook_url: z.string().url().nullable().optional(),
  enabled: z.boolean().optional(),
});

const historyQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  page_size: z.coerce.number().int().min(1).max(100).default(20),
  unread_only: z
    .union([z.literal('true'), z.literal('false'), z.literal('1'), z.literal('0')])
    .optional()
    .transform((value) => value === 'true' || value === '1'),
});

type NotificationPreferences = z.infer<typeof preferencesSchema>;

async function resolveCooperativeId(): Promise<
  { cooperativeId: string } | { error: NextResponse }
> {
  const session = await getSession();
  if (!session?.user) {
    return {
      error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
    };
  }

  const cooperativeId = session.user.cooperative_id;
  if (!cooperativeId) {
    return {
      error: NextResponse.json(
        { error: 'No cooperative associated with this account' },
        { status: 403 },
      ),
    };
  }

  return { cooperativeId };
}

export async function GET(request: NextRequest) {
  const resolved = await resolveCooperativeId();
  if ('error' in resolved) {
    return resolved.error;
  }
  const { cooperativeId } = resolved;

  const parsed = historyQuerySchema.safeParse(
    Object.fromEntries(request.nextUrl.searchParams.entries()),
  );
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid query parameters', details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const { page, page_size, unread_only } = parsed.data;
  const from = (page - 1) * page_size;
  const to = from + page_size - 1;

  const supabase = createServiceClient();

  let query = supabase
    .from('notifications')
    .select('*', { count: 'exact' })
    .eq('cooperative_id', cooperativeId)
    .order('created_at', { ascending: false })
    .range(from, to);

  if (unread_only) {
    query = query.is('read_at', null);
  }

  const { data, error, count } = await query;

  if (error) {
    return NextResponse.json(
      { error: 'Failed to load notification history', details: error.message },
      { status: 500 },
    );
  }

  const total = count ?? 0;

  return NextResponse.json({
    data: data ?? [],
    pagination: {
      page,
      page_size,
      total,
      total_pages: Math.ceil(total / page_size),
      has_more: to + 1 < total,
    },
  });
}

export async function PUT(request: NextRequest) {
  const resolved = await resolveCooperativeId();
  if ('error' in resolved) {
    return resolved.error;
  }
  const { cooperativeId } = resolved;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const parsed = preferencesSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid preferences', details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const preferences: NotificationPreferences = parsed.data;

  if (preferences.channels.includes('email') && !preferences.email_address) {
    return NextResponse.json(
      { error: 'email_address is required when the email channel is enabled' },
      { status: 400 },
    );
  }

  if (preferences.channels.includes('webhook') && !preferences.webhook_url) {
    return NextResponse.json(
      { error: 'webhook_url is required when the webhook channel is enabled' },
      { status: 400 },
    );
  }

  const supabase = createServiceClient();

  const { data, error } = await supabase
    .from('notification_preferences')
    .upsert(
      {
        cooperative_id: cooperativeId,
        channels: preferences.channels,
        events: preferences.events,
        email_address: preferences.email_address ?? null,
        webhook_url: preferences.webhook_url ?? null,
        enabled: preferences.enabled ?? true,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'cooperative_id' },
    )
    .select()
    .single();

  if (error) {
    return NextResponse.json(
      { error: 'Failed to save notification preferences', details: error.message },
      { status: 500 },
    );
  }

  return NextResponse.json({ data });
}