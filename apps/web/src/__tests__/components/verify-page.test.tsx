/**
 * Snapshot/regression tests for the verify page
 * Issue #594 — catch unintended visual regressions across all states
 *
 * To update snapshots after intentional changes:
 *   pnpm test -- --update-snapshots
 */
// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react'
import VerifyPage from '@/app/verify/page'

vi.mock('lucide-react', () => ({
  Shield: (props: Record<string, unknown>) => <span data-icon="Shield" {...props} />,
  Search: (props: Record<string, unknown>) => <span data-icon="Search" {...props} />,
  CheckCircle: (props: Record<string, unknown>) => <span data-icon="CheckCircle" {...props} />,
  XCircle: (props: Record<string, unknown>) => <span data-icon="XCircle" {...props} />,
  ExternalLink: (props: Record<string, unknown>) => <span data-icon="ExternalLink" {...props} />,
}))

vi.mock('@/components/skeleton', () => ({
  SectionSkeleton: ({ rows }: { rows?: number }) => (
    <div data-testid="section-skeleton" data-rows={rows} />
  ),
}))

const mockChainOfCustody = {
  certificate: {
    id: 'cert-abc-123',
    kwh: 12.5,
    issued_at: '2024-01-15T10:00:00.000Z',
    retired: false,
    retired_at: null,
    retired_by: null,
  },
  on_chain: {
    anchor_tx: 'anchor-tx-hash-abc',
    anchor_explorer: 'https://stellar.expert/anchor-tx-hash-abc',
    mint_tx: 'mint-tx-hash-def',
    mint_explorer: 'https://stellar.expert/mint-tx-hash-def',
  },
  meter_proof: {
    meter_id: 'meter-xyz-456',
    reading_hash: 'abcdef1234567890abcdef1234567890',
    signature_hex: 'sig1234567890abcdef1234567890abc',
    kwh: 12.5,
    timestamp: '2024-01-15T09:55:00.000Z',
    verified: true,
  },
}

beforeEach(() => {
  vi.restoreAllMocks()
})

describe('VerifyPage snapshots', () => {
  it('renders idle state', () => {
    const { container } = render(<VerifyPage />)
    expect(container).toMatchSnapshot()
  })

  it('renders search form with correct accessibility attributes', () => {
    render(<VerifyPage />)
    const input = screen.getByRole('searchbox')
    expect(input.getAttribute('aria-label')).toBe('Certificate ID, reading hash, or transaction hash')
    expect(input.getAttribute('aria-required')).toBe('true')

    const button = screen.getByRole('button', { name: /verify certificate/i })
    expect(button.getAttribute('aria-label')).toBe('Verify certificate')
    expect(button.getAttribute('aria-busy')).toBe('false')
  })

  it('renders error state', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      json: async () => ({ error: 'Not found' }),
    }))

    const { container } = render(<VerifyPage />)
    const input = screen.getByRole('searchbox')
    const button = screen.getByRole('button', { name: /verify certificate/i })

    fireEvent.change(input, { target: { value: 'bad-id' } })
    await act(async () => { fireEvent.click(button) })

    await waitFor(() => screen.getByRole('alert'))
    expect(container).toMatchSnapshot()
  })

  it('renders success result', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => mockChainOfCustody,
    }))

    const { container } = render(<VerifyPage />)
    const input = screen.getByRole('searchbox')
    const button = screen.getByRole('button', { name: /verify certificate/i })

    fireEvent.change(input, { target: { value: 'cert-abc-123' } })
    await act(async () => { fireEvent.click(button) })

    await waitFor(() => screen.getByRole('status'))
    expect(container).toMatchSnapshot()
  })
})
