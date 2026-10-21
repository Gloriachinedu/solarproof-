import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { sendApiKeyExpiryEmail } from '@/lib/email/sendApiKeyExpiryEmail';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const EXPIRY_WINDOW_DAYS = 7;

interface MeterRow {
  id: string;
  name: string | null;
  api_key_expires_at: string | null;
  cooperative_id: string | null;
}

interface CooperativeRow {
  id: string;
  name: string | null;
  admin_email: string | null;
}

function getSupabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    throw new Error(
      'Missing Supabase configuration: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.',
    );
  }

  return createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function isAuthorized(request: NextRequest): boolean {
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret) {
    // Fail closed: if no secret is configured, reject the request.
    return false;
  }

  const headerSecret =
    request.headers.get('x-cron-secret') ??
    request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ??
    null;

  return headerSecret === cronSecret;
}

function daysUntil(dateIso: string): number {
  const target = new Date(dateIso).getTime();
  const now = Date.now();
  return Math.ceil((target - now) / (1000 * 60 * 60 * 24));
}

export async function GET(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let supabase;
  try {
    supabase = getSupabaseAdmin();
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Configuration error' },
      { status: 500 },
    );
  }

  const now = new Date();
  const windowEnd = new Date(now.getTime() + EXPIRY_WINDOW_DAYS * 24 * 60 * 60 * 1000);

  const { data: meters, error: metersError } = await supabase
    .from('meters')
    .select('id, name, api_key_expires_at, cooperative_id')
    .not('api_key_expires_at', 'is', null)
    .gte('api_key_expires_at', now.toISOString())
    .lte('api_key_expires_at', windowEnd.toISOString());

  if (metersError) {
    return NextResponse.json(
      { error: `Failed to query meters: ${metersError.message}` },
      { status: 500 },
    );
  }

  const meterRows = (meters ?? []) as MeterRow[];

  if (meterRows.length === 0) {
    return NextResponse.json({ processed: 0, sent: 0, skipped: 0, failed: 0 });
  }

  const cooperativeIds = Array.from(
    new Set(
      meterRows
        .map((m) => m.cooperative_id)
        .filter((id): id is string => typeof id === 'string' && id.length > 0),
    ),
  );

  const cooperativesById = new Map<string, CooperativeRow>();

  if (cooperativeIds.length > 0) {
    const { data: cooperatives, error: cooperativesError } = await supabase
      .from('cooperatives')
      .select('id, name, admin_email')
      .in('id', cooperativeIds);

    if (cooperativesError) {
      return NextResponse.json(
        { error: `Failed to query cooperatives: ${cooperativesError.message}` },
        { status: 500 },
      );
    }

    for (const coop of (cooperatives ?? []) as CooperativeRow[]) {
      cooperativesById.set(coop.id, coop);
    }
  }

  let sent = 0;
  let skipped = 0;
  let failed = 0;
  const errors: Array<{ meterId: string; error: string }> = [];

  for (const meter of meterRows) {
    if (!meter.api_key_expires_at) {
      skipped += 1;
      continue;
    }

    const cooperative = meter.cooperative_id
      ? cooperativesById.get(meter.cooperative_id)
      : undefined;

    const adminEmail = cooperative?.admin_email ?? null;

    if (!adminEmail) {
      skipped += 1;
      continue;
    }

    try {
      await sendApiKeyExpiryEmail({
        to: adminEmail,
        cooperativeName: cooperative?.name ?? 'your cooperative',
        meterName: meter.name ?? meter.id,
        meterId: meter.id,
        expiresAt: meter.api_key_expires_at,
        daysUntilExpiry: daysUntil(meter.api_key_expires_at),
      });
      sent += 1;
    } catch (error) {
      failed += 1;
      errors.push({
        meterId: meter.id,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  return NextResponse.json({
    processed: meterRows.length,
    sent,
    skipped,
    failed,
    ...(errors.length > 0 ? { errors } : {}),
  });
}

export async function POST(request: NextRequest) {
  return GET(request);
}