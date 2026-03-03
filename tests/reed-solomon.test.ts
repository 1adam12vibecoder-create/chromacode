import { describe, it, expect } from 'vitest'
import { rsEncode, rsDecode, generatorPoly, ecSymbolCount } from '../src/reed-solomon.js'

describe('generatorPoly', () => {
  it('generates degree-1 polynomial', () => {
    // g(x) = (x - alpha^0) = (x - 1) → [1, 1]
    const g = generatorPoly(1)
    expect(g.length).toBe(2)
    expect(g[0]).toBe(1)
    expect(g[1]).toBe(1) // alpha^0 = 1
  })

  it('generates degree-2 polynomial', () => {
    const g = generatorPoly(2)
    expect(g.length).toBe(3)
    expect(g[0]).toBe(1) // leading coefficient is always 1
  })

  it('has correct length', () => {
    for (const n of [4, 8, 16, 32]) {
      expect(generatorPoly(n).length).toBe(n + 1)
    }
  })
})

describe('rsEncode', () => {
  it('produces codeword of correct length', () => {
    const data = new Uint8Array([1, 2, 3, 4, 5])
    const ecCount = 4
    const encoded = rsEncode(data, ecCount)
    expect(encoded.length).toBe(data.length + ecCount)
    // Data portion is preserved
    expect(encoded.slice(0, data.length)).toEqual(data)
  })

  it('EC symbols are not all zero for non-zero data', () => {
    const data = new Uint8Array([1, 2, 3])
    const encoded = rsEncode(data, 4)
    const ec = encoded.slice(data.length)
    const allZero = ec.every((b) => b === 0)
    expect(allZero).toBe(false)
  })
})

describe('rsDecode', () => {
  it('decodes uncorrupted codeword', () => {
    const data = new Uint8Array([10, 20, 30, 40, 50])
    const ecCount = 6
    const encoded = rsEncode(data, ecCount)
    const decoded = rsDecode(encoded, ecCount)
    expect(decoded).toEqual(data)
  })

  it('corrects single-symbol error', () => {
    const data = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])
    const ecCount = 10
    const encoded = rsEncode(data, ecCount)

    // Corrupt one symbol in the data portion
    const corrupted = new Uint8Array(encoded)
    corrupted[3] ^= 0xff

    const decoded = rsDecode(corrupted, ecCount)
    expect(decoded).toEqual(data)
  })

  it('corrects multiple symbol errors up to t=ecCount/2', () => {
    const data = new Uint8Array([100, 101, 102, 103, 104, 105, 106, 107, 108, 109])
    const ecCount = 10 // can correct up to 5 errors
    const encoded = rsEncode(data, ecCount)

    // Corrupt 4 symbols (within correction capacity of 5)
    const corrupted = new Uint8Array(encoded)
    corrupted[0] ^= 0x42
    corrupted[2] ^= 0x13
    corrupted[5] ^= 0xff
    corrupted[7] ^= 0x01

    const decoded = rsDecode(corrupted, ecCount)
    expect(decoded).toEqual(data)
  })

  it('corrects errors in EC portion', () => {
    const data = new Uint8Array([1, 2, 3])
    const ecCount = 8
    const encoded = rsEncode(data, ecCount)

    // Corrupt EC symbols
    const corrupted = new Uint8Array(encoded)
    corrupted[data.length + 1] ^= 0xab
    corrupted[data.length + 3] ^= 0xcd

    const decoded = rsDecode(corrupted, ecCount)
    expect(decoded).toEqual(data)
  })

  it('throws on too many errors', () => {
    const data = new Uint8Array([1, 2, 3, 4, 5])
    const ecCount = 4 // can correct up to 2 errors
    const encoded = rsEncode(data, ecCount)

    // Corrupt 3 symbols (exceeds capacity)
    const corrupted = new Uint8Array(encoded)
    corrupted[0] ^= 0xff
    corrupted[1] ^= 0xff
    corrupted[2] ^= 0xff

    expect(() => rsDecode(corrupted, ecCount)).toThrow()
  })

  it('round-trips various data sizes', () => {
    for (const len of [1, 5, 10, 50, 100, 200]) {
      const data = new Uint8Array(len)
      for (let i = 0; i < len; i++) data[i] = (i * 37 + 13) & 0xff
      const ecCount = Math.min(Math.max(2, Math.ceil(len * 0.15)), 55)
      const encoded = rsEncode(data, ecCount)
      const decoded = rsDecode(encoded, ecCount)
      expect(decoded).toEqual(data)
    }
  })

  it('handles all-zero data', () => {
    const data = new Uint8Array(10)
    const ecCount = 4
    const encoded = rsEncode(data, ecCount)
    const decoded = rsDecode(encoded, ecCount)
    expect(decoded).toEqual(data)
  })
})

describe('ecSymbolCount', () => {
  it('returns at least 2', () => {
    expect(ecSymbolCount(1, 0.07)).toBeGreaterThanOrEqual(2)
  })

  it('scales with data length and ratio', () => {
    const lowEc = ecSymbolCount(100, 0.07)
    const highEc = ecSymbolCount(100, 0.3)
    expect(highEc).toBeGreaterThan(lowEc)
  })
})
