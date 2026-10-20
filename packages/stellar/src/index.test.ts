import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Account, Keypair } from '@stellar/stellar-sdk'
import {
  kwhToStroops,
  stroopsToKwh,
  NETWORKS,
  CONTRACT_IDS,
  getRpcServer,
  buildTransaction,
  addressToScVal,
  amountToScVal,
  bytesToScVal,
  stellarExplorerUrl,
  nativeToScVal,
  scValToNative,
  Address,
} from './index'

// ---------------------------------------------------------------------------
// kwhToStroops
// ---------------------------------------------------------------------------
describe('kwhToStroops', () => {
  it('converts whole kWh', () => {
    expect(kwhToStroops(1)).toBe(1_000n)
  })

  it('converts fractional kWh', () => {
    expect(kwhToStroops(0.5)).toBe(500n)
  })

  it('converts zero', () => {
    expect(kwhToStroops(0)).toBe(0n)
  })

  it('rounds sub-unit values', () => {
    // 1.00000001 kWh rounds to 1_000 token units at decimals=3
    expect(kwhToStroops(1.00000001)).toBe(1_000n)
  })

  it('handles large values', () => {
    expect(kwhToStroops(1000)).toBe(1_000_000n)
  })

  it('handles the smallest representable unit (0.001 kWh)', () => {
    expect(kwhToStroops(0.001)).toBe(1n)
  })

  it('returns bigint type', () => {
    expect(typeof kwhToStroops(5)).toBe('bigint')
  })

  it('handles floating-point precision edge case (0.1 kWh)', () => {
    // 0.1 * 1000 = 100.00000000000001 in JS — must round correctly
    expect(kwhToStroops(0.1)).toBe(100n)
  })

  it('handles negative values', () => {
    // Negative kWh is technically invalid but the function should not throw
    expect(kwhToStroops(-1)).toBe(-1_000n)
  })
})

// ---------------------------------------------------------------------------
// stroopsToKwh
// ---------------------------------------------------------------------------
describe('stroopsToKwh', () => {
  it('converts stroops to kWh', () => {
    expect(stroopsToKwh(1_000n)).toBe(1)
  })

  it('converts zero', () => {
    expect(stroopsToKwh(0n)).toBe(0)
  })

  it('converts fractional result', () => {
    expect(stroopsToKwh(500n)).toBe(0.5)
  })

  it('round-trips with kwhToStroops', () => {
    const kwh = 12.5
    expect(stroopsToKwh(kwhToStroops(kwh))).toBe(kwh)
  })

  it('returns number type', () => {
    expect(typeof stroopsToKwh(1_000n)).toBe('number')
  })

  it('handles large bigint values without precision loss in normal range', () => {
    expect(stroopsToKwh(1_000_000n)).toBe(1000)
  })

  it('round-trips for many common values', () => {
    const values = [0.001, 0.1, 0.5, 1, 5, 10, 100, 999.999]
    for (const v of values) {
      expect(stroopsToKwh(kwhToStroops(v))).toBeCloseTo(v, 3)
    }
  })
})

// ---------------------------------------------------------------------------
// NETWORKS
// ---------------------------------------------------------------------------
describe('NETWORKS', () => {
  it('has testnet config', () => {
    expect(NETWORKS.testnet.rpcUrl).toContain('testnet')
    expect(NETWORKS.testnet.networkPassphrase).toBeTruthy()
  })

  it('has mainnet config', () => {
    expect(NETWORKS.mainnet.rpcUrl).toContain('mainnet')
    expect(NETWORKS.mainnet.networkPassphrase).toBeTruthy()
  })

  it('testnet and mainnet passphrases are different', () => {
    expect(NETWORKS.testnet.networkPassphrase).not.toBe(NETWORKS.mainnet.networkPassphrase)
  })

  it('RPC URLs use HTTPS', () => {
    expect(NETWORKS.testnet.rpcUrl.startsWith('https://')).toBe(true)
    expect(NETWORKS.mainnet.rpcUrl.startsWith('https://')).toBe(true)
  })

  it('testnet RPC URL does not point to mainnet', () => {
    expect(NETWORKS.testnet.rpcUrl).not.toContain('mainnet')
  })
})

