'use client';

import { useEffect, useMemo, useState } from 'react';

interface TimeSeriesPoint {
  date: string;
  kwh: number;
}

interface CooperativeStats {
  totalKwhGenerated: number;
  activeMeters: number;
  certificatesIssued: number;
  certificatesRetired: number;
  memberCount: number;
  kwhTimeSeries: TimeSeriesPoint[];
}

interface CooperativeDashboardProps {
  cooperativeId: string;
  role?: string;
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat().format(value);
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
      <p className="text-sm font-medium text-gray-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-gray-900">{value}</p>
    </div>
  );
}

function KwhChart({ data }: { data: TimeSeriesPoint[] }) {
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
    <div className="flex h-48 items-end gap-1 overflow-x-auto">
      {data.map((point) => {
        const height = max > 0 ? Math.max((point.kwh / max) * 100, 2) : 2;
        return (
          <div
            key={point.date}
            className="flex min-w-[8px] flex-1 flex-col items-center justify-end"
            title={`${point.date}: ${formatNumber(point.kwh)} kWh`}
          >
            <div
              className="w-full rounded-t bg-emerald-500"
              style={{ height: `${height}%` }}
            />
          </div>
        );
      })}
    </div>
  );
}

export default function CooperativeDashboard({
  cooperativeId,
  role,
}: CooperativeDashboardProps) {
  const [stats, setStats] = useState<CooperativeStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const isCooperativeAdmin = role === 'cooperative_admin';

  useEffect(() => {
    if (!isCooperativeAdmin) {
      setLoading(false);
      return;
    }

    let cancelled = false;

    async function load() {
      try {
        setLoading(true);
        const res = await fetch(
          `/api/cooperatives/${cooperativeId}/dashboard`,
        );
        if (!res.ok) {
          throw new Error('Failed to load cooperative dashboard');
        }
        const data = (await res.json()) as CooperativeStats;
        if (!cancelled) {
          setStats(data);
          setError(null);
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
  }, [cooperativeId, isCooperativeAdmin]);

  if (!isCooperativeAdmin) {
    return (
      <div className="p-6">
        <p className="text-sm text-red-600">
          You do not have permission to view the cooperative dashboard.
        </p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="p-6">
        <p className="text-sm text-gray-500">Loading dashboard…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6">
        <p className="text-sm text-red-600">{error}</p>
      </div>
    );
  }

  if (!stats) {
    return null;
  }

  return (
    <div className="space-y-6 p-4 sm:p-6">
      <div>
        <h1 className="text-xl font-semibold text-gray-900 sm:text-2xl">
          Cooperative Dashboard
        </h1>
        <p className="mt-1 text-sm text-gray-500">
          Aggregate performance across all cooperative members.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <StatCard
          label="Total kWh Generated"
          value={formatNumber(stats.totalKwhGenerated)}
        />
        <StatCard
          label="Active Meters"
          value={formatNumber(stats.activeMeters)}
        />
        <StatCard
          label="Certificates Issued"
          value={formatNumber(stats.certificatesIssued)}
        />
        <StatCard
          label="Certificates Retired"
          value={formatNumber(stats.certificatesRetired)}
        />
        <StatCard label="Members" value={formatNumber(stats.memberCount)} />
      </div>

      <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
        <h2 className="text-base font-semibold text-gray-900">
          Aggregate kWh Over Time
        </h2>
        <div className="mt-4">
          <KwhChart data={stats.kwhTimeSeries} />
        </div>
      </div>
    </div>
  );
}
