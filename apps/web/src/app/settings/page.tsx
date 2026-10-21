'use client'

import { useTheme } from 'next-themes'
import { useQuery } from '@tanstack/react-query'
import { Moon, Sun, Building2, User, RotateCcw } from 'lucide-react'
import { useEffect, useState } from 'react'

const DASHBOARD_FILTER_KEYS = [
  'dashboard:dateRange',
  'dashboard:meterId',
  'dashboard:certificateStatus'
]

export default function SettingsPage() {
  const { resolvedTheme, setTheme } = useTheme()
  const [mounted, setMounted] = useState(false)
  const [filtersReset, setFiltersReset] = useState(false)
  useEffect(() => setMounted(true), [])

  const isDark = mounted && resolvedTheme === 'dark'

  const { data: coop, isLoading } = useQuery({
    queryKey: ['my-cooperative'],
    queryFn: async () => {
      const res = await fetch('/api/cooperative/me')
      if (!res.ok) throw new Error('Failed to load cooperative info')
      return res.json()
    }
  })

  function toggleTheme() {
    setTheme(isDark ? 'light' : 'dark')
  }

  function resetDashboardFilters() {
    if (typeof window === 'undefined') return
    const userId = window.localStorage.getItem('userId') || 'anonymous'
    for (const key of DASHBOARD_FILTER_KEYS) {
      window.localStorage.removeItem(`${key}:${userId}`)
    }
    setFiltersReset(true)
  }

  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      <h1 className="mb-4 text-2xl font-bold text-gray-900 dark:text-gray-100">Settings</h1>
      
      <div className="space-y-6">
        {/* Account Info */}
        <section className="rounded-xl border border-gray-200 bg-white p-6 dark:border-gray-800 dark:bg-gray-950">
          <h2 className="mb-4 text-lg font-semibold text-gray-900 dark:text-gray-100">Account</h2>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-yellow-100 dark:bg-yellow-900/30">
                {coop?.account_type === 'cooperative' ? (
                  <Building2 className="h-6 w-6 text-yellow-600 dark:text-yellow-400" />
                ) : (
                  <User className="h-6 w-6 text-yellow-600 dark:text-yellow-400" />
                )}
              </div>
              <div>
                <p className="text-sm font-medium text-gray-900 dark:text-gray-100 capitalize">
                  {isLoading ? 'Loading...' : `${coop?.account_type || 'individual'} Account`}
                </p>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  {coop?.account_type === 'cooperative' 
                    ? 'Full access to multi-meter management and cooperative governance.'
                    : 'Limited to 1 meter. Upgrade to Cooperative for multiple meters.'}
                </p>
              </div>
            </div>
            {coop?.account_type === 'individual' && (
              <button className="rounded-md bg-yellow-400 px-3 py-1.5 text-xs font-medium text-gray-900 hover:bg-yellow-500">
                Upgrade
              </button>
            )}
          </div>
        </section>

        {/* Theme Settings - Issue #22: Dark mode toggle with localStorage persistence */}
        <section className="rounded-xl border border-gray-200 bg-white p-6 dark:border-gray-800 dark:bg-gray-950">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Theme</h2>
              <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
                Use dark mode for better low-light readability.
              </p>
            </div>
            <button
              type="button"
              onClick={toggleTheme}
              aria-pressed={isDark}
              aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
              className="inline-flex items-center gap-2 rounded-full border border-gray-300 bg-gray-50 px-4 py-2 text-sm font-semibold text-gray-900 transition hover:bg-gray-100 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:hover:bg-gray-800"
            >
              {isDark ? <Sun className="h-4 w-4" aria-hidden="true" /> : <Moon className="h-4 w-4" aria-hidden="true" />}
              {isDark ? 'Light mode' : 'Dark mode'}
            </button>
          </div>
        </section>

        {/* Dashboard Filters - Issue #124: Persistent user context */}
        <section className="rounded-xl border border-gray-200 bg-white p-6 dark:border-gray-800 dark:bg-gray-950">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Dashboard filters</h2>
              <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
                Your date range, meter selection and certificate status filters are remembered across sessions.
                Reset them to return to the defaults.
              </p>
              {filtersReset && (
                <p className="mt-2 text-sm text-green-600 dark:text-green-400" role="status">
                  Dashboard filters have been reset.
                </p>
              )}
            </div>
            <button
              type="button"
              onClick={resetDashboardFilters}
              className="inline-flex items-center gap-2 rounded-full border border-gray-300 bg-gray-50 px-4 py-2 text-sm font-semibold text-gray-900 transition hover:bg-gray-100 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:hover:bg-gray-800"
            >
              <RotateCcw className="h-4 w-4" aria-hidden="true" />
              Reset filters
            </button>
          </div>
        </section>
      </div>
    </div>
  )
}