// ---------------------------------------------------------------------------
// CONTRACT_IDS
// ---------------------------------------------------------------------------
describe('CONTRACT_IDS', () => {
  it('has testnet contract slots', () => {
    expect(CONTRACT_IDS.testnet).toHaveProperty('energy_token')
    expect(CONTRACT_IDS.testnet).toHaveProperty('audit_registry')
    expect(CONTRACT_IDS.testnet).toHaveProperty('community_governance')
  })

  it('has mainnet contract slots', () => {
    expect(CONTRACT_IDS.mainnet).toHaveProperty('energy_token')
    expect(CONTRACT_IDS.mainnet).toHaveProperty('audit_registry')
    expect(CONTRACT_IDS.mainnet).toHaveProperty('community_governance')
  })

  it('mainnet contract IDs are empty strings until deployed', () => {
    // Mainnet is not yet deployed — IDs should be empty
    expect(CONTRACT_IDS.mainnet.energy_token).toBe('')
    expect(CONTRACT_IDS.mainnet.audit_registry).toBe('')
    expect(CONTRACT_IDS.mainnet.community_governance).toBe('')
  })

  it('testnet IDs fall back to empty string when env vars are unset', () => {
    // In a clean test environment without env vars, values should be strings
    expect(typeof CONTRACT_IDS.testnet.energy_token).toBe('string')
    expect(typeof CONTRACT_IDS.testnet.audit_registry).toBe('string')
    expect(typeof CONTRACT_IDS.testnet.community_governance).toBe('string')
  })
})

// ---------------------------------------------------------------------------
// getRpcServer
// ---------------------------------------------------------------------------
describe('getRpcServer', () => {
  it('returns a server instance for testnet (default)', () => {
    const server = getRpcServer()
    expect(server).toBeDefined()
    expect(typeof server).toBe('object')
  })

  it('returns a server instance for testnet explicitly', () => {
    const server = getRpcServer('testnet')
    expect(server).toBeDefined()
  })

  it('returns a server instance for mainnet', () => {
    const server = getRpcServer('mainnet')
    expect(server).toBeDefined()
  })

  it('testnet and mainnet servers are distinct instances', () => {
    const testnet = getRpcServer('testnet')
    const mainnet = getRpcServer('mainnet')
    expect(testnet).not.toBe(mainnet)
  })
})

