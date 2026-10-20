'use client'

import { useEffect, useId } from 'react'
import Link from 'next/link'
import { AlertTriangle } from 'lucide-react'

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  const fallbackId = useId()
  const referenceId = error.digest ?? fallbackId

  useEffect(() => {
    console.error(error)
  }, [error])

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 px-4 text-center">
      <AlertTriangle className="h-12 w-12 text-red-500" aria-hidden="true" />
      <h1 className="text-6xl font-bold text-gray-900 dark:text-gray-100">500</h1>
      <p className="text-xl text-gray-600 dark:text-gray-400">Something went wrong</p>
      <p className="max-w-md text-gray-500 dark:text-gray-500">
        An unexpected error occurred. Please try again or contact support if the problem persists.
      </p>
      <p className="font-mono text-sm text-gray-400 dark:text-gray-600">
        Reference ID: <span className="select-all">{referenceId}</span>
      </p>
      <div className="flex gap-4">
        <button
          onClick={reset}
          className="rounded-lg bg-yellow-400 px-6 py-3 font-semibold text-gray-900 transition hover:bg-yellow-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-yellow-400 focus-visible:ring-offset-2"
        >
          Try again
        </button>
        <Link
          href="/dashboard"
          className="rounded-lg border border-gray-300 px-6 py-3 font-semibold text-gray-700 transition hover:bg-gray-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-400 focus-visible:ring-offset-2 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-800"
        >
          Back to Dashboard
        </Link>
      </div>
    </div>
  )
}
