import { describe, it, expect } from 'vitest'
import { crc32, crc32Multi } from '../src/crc32.js'

describe('crc32', () => {
  it('computes correct CRC for empty buffer', () => {
    expect(crc32(new Uint8Array(0))).toBe(0x00000000)
  })

  it('computes correct CRC for known string', () => {
    // CRC32 of "123456789" is 0xCBF43926
    const data = new TextEncoder().encode('123456789')
    expect(crc32(data)).toBe(0xcbf43926)
  })

  it('computes correct CRC for single byte', () => {
    // CRC32 of [0x00] is 0xD202EF8D
    expect(crc32(new Uint8Array([0x00]))).toBe(0xd202ef8d)
  })

  it('computes correct CRC for "IEND" (PNG chunk type)', () => {
    const data = new TextEncoder().encode('IEND')
    expect(crc32(data)).toBe(0xae426082)
  })

  it('crc32Multi matches single-buffer crc32', () => {
    const full = new TextEncoder().encode('123456789')
    const a = full.slice(0, 5)
    const b = full.slice(5)
    expect(crc32Multi(a, b)).toBe(crc32(full))
  })

  it('crc32Multi with single buffer equals crc32', () => {
    const data = new Uint8Array([1, 2, 3, 4, 5])
    expect(crc32Multi(data)).toBe(crc32(data))
  })
})
