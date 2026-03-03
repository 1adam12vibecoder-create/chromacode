import { describe, it, expect } from 'vitest'
import { encode, decode } from '../src/index.js'

describe('edge cases', () => {
  it('empty data round-trips', () => {
    const data = new Uint8Array(0)
    const png = encode(data)
    const result = decode(png)
    expect(result).toEqual(data)
  })

  it('single byte round-trips', () => {
    const data = new Uint8Array([0])
    const png = encode(data)
    expect(decode(png)).toEqual(data)
  })

  it('single byte 0xff round-trips', () => {
    const data = new Uint8Array([0xff])
    const png = encode(data)
    expect(decode(png)).toEqual(data)
  })

  it('all zeros round-trips', () => {
    const data = new Uint8Array(100)
    const png = encode(data)
    expect(decode(png)).toEqual(data)
  })

  it('all 0xff round-trips', () => {
    const data = new Uint8Array(100)
    data.fill(0xff)
    const png = encode(data)
    expect(decode(png)).toEqual(data)
  })

  it('sequential bytes round-trip', () => {
    const data = new Uint8Array(256)
    for (let i = 0; i < 256; i++) data[i] = i
    const png = encode(data)
    expect(decode(png)).toEqual(data)
  })

  it('exact RS block boundary (253 bytes with L)', () => {
    // With EC level L, dataPerBlock should be 253 (253+2=255)
    const data = new Uint8Array(253)
    for (let i = 0; i < 253; i++) data[i] = (i * 7) & 0xff
    const png = encode(data)
    expect(decode(png)).toEqual(data)
  })

  it('data slightly over one RS block', () => {
    const data = new Uint8Array(254)
    for (let i = 0; i < 254; i++) data[i] = (i * 11) & 0xff
    const png = encode(data)
    expect(decode(png)).toEqual(data)
  })

  it('works with all four modes', () => {
    const data = new Uint8Array(50)
    for (let i = 0; i < 50; i++) data[i] = (i * 31) & 0xff

    for (const mode of ['rgba64', 'rgba32', 'rgb48', 'rgb24'] as const) {
      const png = encode(data, { mode })
      const result = decode(png)
      expect(result).toEqual(data)
    }
  })

  it('works with all EC levels', () => {
    const data = new Uint8Array(100)
    for (let i = 0; i < 100; i++) data[i] = (i * 41) & 0xff

    for (const ecLevel of ['L', 'M', 'Q', 'H'] as const) {
      const png = encode(data, { ecLevel })
      const result = decode(png)
      expect(result).toEqual(data)
    }
  })

  it('large payload (50KB)', () => {
    const data = new Uint8Array(50000)
    let s = 12345
    for (let i = 0; i < data.length; i++) {
      s = (s * 1103515245 + 12345) & 0x7fffffff
      data[i] = s & 0xff
    }
    const png = encode(data)
    const result = decode(png)
    expect(result).toEqual(data)
  })
})
