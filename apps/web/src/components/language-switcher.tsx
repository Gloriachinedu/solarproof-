'use client'

import { useTransition, useState } from 'react'
import { useRouter } from 'next/navigation'
import { locales, LOCALE_LABELS, LOCALE_NAMES, type Locale } from '@/lib/locales'

interface Props {
  current: Locale
}

export function LanguageSwitcher({ current }: Props) {
  const router = useRouter()
  const [, startTransition] = useTransition()
  const [announcement, setAnnouncement] = useState('')

  function switchLocale(locale: Locale) {
    document.cookie = `locale=${locale};path=/;max-age=31536000;SameSite=Lax`
    setAnnouncement(`Language changed to ${LOCALE_NAMES[locale]}`)
    startTransition(() => router.refresh())
  }

  return (
    <div role="group" aria-label="Language selector">
      {/* Screen reader announcement for selection change */}
      <span role="status" aria-live="polite" aria-atomic="true" className="sr-only">
        {announcement}
      </span>

      <label htmlFor="language-select" className="sr-only">
        Select language
      </label>
      <select
        id="language-select"
        value={current}
        onChange={(e) => switchLocale(e.target.value as Locale)}
        className="cursor-pointer appearance-none rounded-md border border-gray-200 bg-white px-2 py-1 text-xs font-medium text-gray-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-yellow-400 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300"
      >
        {locales.map((l) => (
          <option key={l} value={l}>
            {LOCALE_LABELS[l]} — {LOCALE_NAMES[l]}
          </option>
        ))}
      </select>
    </div>
  )
}