// ---------------------------------------------------------------------------
// buildTransaction
// ---------------------------------------------------------------------------
describe('buildTransaction', () => {
  // Use a real keypair so TransactionBuilder gets a valid Ed25519 public key
  const keypair = Keypair.random()
  const mockSourceKey = keypair.publicKey()
  // Valid Stellar C-address (contract address) format — starts with 'C', 56 chars
  const mockContractId = 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM'
  const mockMethod = 'mint'

  it('calls server.getAccount and server.prepareTransaction', async () => {
    const realAccount = new Account(mockSourceKey, '100')
    const mockTx = { toXDR: () => 'mock-xdr' }
    const mockServer = {
      getAccount: vi.fn().mockResolvedValue(realAccount),
      prepareTransaction: vi.fn().mockResolvedValue(mockTx),
    } as unknown as Parameters<typeof buildTransaction>[0]

    const result = await buildTransaction(
      mockServer,
      mockSourceKey,
      mockContractId,
      mockMethod,
      [],
      'testnet'
    )

    expect(mockServer.getAccount).toHaveBeenCalledWith(mockSourceKey)
    expect(mockServer.prepareTransaction).toHaveBeenCalledTimes(1)
    expect(result).toBe(mockTx)
  })

  it('defaults to testnet network when no network argument given', async () => {
    const realAccount = new Account(mockSourceKey, '100')
    const mockTx = { toXDR: () => 'mock-xdr' }
    const prepareSpy = vi.fn().mockResolvedValue(mockTx)
    const mockServer = {
      getAccount: vi.fn().mockResolvedValue(realAccount),
      prepareTransaction: prepareSpy,
    } as unknown as Parameters<typeof buildTransaction>[0]

    await buildTransaction(mockServer, mockSourceKey, mockContractId, mockMethod, [])

    expect(prepareSpy).toHaveBeenCalledTimes(1)
  })

  it('propagates errors from server.getAccount', async () => {
    const mockServer = {
      getAccount: vi.fn().mockRejectedValue(new Error('Account not found')),
      prepareTransaction: vi.fn(),
    } as unknown as Parameters<typeof buildTransaction>[0]

    await expect(
      buildTransaction(mockServer, mockSourceKey, mockContractId, mockMethod, [])
    ).rejects.toThrow('Account not found')
  })

  it('propagates errors from server.prepareTransaction (simulation failure)', async () => {
    const realAccount = new Account(mockSourceKey, '100')
    const mockServer = {
      getAccount: vi.fn().mockResolvedValue(realAccount),
      prepareTransaction: vi.fn().mockRejectedValue(new Error('Simulation failed')),
    } as unknown as Parameters<typeof buildTransaction>[0]

    await expect(
      buildTransaction(mockServer, mockSourceKey, mockContractId, mockMethod, [])
    ).rejects.toThrow('Simulation failed')
  })
})

// ---------------------------------------------------------------------------
// addressToScVal
// ---------------------------------------------------------------------------
describe('addressToScVal', () => {
  // addressToScVal wraps Address.fromString — which in stellar-sdk v13 only
  // accepts C-addresses (contracts). G-addresses must go through Address.account().
  const validContractAddress = 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM'

  it('encodes a valid C-address (contract) without throwing', () => {
    expect(() => addressToScVal(validContractAddress)).not.toThrow()
  })

  it('returns an xdr.ScVal object', () => {
    const result = addressToScVal(validContractAddress)
    expect(result).toBeDefined()
    expect(typeof result).toBe('object')
  })

  it('throws on an invalid address string', () => {
    expect(() => addressToScVal('not-a-stellar-address')).toThrow()
  })

  it('throws on an empty string', () => {
    expect(() => addressToScVal('')).toThrow()
  })

  it('round-trips through nativeToScVal / scValToNative', () => {
    const scVal = addressToScVal(validContractAddress)
    // scValToNative on an address ScVal returns an Address instance
    const decoded = scValToNative(scVal)
    expect(decoded).toBeDefined()
  })
})

// ---------------------------------------------------------------------------
// amountToScVal
// ---------------------------------------------------------------------------
describe('amountToScVal', () => {
  it('encodes a positive bigint without throwing', () => {
    expect(() => amountToScVal(1_000n)).not.toThrow()
  })

  it('returns an xdr.ScVal object', () => {
    const result = amountToScVal(500n)
    expect(result).toBeDefined()
    expect(typeof result).toBe('object')
  })

  it('encodes zero', () => {
    expect(() => amountToScVal(0n)).not.toThrow()
  })

  it('encodes a large i128 value (max safe for energy metering)', () => {
    // 10^15 stroops ≈ 10^12 kWh — well within i128 range
    expect(() => amountToScVal(1_000_000_000_000_000n)).not.toThrow()
  })

  it('round-trips through scValToNative', () => {
    const amount = 42_000n
    const scVal = amountToScVal(amount)
    // scValToNative on i128 returns a bigint
    const decoded = scValToNative(scVal)
    expect(decoded).toBe(amount)
  })
})

