import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuth } from '@/lib/auth';
import { db } from '@/lib/db';
import { certificates, readings, meters } from '@/lib/schema';
import { and, eq, gte, lt, sql } from 'drizzle-orm';

const querySchema = z.object({
  month: z
    .string()
    .regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'month must be in YYYY-MM format'),
  format: z.enum(['json', 'csv']).optional().default('json'),
});

function monthRange(month: string): { start: Date; end: Date } {
  const [yearStr, monthStr] = month.split('-');
  const year = Number(yearStr);
  const monthIndex = Number(monthStr) - 1;
  const start = new Date(Date.UTC(year, monthIndex, 1, 0, 0, 0, 0));
  const end = new Date(Date.UTC(year, monthIndex + 1, 1, 0, 0, 0, 0));
  return { start, end };
}

function csvEscape(value: unknown): string {
  if (value === null || value === undefined) return '';
  const str = String(value);
  if (/[",\n\r]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const cooperativeId = auth.user.cooperativeId;
  if (!cooperativeId) {
    return NextResponse.json(
      { error: 'User is not associated with a cooperative' },
      { status: 403 }
    );
  }

  const url = new URL(req.url);
  const parsed = querySchema.safeParse({
    month: url.searchParams.get('month') ?? undefined,
    format: url.searchParams.get('format') ?? undefined,
  });

  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid query parameters', details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const { month, format } = parsed.data;
  const { start, end } = monthRange(month);

  const rows = await db
    .select({
      certificateId: certificates.id,
      kwh: readings.kwh,
      retiredAt: certificates.retiredAt,
      retiredBy: certificates.retiredBy,
    })
    .from(certificates)
    .innerJoin(readings, eq(certificates.readingId, readings.id))
    .innerJoin(meters, eq(readings.meterId, meters.id))
    .where(
      and(
        eq(meters.cooperativeId, cooperativeId),
        eq(certificates.retired, true),
        gte(certificates.retiredAt, start),
        lt(certificates.retiredAt, end)
      )
    );

  if (format === 'csv') {
    const header = ['certificate_id', 'kwh', 'retired_at', 'retired_by'];
    const lines = [header.join(',')];
    for (const row of rows) {
      lines.push(
        [
          csvEscape(row.certificateId),
          csvEscape(row.kwh),
          csvEscape(row.retiredAt ? new Date(row.retiredAt).toISOString() : ''),
          csvEscape(row.retiredBy),
        ].join(',')
      );
    }
    const csv = lines.join('\r\n') + '\r\n';
    return new NextResponse(csv, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="retirement-report-${month}.csv"`,
      },
    });
  }

  let totalKwh = 0;
  const buyerMap = new Map<
    string,
    { retiredBy: string; totalKwh: number; certificateIds: string[] }
  >();
  const certificateIds: string[] = [];

  for (const row of rows) {
    const kwh = Number(row.kwh ?? 0);
    totalKwh += kwh;
    certificateIds.push(row.certificateId);

    const buyerKey = row.retiredBy ?? 'unknown';
    const existing = buyerMap.get(buyerKey);
    if (existing) {
      existing.totalKwh += kwh;
      existing.certificateIds.push(row.certificateId);
    } else {
      buyerMap.set(buyerKey, {
        retiredBy: buyerKey,
        totalKwh: kwh,
        certificateIds: [row.certificateId],
      });
    }
  }

  const perBuyer = Array.from(buyerMap.values()).map((b) => ({
    retiredBy: b.retiredBy,
    totalKwh: Number(b.totalKwh.toFixed(3)),
    certificateCount: b.certificateIds.length,
    certificateIds: b.certificateIds,
  }));

  return NextResponse.json({
    month,
    cooperativeId,
    totalKwhRetired: Number(totalKwh.toFixed(3)),
    certificateCount: certificateIds.length,
    certificateIds,
    perBuyer,
  });
}