'use client'

import { useTheme } from 'next-themes'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Moon, Sun, Building2, User, Bell } from 'lucide-react'
import { useEffect, useState } from 'react'

type NotificationPreferences = {
  inApp: boolean
  email: boolean
  emailAddress: string
  webhook: boolean
  webhookUrl: string
  webhookSecret: string
}

const DEFAULT_PREFERENCES: NotificationPreferences = {
  inApp: true,
  email: false,
  emailAddress: '',
  webhook: false,
  webhookUrl: '',
  webhookSecret: ''
}

export default function SettingsPage() {
  const { resolvedTheme, setTheme } = useTheme()
  const [mounted, setMounted] = useState(false)
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

  const queryClient = useQueryClient()
  const [preferences, setPreferences] = useState<NotificationPreferences>(DEFAULT_PREFERENCES)
  const [savedMessage, setSavedMessage] = useState<string | null>(null)

  const { data: notificationPrefs, isLoading: isLoadingPrefs } = useQuery({
    queryKey: ['notification-preferences'],
    queryFn: async () => {
      const res = await fetch('/api/notifications/preferences')
      if (!res.ok) throw new Error('Failed to load notification preferences')
      return res.json()
    }
  })

  useEffect(() => {
    if (notificationPrefs) {
      setPreferences({ ...DEFAULT_PREFERENCES, ...notificationPrefs })
    }
  }, [notificationPrefs])

  const savePreferences = useMutation({
    mutationFn: async (next: NotificationPreferences) => {
      const res = await fetch('/api/notifications/preferences', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(next)
      })
      if (!res.ok) throw new Error('Failed to save notification preferences')
      return res.json()
    },
    onSuccess: (data) => {
      if (data) setPreferences({ ...DEFAULT_PREFERENCES, ...data })
      queryClient.invalidateQueries({ queryKey: ['notification-preferences'] })
      setSavedMessage('Notification preferences saved.')
    },
    onError: () => {
      setSavedMessage('Failed to save notification preferences. Please try again.')
    }
  })

  function updatePreference<K extends keyof NotificationPreferences>(key: K, value: NotificationPreferences[K]) {
    setSavedMessage(null)
    setPreferences((prev) => ({ ...prev, [key]: value }))
  }

  function toggleTheme() {
    setTheme(isDark ? 'light' : 'dark')
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

        {/* Notifications - Issue #121: Real-time certificate alerts */}
        <section className="rounded-xl border border-gray-200 bg-white p-6 dark:border-gray-800 dark:bg-gray-950">
          <div className="mb-4 flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-yellow-100 dark:bg-yellow-900/30">
              <Bell className="h-5 w-5 text-yellow-600 dark:text-yellow-400" aria-hidden="true" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Notifications</h2>
              <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
                Get alerted when certificate status changes (issued, verified, failed, retired).
              </p>
            </div>
          </div>

          {isLoadingPrefs ? (
            <p className="text-sm text-gray-500 dark:text-gray-400">Loading notification preferences...</p>
          ) : (
            <div className="space-y-5">
              {/* In-app */}
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-sm font-medium text-gray-900 dark:text-gray-100">In-app (toast)</p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    Show a toast notification in the dashboard.
                  </p>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={preferences.inApp}
                  aria-label="Toggle in-app notifications"
                  onClick={() => updatePreference('inApp', !preferences.inApp)}
                  className={`relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full transition ${
                    preferences.inApp ? 'bg-yellow-400' : 'bg-gray-300 dark:bg-gray-700'
                  }`}
                >
                  <span
                    className={`inline-block h-4 w-4 transform rounded-full bg-white transition ${
                      preferences.inApp ? 'translate-x-6' : 'translate-x-1'
                    }`}
                  />
                </button>
              </div>

              {/* Email */}
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <p className="text-sm font-medium text-gray-900 dark:text-gray-100">Email</p>
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      Send certificate alerts to your email address.
                    </p>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={preferences.email}
                    aria-label="Toggle email notifications"
                    onClick={() => updatePreference('email', !preferences.email)}
                    className={`relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full transition ${
                      preferences.email ? 'bg-yellow-400' : 'bg-gray-300 dark:bg-gray-700'
                    }`}
                  >
                    <span
                      className={`inline-block h-4 w-4 transform rounded-full bg-white transition ${
                        preferences.email ? 'translate-x-6' : 'translate-x-1'
                      }`}
                    />
                  </button>
                </div>
                <input
                  type="email"
                  value={preferences.emailAddress}
                  onChange={(e) => updatePreference('emailAddress', e.target.value)}
                  placeholder="you@example.com"
                  aria-label="Notification email address"
                  className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:border-yellow-400 focus:outline-none focus:ring-1 focus:ring-yellow-400 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
                />
              </div>

              {/* Webhook */}
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <p className="text-sm font-medium text-gray-900 dark:text-gray-100">Webhook</p>
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      POST certificate events to an external endpoint.
                    </p>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={preferences.webhook}
                    aria-label="Toggle webhook notifications"
                    onClick={() => updatePreference('webhook', !preferences.webhook)}
                    className={`relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full transition ${
                      preferences.webhook ? 'bg-yellow-400' : 'bg-gray-300 dark:bg-gray-700'
                    }`}
                  >
                    <span
                      className={`inline-block h-4 w-4 transform rounded-full bg-white transition ${
                        preferences.webhook ? 'translate-x-6' : 'translate-x-1'
                      }`}
                    />
                  </button>
                </div>
                <input
                  type="url"
                  value={preferences.webhookUrl}
                  onChange={(e) => updatePreference('webhookUrl', e.target.value)}
                  placeholder="https://example.com/webhooks/certificates"
                  aria-label="Webhook URL"
                  className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:border-yellow-400 focus:outline-none focus:ring-1 focus:ring-yellow-400 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
                />
                <input
                  type="password"
                  value={preferences.webhookSecret}
                  onChange={(e) => updatePreference('webhookSecret', e.target.value)}
                  placeholder="Signing secret"
                  aria-label="Webhook signing secret"
                  className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:border-yellow-400 focus:outline-none focus:ring-1 focus:ring-yellow-400 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
                />
              </div>

              <div className="flex items-center justify-between gap-4">
                {savedMessage ? (
                  <p className="text-xs text-gray-600 dark:text-gray-400">{savedMessage}</p>
                ) : (
                  <span />
                )}
                <button
                  type="button"
                  onClick={() => savePreferences.mutate(preferences)}
                  disabled={savePreferences.isPending}
                  className="rounded-md bg-yellow-400 px-4 py-2 text-sm font-medium text-gray-900 hover:bg-yellow-500 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {savePreferences.isPending ? 'Saving...' : 'Save preferences'}
                </button>
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  )
}
