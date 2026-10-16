'use client'

import { useState } from 'react'
import { Copy, Check } from 'lucide-react'

interface CopyButtonProps {
  value: string
  label?: string
  className?: string
  iconSize?: number
  onCopied?: () => void
}

/** Write text to clipboard with a mobile-safe fallback via a temporary textarea. */
async function writeToClipboard(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text)
    return
  }
  // Fallback for mobile browsers that don't support navigator.clipboard
  const el = document.createElement('textarea')
  el.value = text
  el.style.cssText = 'position:fixed;top:0;left:0;opacity:0'
  document.body.appendChild(el)
  el.focus()
  el.select()
  const ok = document.execCommand('copy')
  document.body.removeChild(el)
  if (!ok) throw new Error('copy failed')
}

export function CopyButton({ value, label, className = '', iconSize = 14, onCopied }: CopyButtonProps) {
  const [copied, setCopied] = useState(false)

  async function handleCopy() {
    try {
      await writeToClipboard(value)
      setCopied(true)
      onCopied?.()
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Surface nothing to the user visually — caller can supply onCopied for toast
    }
  }

  return (
    <button
      onClick={handleCopy}
      aria-label={label || `Copy ${value}`}
      aria-pressed={copied}
      title={copied ? 'Copied!' : 'Copy to clipboard'}
      className={`inline-flex items-center gap-1 rounded p-1 text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-yellow-400 focus-visible:ring-offset-1 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-200 ${className}`}
    >
      {copied ? (
        <Check className="text-green-600 dark:text-green-400" style={{ width: iconSize, height: iconSize }} aria-hidden="true" />
      ) : (
        <Copy style={{ width: iconSize, height: iconSize }} aria-hidden="true" />
      )}
      <span className="sr-only">{copied ? 'Copied' : 'Copy'}</span>
    </button>
  )
}

interface CopyableTextProps {
  value: string
  displayValue?: string
  mono?: boolean
  className?: string
}

export function CopyableText({ value, displayValue, mono = true, className = '' }: CopyableTextProps) {
  return (
    <span className={`inline-flex items-center gap-1 ${className}`}>
      <span className={mono ? 'font-mono text-xs' : ''}>
        {displayValue || value}
      </span>
      <CopyButton value={value} iconSize={12} />
    </span>
  )
}

export { writeToClipboard }

