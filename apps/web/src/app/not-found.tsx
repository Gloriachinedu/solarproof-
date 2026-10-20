import Link from 'next/link'
import { Sun } from 'lucide-react'

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 px-4 text-center">
      <Sun className="h-12 w-12 text-yellow-400" aria-hidden="true" />
      <h1 className="text-6xl font-bold text-gray-900 dark:text-gray-100">404</h1>
      <p className="text-xl text-gray-600 dark:text-gray-400">Page not found</p>
      <p className="max-w-md text-gray-500 dark:text-gray-500">
        The page you&apos;re looking for doesn&apos;t exist or has been moved.
      </p>
      <Link
        href="/dashboard"
        className="rounded-lg bg-yellow-400 px-6 py-3 font-semibold text-gray-900 transition hover:bg-yellow-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-yellow-400 focus-visible:ring-offset-2"
      >
        Back to Dashboard
      </Link>
    </div>
  )
}
