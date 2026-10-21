'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';

interface CooperativeStats {
  totalKwhGenerated: number;
  activeMeters: number;
  certificatesIssued: number;
  certificatesRetired: number;
  memberCount: number;
}

interface KwhPoint {
  period: string;
  kwh: number;
}

interface DashboardResponse {
  stats: CooperativeStats;
  timeSeries: KwhPoint[];
}

const EMPTY_STATS: CooperativeStats = {
  totalKwhGenerated: 0,
  activeMeters: 0,
  certificatesIssued: 0,
  certificatesRetired: 0,
  memberCount: 0,
};

function formatNumber(value: number): string {
  return new Intl.NumberFormat().format(value);
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
      <p className="text-sm text-gray-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-gray-900">{value}</p>
    </div>
  );
}

function KwhChart({ data }: { data: KwhPoint[] }) {
  const max = useMemo(
    () => data.reduce((acc, point) => Math.max(acc, point.kwh), 0),
    [data],
  );

  if (data.length === 0) {
    return (
      <p className="text-sm text-gray-500">No generation data available yet.</p>
    );
  }

  return (
    <div className="flex h-48 items-end gap-2 overflow-x-auto">
      {data.map((point) => {
        const heightPct = max > 0 ? (point.kwh / max) * 100 : 0;
        return (
          <div
            key={point.period}
            className="flex min-w-[2rem] flex-1 flex-col items-center justify-end"
          >
            <div
              className="w-full rounded-t bg-emerald-500"
              style={{ height: `${heightPct}%` }}
              title={`${point.period}: ${formatNumber(point.kwh)} kWh`}
            />
            <span className="mt-1 whitespace-nowrap text-xs text-gray-500">
              {point.period}
            </span>
          </div>
        );
      })}
    </div>
  );
}

export default function CooperativeDashboardPage() {
  const router = useRouter();
  const [data, setData] = useState<DashboardResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const res = await fetch('/api/cooperative/dashboard', {
          credentials: 'include',
        });

        if (res.status === 401 || res.status === 403) {
          router.replace('/login');
          return;
        }

        if (!res.ok) {
          throw new Error('Failed to load cooperative dashboard');
        }

        const json = (await res.json()) as DashboardResponse;
        if (!cancelled) {
          setData(json);
        }
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof Error ? err.message : 'Something went wrong',
          );
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    load();

    return () => {
      cancelled = true;
    };
  }, [router]);

  const stats = data?.stats ?? EMPTY_STATS;
  const timeSeries = data?.timeSeries ?? [];

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 lg:px-8">
      <header className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">
          Cooperative Dashboard
        </h1>
        <p className="mt-1 text-sm text-gray-500">
          Aggregate generation and certificate activity across your cooperative.
        </p>
      </header>

      {loading ? (
        <p className="text-sm text-gray-500">Loading dashboard…</p>
      ) : error ? (
        <p className="text-sm text-red-600">{error}</p>
      ) : (
        <div className="space-y-6">
          <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <StatCard
              label="Total kWh generated"
              value={`${formatNumber(stats.totalKwhGenerated)} kWh`}
            />
            <StatCard
              label="Active meters"
              value={formatNumber(stats.activeMeters)}
            />
            <StatCard
              label="Certificates issued"
              value={formatNumber(stats.certificatesIssued)}
            />
            <StatCard
              label="Certificates retired"
              value={formatNumber(stats.certificatesRetired)}
            />
            <StatCard
              label="Members"
              value={formatNumber(stats.memberCount)}
            />
          </section>

          <section className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
            <h2 className="mb-4 text-lg font-semibold text-gray-900">
              Aggregate kWh over time
            </h2>
            <KwhChart data={timeSeries} />
          </section>
        </div>
      )}
    </main>
  );
}
