'use client'

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { ShieldOff, ShieldCheck, Zap, Award, Activity } from 'lucide-react'
import { StatCardSkeleton, TableRowSkeleton } from '@/components/skeleton'

interface Operator {
  id: string
  name: string
  admin_address: string
  suspended: boolean
  created_at: string
}

interface Stats {
  total_kwh: number
  total_certificates: number
  active_meters: number
}

function useAdminToken() {
  const [token, setToken] = useState(() =>
    typeof window !== 'undefined' ? (sessionStorage.getItem('admin_token') ?? '') : ''
  )
  function saveToken(t: string) {
    sessionStorage.setItem('admin_token', t)
    setToken(t)
  }
  return { token, saveToken }
}

function authHeaders(token: string) {
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
}

async function fetchOperators(token: string): Promise<Operator[]> {
  const res = await fetch('/api/admin/operators', { headers: authHeaders(token) })
  if (res.status === 401) throw new Error('Unauthorized')
  if (!res.ok) throw new Error('Failed to load operators')
  return res.json().then((d) => d.data)
}

async function fetchStats(token: string): Promise<Stats> {
  const res = await fetch('/api/admin/stats', { headers: authHeaders(token) })
  if (res.status === 401) throw new Error('Unauthorized')
  if (!res.ok) throw new Error('Failed to load stats')
  return res.json()
}

async function toggleSuspend(token: string, id: string, suspended: boolean): Promise<void> {
  const res = await fetch(`/api/admin/operators/${id}`, {
    method: 'PATCH',
    headers: authHeaders(token),
    body: JSON.stringify({ suspended }),
  })
  if (!res.ok) throw new Error('Failed to update operator')
}

