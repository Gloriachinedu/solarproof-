/**
 * Tests for useWallet hook using the mock Freighter wallet.
 * Runs headlessly in CI — no browser extension required.
 */
// @vitest-environment jsdom

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { installMockFreighter, uninstallMockFreighter } from '@/tests/mock-freighter'
import { useWallet } from '@/hooks/useWallet'

// jsdom sessionStorage is available in this environment
beforeEach(() => {
  installMockFreighter()
  sessionStorage.clear()
})

afterEach(() => {
  uninstallMockFreighter()
  sessionStorage.clear()
})

describe('useWallet — mock Freighter', () => {
  it('starts disconnected', async () => {
    const { result } = renderHook(() => useWallet())
    // Wait for restore effect
    await act(async () => {})
    expect(result.current.connected).toBe(false)
    expect(result.current.address).toBeNull()
  })

  it('connects and returns the public key', async () => {
    const { result } = renderHook(() => useWallet())
    await act(async () => {})

    await act(async () => {
      await result.current.connect()
    })

    expect(result.current.connected).toBe(true)
    expect(result.current.address).toBe('GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN')
  })

  it('persists connection in sessionStorage', async () => {
    const { result } = renderHook(() => useWallet())
    await act(async () => {})

    await act(async () => {
      await result.current.connect()
    })

    const stored = JSON.parse(sessionStorage.getItem('solarproof-wallet') ?? '{}')
    expect(stored.connected).toBe(true)
    expect(stored.address).toBe('GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN')
  })

  it('disconnects and clears sessionStorage', async () => {
    const { result } = renderHook(() => useWallet())
    await act(async () => {})

    await act(async () => { await result.current.connect() })
    await act(async () => { result.current.disconnect() })

    expect(result.current.connected).toBe(false)
    expect(result.current.address).toBeNull()
    expect(sessionStorage.getItem('solarproof-wallet')).toBeNull()
  })

  it('restores session when wallet is still allowed', async () => {
    // Pre-populate sessionStorage as if a previous session connected
    sessionStorage.setItem('solarproof-wallet', JSON.stringify({
      address: 'GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN',
      connected: true,
    }))

    const { result } = renderHook(() => useWallet())
    await act(async () => {})

    expect(result.current.connected).toBe(true)
    expect(result.current.address).toBe('GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN')
  })

  it('clears session when wallet is no longer allowed', async () => {
    // Install mock that requires explicit access
    uninstallMockFreighter()
    installMockFreighter({ requiresAccess: true })

    sessionStorage.setItem('solarproof-wallet', JSON.stringify({
      address: 'GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN',
      connected: true,
    }))

    const { result } = renderHook(() => useWallet())
    await act(async () => {})

    expect(result.current.connected).toBe(false)
    expect(sessionStorage.getItem('solarproof-wallet')).toBeNull()
  })

  it('throws when Freighter is not installed', async () => {
    uninstallMockFreighter()

    const { result } = renderHook(() => useWallet())
    await act(async () => {})

    await expect(
      act(async () => { await result.current.connect() })
    ).rejects.toThrow('Freighter wallet extension not found')
  })

  it('mock does not affect production wallet behavior', () => {
    // The mock is only installed on window.freighter — it does not patch
    // any production module. Uninstalling removes it completely.
    uninstallMockFreighter()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((globalThis as any).window?.freighter).toBeUndefined()
  })
})
