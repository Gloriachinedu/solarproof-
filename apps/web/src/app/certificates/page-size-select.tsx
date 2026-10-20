'use client'

import { useRouter, usePathname, useSearchParams } from 'next/navigation'

const OPTIONS = [10, 25, 50] as const

export function PageSizeSelect({ current }: { current: number }) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  function handleChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const params = new URLSearchParams(searchParams.toString())
    params.set('limit', e.target.value)
    params.delete('cursor') // reset to first page on size change
    router.push(`${pathname}?${params.toString()}`)
  }

  return (
    <div className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400">
      <label htmlFor="page-size">Per page</label>
      <select
        id="page-size"
        value={current}
        onChange={handleChange}
        className="rounded-md border border-gray-300 bg-white px-2 py-1 text-sm text-gray-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-yellow-400 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
      >
        {OPTIONS.map((n) => (
          <option key={n} value={n}>
            {n}
          </option>
        ))}
      </select>
    </div>
  )
}