export default function AdminPage() {
  const { token, saveToken } = useAdminToken()
  const [draft, setDraft] = useState('')
  const [authed, setAuthed] = useState(!!token)
  const qc = useQueryClient()

  const {
    data: operators,
    isLoading: opsLoading,
    error: opsError,
  } = useQuery({
    queryKey: ['admin', 'operators', token],
    queryFn: () => fetchOperators(token),
    enabled: authed,
    retry: false,
  })

  const {
    data: stats,
    isLoading: statsLoading,
  } = useQuery({
    queryKey: ['admin', 'stats', token],
    queryFn: () => fetchStats(token),
    enabled: authed,
    retry: false,
  })

  const suspend = useMutation({
    mutationFn: ({ id, suspended }: { id: string; suspended: boolean }) =>
      toggleSuspend(token, id, suspended),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'operators'] }),
  })

  function handleLogin(e: React.FormEvent) {
    e.preventDefault()
    saveToken(draft)
    setAuthed(true)
  }

  if (!authed) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center px-4">
        <form onSubmit={handleLogin} className="w-full max-w-sm space-y-4">
          <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100">Admin access</h1>
          <div>
            <label htmlFor="token" className="block text-sm font-medium text-gray-700 dark:text-gray-300">
              Admin secret
            </label>
            <input
              id="token"
              type="password"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              required
              className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-yellow-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-yellow-400 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
              placeholder="Enter admin secret"
            />
          </div>
          <button
            type="submit"
            className="w-full rounded-lg bg-yellow-400 px-4 py-2 text-sm font-semibold text-gray-900 hover:bg-yellow-300"
          >
            Sign in
          </button>
        </form>
      </div>
    )
  }

  if (opsError instanceof Error && opsError.message === 'Unauthorized') {
    return (
      <div className="flex min-h-[60vh] items-center justify-center px-4">
        <div className="text-center">
          <p className="mb-4 text-red-600 dark:text-red-400">Invalid admin secret.</p>
          <button
            onClick={() => { saveToken(''); setAuthed(false) }}
            className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800"
          >
            Try again
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <div className="mb-8 flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Admin</h1>
        <button
          onClick={() => { saveToken(''); setAuthed(false) }}
          className="text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
        >
          Sign out
        </button>
      </div>

      {/* System stats */}
      <section aria-labelledby="stats-heading" className="mb-8">
        <h2 id="stats-heading" className="mb-4 text-lg font-semibold text-gray-900 dark:text-gray-100">
          System stats
        </h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3" aria-busy={statsLoading}>
          {statsLoading ? (
            <>
              <StatCardSkeleton />
              <StatCardSkeleton />
              <StatCardSkeleton />
            </>
          ) : (
            <>
              <StatCard
                label="Total kWh anchored"
                value={stats?.total_kwh.toFixed(3) ?? '—'}
                icon={Zap}
              />
              <StatCard
                label="Total certificates"
                value={stats?.total_certificates.toLocaleString() ?? '—'}
                icon={Award}
              />
              <StatCard
                label="Active meters"
                value={stats?.active_meters.toLocaleString() ?? '—'}
                icon={Activity}
              />
            </>
          )}
        </div>
      </section>

      {/* Operators */}
      <section aria-labelledby="operators-heading">
        <h2 id="operators-heading" className="mb-4 text-lg font-semibold text-gray-900 dark:text-gray-100">
          Operators
        </h2>
        {opsError && (
          <p role="alert" className="mb-4 text-sm text-red-600 dark:text-red-400">
            {(opsError as Error).message}
          </p>
        )}
        <div className="overflow-hidden rounded-xl border border-gray-200 dark:border-gray-800">
          <table
            className="min-w-full divide-y divide-gray-200 bg-white text-sm dark:divide-gray-800 dark:bg-gray-900"
            aria-label="Operators"
            aria-busy={opsLoading}
          >
            <thead>
              <tr className="bg-gray-50 dark:bg-gray-800/50">
                {['Name', 'Admin address', 'Status', 'Created', 'Action'].map((h) => (
                  <th
                    key={h}
                    scope="col"
                    className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
              {opsLoading ? (
                <>
                  {Array.from({ length: 5 }).map((_, i) => (
                    <TableRowSkeleton key={i} cols={5} />
                  ))}
                </>
              ) : operators && operators.length > 0 ? (
                operators.map((op) => (
                  <tr key={op.id} className="hover:bg-gray-50 dark:hover:bg-gray-800/40">
                    <td className="px-4 py-3 font-medium text-gray-900 dark:text-gray-100">{op.name}</td>
                    <td className="px-4 py-3 font-mono text-xs text-gray-600 dark:text-gray-400 max-w-[180px] truncate">
                      {op.admin_address}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                          op.suspended
                            ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
                            : 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                        }`}
                      >
                        {op.suspended ? 'Suspended' : 'Active'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-500 dark:text-gray-400">
                      {new Date(op.created_at).toLocaleDateString()}
                    </td>
                    <td className="px-4 py-3">
                      <button
                        onClick={() => suspend.mutate({ id: op.id, suspended: !op.suspended })}
                        disabled={suspend.isPending}
                        aria-label={op.suspended ? `Unsuspend ${op.name}` : `Suspend ${op.name}`}
                        className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors disabled:opacity-50 ${
                          op.suspended
                            ? 'bg-green-100 text-green-700 hover:bg-green-200 dark:bg-green-900/30 dark:text-green-400'
                            : 'bg-red-100 text-red-700 hover:bg-red-200 dark:bg-red-900/30 dark:text-red-400'
                        }`}
                      >
                        {op.suspended ? (
                          <><ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" /> Unsuspend</>
                        ) : (
                          <><ShieldOff className="h-3.5 w-3.5" aria-hidden="true" /> Suspend</>
                        )}
                      </button>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-sm text-gray-500 dark:text-gray-400">
                    No operators found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}

function StatCard({ label, value, icon: Icon }: { label: string; value: string; icon: React.ElementType }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-6 dark:border-gray-800 dark:bg-gray-900">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-sm font-medium text-gray-500 dark:text-gray-400">{label}</span>
        <Icon className="h-5 w-5 text-yellow-500" aria-hidden="true" />
      </div>
      <p className="text-3xl font-bold text-gray-900 dark:text-gray-100">{value}</p>
    </div>
  )
}

// #485 .
