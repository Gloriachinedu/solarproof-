import Link from 'next/link'
import { Sun, Shield, Search, Zap } from 'lucide-react'

const features = [
  {
    icon: Zap,
    title: 'Signed at source',
    description: 'Every meter reading is Ed25519-signed by the device before leaving hardware.',
  },
  {
    icon: Shield,
    title: 'Anchored on-chain',
    description:
      'The signed reading hash is permanently recorded on Stellar alongside the minted certificate.',
  },
  {
    icon: Search,
    title: 'Publicly verifiable',
    description:
      'Anyone can verify the full chain: meter → signature → ledger → certificate → retirement.',
  },
]

const steps = [
  'Smart meter signs reading with its Ed25519 private key',
  'SolarProof API verifies signature and anchors reading hash on Stellar',
  'Energy certificates minted (1 token = 1 kWh) — linked to the anchor',
  'Buyer purchases and retires certificate — burn recorded on-chain',
  'Anyone verifies the full chain at /verify with no login required',
]

export default function HomePage() {
  return (
    <div className="mx-auto max-w-5xl px-4 py-12 sm:py-20">
      {/* Hero */}
      <header className="mb-12 text-center sm:mb-16">
        <div className="mb-4 flex justify-center">
          <Sun className="h-12 w-12 text-yellow-400 sm:h-14 sm:w-14" aria-hidden="true" />
        </div>
        <h1 className="mb-4 text-4xl font-bold tracking-tight text-gray-900 dark:text-gray-100 sm:text-5xl">
          SolarProof
        </h1>
        <p className="mx-auto mb-2 max-w-xl text-base text-gray-600 dark:text-gray-400 sm:text-lg">
          End-to-end cryptographic proof of renewable energy on Stellar.
        </p>
        <p className="mx-auto mb-8 max-w-xl text-sm text-gray-500 dark:text-gray-500">
          Every kWh signed at the meter · anchored on-chain · publicly verifiable
        </p>
        <div className="flex flex-col items-center gap-3 sm:flex-row sm:justify-center sm:gap-4">
          <Link
            href="/verify"
            className="w-full rounded-lg bg-yellow-400 px-6 py-3 text-center font-medium text-gray-900 hover:bg-yellow-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-yellow-400 focus-visible:ring-offset-2 dark:focus:ring-offset-gray-950 sm:w-auto"
          >
            Verify a Certificate
          </Link>
          <Link
            href="/dashboard"
            className="w-full rounded-lg border border-gray-300 px-6 py-3 text-center font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-400 focus-visible:ring-offset-2 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800 dark:focus:ring-offset-gray-950 sm:w-auto"
          >
            Dashboard
          </Link>
        </div>
      </header>

      {/* Feature cards */}
      <section aria-labelledby="features-heading">
        <h2 id="features-heading" className="sr-only">
          Key features
        </h2>
        <div className="grid gap-6 sm:gap-8 md:grid-cols-3">
          {features.map((f) => (
            <div
              key={f.title}
              className="rounded-xl border border-gray-200 bg-white p-6 dark:border-gray-800 dark:bg-gray-900"
            >
              <f.icon
                className="mb-3 h-8 w-8 text-yellow-500"
                aria-hidden="true"
              />
              <h3 className="mb-2 font-semibold text-gray-900 dark:text-gray-100">{f.title}</h3>
              <p className="text-sm text-gray-600 dark:text-gray-400">{f.description}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Chain of custody */}
      <section
        aria-labelledby="chain-heading"
        className="mt-12 rounded-xl border border-gray-200 bg-white p-6 dark:border-gray-800 dark:bg-gray-900 sm:mt-16 sm:p-8"
      >
        <h2
          id="chain-heading"
          className="mb-6 text-xl font-semibold text-gray-900 dark:text-gray-100"
        >
          Chain of custody
        </h2>
        <ol className="space-y-3 text-sm text-gray-700 dark:text-gray-300">
          {steps.map((step, i) => (
            <li key={i} className="flex items-start gap-3">
              <span
                aria-hidden="true"
                className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-yellow-100 text-xs font-bold text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400"
              >
                {i + 1}
              </span>
              <span>{step}</span>
            </li>
          ))}
        </ol>
      </section>
    </div>
  )
}
