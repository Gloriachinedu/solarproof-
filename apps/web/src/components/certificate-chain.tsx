'use client'

import {
  Zap,
  ShieldCheck,
  Link2,
  Award,
  FlameKindling,
  ExternalLink,
  CheckCircle2,
  Clock,
} from 'lucide-react'
import { CopyableText } from './copy-button'

interface ChainStep {
  icon: React.ElementType
  label: string
  timestamp: string | null
  hash: string | null
  hashLabel: string
  explorerUrl?: string
  status: 'done' | 'pending'
  detail?: string
}

interface CertificateChainProps {
  steps: ChainStep[]
}

export function CertificateChain({ steps }: CertificateChainProps) {
  return (
    <ol aria-label="Chain of custody" className="relative space-y-0">
      {steps.map((step, i) => {
        const isLast = i === steps.length - 1
        const Icon = step.icon
        return (
          <li key={step.label} className="relative flex gap-4">
            {/* Connector line */}
            {!isLast && (
              <span
                aria-hidden="true"
                className="absolute start-[19px] top-10 h-full w-px bg-gray-200 dark:bg-gray-700"
              />
            )}

            {/* Step icon */}
            <div
              className={`relative z-10 flex h-10 w-10 shrink-0 items-center justify-center rounded-full border-2 ${
                step.status === 'done'
                  ? 'border-yellow-400 bg-yellow-50 dark:bg-yellow-900/20'
                  : 'border-gray-300 bg-gray-50 dark:border-gray-700 dark:bg-gray-800'
              }`}
            >
              <Icon
                className={`h-4 w-4 ${
                  step.status === 'done'
                    ? 'text-yellow-600 dark:text-yellow-400'
                    : 'text-gray-400 dark:text-gray-500'
                }`}
                aria-hidden="true"
              />
            </div>

            {/* Step content */}
            <div className={`pb-8 ${isLast ? 'pb-0' : ''} min-w-0 flex-1`}>
              <div className="rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <span className="font-semibold text-gray-900 dark:text-gray-100">
                    {step.label}
                  </span>
                  {step.status === 'done' ? (
                    <span className="flex items-center gap-1 text-xs text-green-600 dark:text-green-400">
                      <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
                      Confirmed
                    </span>
                  ) : (
                    <span className="flex items-center gap-1 text-xs text-gray-400 dark:text-gray-500">
                      <Clock className="h-3.5 w-3.5" aria-hidden="true" />
                      Pending
                    </span>
                  )}
                </div>

                {step.detail && (
                  <p className="mb-2 text-sm text-gray-600 dark:text-gray-400">{step.detail}</p>
                )}

                {step.timestamp && (
                  <p className="mb-1 text-xs text-gray-500 dark:text-gray-500">
                    <time dateTime={step.timestamp}>
                      {new Date(step.timestamp).toLocaleString()}
                    </time>
                  </p>
                )}

                {step.hash && (
                  <div className="mt-1 flex flex-wrap items-center gap-1 text-xs">
                    <span className="text-gray-500 dark:text-gray-400">{step.hashLabel}:</span>
                    {step.explorerUrl ? (
                      <span className="flex items-center gap-1">
                        <a
                          href={step.explorerUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          aria-label={`${step.hashLabel} ${step.hash} — opens Stellar explorer`}
                          className="flex items-center gap-1 break-all font-mono text-blue-600 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-yellow-400 focus-visible:ring-offset-1 rounded dark:text-blue-400"
                        >
                          {step.hash.slice(0, 16)}…
                          <ExternalLink className="h-3 w-3 shrink-0" aria-hidden="true" />
                        </a>
                        <CopyableText value={step.hash} displayValue="" className="ms-0" />
                      </span>
                    ) : (
                      <CopyableText value={step.hash} displayValue={`${step.hash.slice(0, 16)}…`} />
                    )}
                  </div>
                )}
              </div>
            </div>
          </li>
        )
      })}
    </ol>
  )
}

export type { ChainStep }