// ---------------------------------------------------------------------------
// bytesToScVal
// ---------------------------------------------------------------------------
describe('bytesToScVal', () => {
  it('encodes a 32-byte hash without throwing', () => {
    const hash = new Uint8Array(32).fill(0xab)
    expect(() => bytesToScVal(hash)).not.toThrow()
  })

  it('returns an xdr.ScVal object', () => {
    const result = bytesToScVal(new Uint8Array(32))
    expect(result).toBeDefined()
    expect(typeof result).toBe('object')
  })

  it('encodes an empty Uint8Array', () => {
    expect(() => bytesToScVal(new Uint8Array(0))).not.toThrow()
  })

  it('round-trips through scValToNative', () => {
    const input = new Uint8Array([1, 2, 3, 4, 5])
    const scVal = bytesToScVal(input)
    const decoded = scValToNative(scVal) as Uint8Array
    expect(decoded).toEqual(input)
  })

  it('encodes a SHA-256 digest (32 bytes)', () => {
    const sha256 = new Uint8Array(32)
    crypto.getRandomValues(sha256)
    expect(() => bytesToScVal(sha256)).not.toThrow()
  })
})

// ---------------------------------------------------------------------------
// stellarExplorerUrl
// ---------------------------------------------------------------------------
describe('stellarExplorerUrl', () => {
  const txId = 'abc123txhash'
  const contractId = 'CCJZ5DGAZBUR5LFEC3RUOP4UXLCUKLC5OA7CZXTPCLXNG5VT77R7QKT'

  it('builds a testnet transaction URL', () => {
    const url = stellarExplorerUrl('tx', txId, 'testnet')
    expect(url).toBe(`https://stellar.expert/explorer/testnet/tx/${txId}`)
  })

  it('builds a mainnet transaction URL', () => {
    const url = stellarExplorerUrl('tx', txId, 'mainnet')
    expect(url).toBe(`https://stellar.expert/explorer/public/tx/${txId}`)
  })

  it('builds a testnet contract URL', () => {
    const url = stellarExplorerUrl('contract', contractId, 'testnet')
    expect(url).toBe(`https://stellar.expert/explorer/testnet/contract/${contractId}`)
  })

  it('builds a mainnet contract URL', () => {
    const url = stellarExplorerUrl('contract', contractId, 'mainnet')
    expect(url).toBe(`https://stellar.expert/explorer/public/contract/${contractId}`)
  })

  it('defaults to testnet when no network is provided', () => {
    const url = stellarExplorerUrl('tx', txId)
    expect(url).toContain('testnet')
  })

  it('returns a valid HTTPS URL', () => {
    const url = stellarExplorerUrl('tx', txId, 'testnet')
    expect(url.startsWith('https://')).toBe(true)
  })

  it('includes the ID in the URL', () => {
    const url = stellarExplorerUrl('tx', txId, 'testnet')
    expect(url).toContain(txId)
  })

  it('uses "public" path segment for mainnet (not "mainnet")', () => {
    const url = stellarExplorerUrl('tx', txId, 'mainnet')
    expect(url).toContain('/public/')
    expect(url).not.toContain('/mainnet/')
  })
})

// ---------------------------------------------------------------------------
// Re-exports: nativeToScVal, scValToNative, Address
// ---------------------------------------------------------------------------
describe('re-exported SDK helpers', () => {
  it('nativeToScVal is exported and callable', () => {
    expect(typeof nativeToScVal).toBe('function')
    expect(() => nativeToScVal(42, { type: 'i32' })).not.toThrow()
  })

  it('scValToNative is exported and callable', () => {
    expect(typeof scValToNative).toBe('function')
    const scVal = nativeToScVal(99, { type: 'i32' })
    expect(scValToNative(scVal)).toBe(99)
  })

  it('Address is exported', () => {
    expect(Address).toBeDefined()
  })

  it('Address.fromString parses a valid C-address (contract)', () => {
    // In stellar-sdk v13, Address.fromString only accepts C-addresses.
    // G-addresses (accounts) require Address.account(publicKey) instead.
    const contractAddr = 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM'
    expect(() => Address.fromString(contractAddr)).not.toThrow()
  })

  it('Address.fromString throws on an invalid address', () => {
    expect(() => Address.fromString('bad-address')).toThrow()
  })
})
