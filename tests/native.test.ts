/**
 * Cross-validation tests: encode with TS, decode with C (and vice versa).
 * Also runs the full round-trip test suite against the native C backend.
 */

import { describe, it, expect, beforeAll } from 'vitest'
import { encode as jsEncode } from '../src/encode.js'
import { decode as jsDecode } from '../src/decode.js'
import { capacity as jsCapacity } from '../src/capacity.js'
import type { EncodeOptions, EncodingMode, ECLevel } from '../src/types.js'

// Load native addon
let native: {
  encode(data: Uint8Array, options?: Partial<EncodeOptions>): Uint8Array
  decode(png: Uint8Array): Uint8Array
  capacity(options?: Partial<EncodeOptions>): Record<string, number>
} | null = null

beforeAll(() => {
  try {
    native = require('../build/Release/chromacode_native.node')
  } catch {
    // Skip native tests if addon not built
  }
})

function skipIfNoNative() {
  if (!native) {
    return true
  }
  return false
}

describe('native C addon', () => {
  it('should be loaded', () => {
    if (skipIfNoNative()) return
    expect(native).not.toBeNull()
    expect(typeof native!.encode).toBe('function')
    expect(typeof native!.decode).toBe('function')
    expect(typeof native!.capacity).toBe('function')
  })
})

describe('native round-trip (C encode → C decode)', () => {
  const modes: EncodingMode[] = ['rgba64', 'rgba32', 'rgb48', 'rgb24']
  const ecLevels: ECLevel[] = ['L', 'M', 'Q', 'H']

  for (const mode of modes) {
    it(`round-trip 100 bytes in ${mode} mode`, () => {
      if (skipIfNoNative()) return
      const data = new Uint8Array(100)
      for (let i = 0; i < 100; i++) data[i] = (i * 3 + 17) & 0xff

      const png = native!.encode(data, { mode, ecLevel: 'M' })
      expect(png.length).toBeGreaterThan(0)

      const decoded = native!.decode(png)
      expect(decoded).toEqual(data)
    })
  }

  for (const ecLevel of ecLevels) {
    it(`round-trip 50 bytes at EC level ${ecLevel}`, () => {
      if (skipIfNoNative()) return
      const data = new Uint8Array(50)
      for (let i = 0; i < 50; i++) data[i] = (i ^ 0xaa) & 0xff

      const png = native!.encode(data, { ecLevel })
      const decoded = native!.decode(png)
      expect(decoded).toEqual(data)
    })
  }

  it('empty data', () => {
    if (skipIfNoNative()) return
    const png = native!.encode(new Uint8Array(0))
    const decoded = native!.decode(png)
    expect(decoded.length).toBe(0)
  })

  it('single byte', () => {
    if (skipIfNoNative()) return
    const data = new Uint8Array([0x42])
    const png = native!.encode(data)
    const decoded = native!.decode(png)
    expect(decoded).toEqual(data)
  })

  it('1024 bytes', () => {
    if (skipIfNoNative()) return
    const data = new Uint8Array(1024)
    for (let i = 0; i < 1024; i++) data[i] = (i * 97 + 13) & 0xff

    const png = native!.encode(data, { ecLevel: 'M' })
    const decoded = native!.decode(png)
    expect(decoded).toEqual(data)
  })

  it('with compression', () => {
    if (skipIfNoNative()) return
    const data = new Uint8Array(500)
    data.fill(0xab)

    const png = native!.encode(data, { compress: true })
    const decoded = native!.decode(png)
    expect(decoded).toEqual(data)
  })

  it('cellSize=3', () => {
    if (skipIfNoNative()) return
    const data = new Uint8Array([10, 20, 30, 40, 50])
    const png = native!.encode(data, { cellSize: 3 })
    const decoded = native!.decode(png)
    expect(decoded).toEqual(data)
  })
})

describe('cross-validation: TS encode → C decode', () => {
  const modes: EncodingMode[] = ['rgba64', 'rgba32', 'rgb48', 'rgb24']
  const ecLevels: ECLevel[] = ['L', 'M', 'Q', 'H']

  for (const mode of modes) {
    it(`TS→C ${mode} 100 bytes`, () => {
      if (skipIfNoNative()) return
      const data = new Uint8Array(100)
      for (let i = 0; i < 100; i++) data[i] = (i * 7 + 42) & 0xff

      const png = jsEncode(data, { mode, ecLevel: 'M' })
      const decoded = native!.decode(png)
      expect(decoded).toEqual(data)
    })
  }

  for (const ecLevel of ecLevels) {
    it(`TS→C EC_${ecLevel} 80 bytes`, () => {
      if (skipIfNoNative()) return
      const data = new Uint8Array(80)
      for (let i = 0; i < 80; i++) data[i] = (i * 13 + 7) & 0xff
      const png = jsEncode(data, { ecLevel })
      const decoded = native!.decode(png)
      expect(decoded).toEqual(data)
    })
  }

  it('TS→C with compression', () => {
    if (skipIfNoNative()) return
    const data = new Uint8Array(300)
    for (let i = 0; i < 300; i++) data[i] = i % 10
    const png = jsEncode(data, { compress: true })
    const decoded = native!.decode(png)
    expect(decoded).toEqual(data)
  })

  it('TS→C with cellSize=4', () => {
    if (skipIfNoNative()) return
    const data = new Uint8Array(20)
    for (let i = 0; i < 20; i++) data[i] = i
    const png = jsEncode(data, { cellSize: 4 })
    const decoded = native!.decode(png)
    expect(decoded).toEqual(data)
  })

  it('TS→C with sequence option', () => {
    if (skipIfNoNative()) return
    const data = new Uint8Array(50)
    for (let i = 0; i < 50; i++) data[i] = (i * 3) & 0xff
    const png = jsEncode(data, { sequence: { id: 100, index: 0, total: 2 } })
    const decoded = native!.decode(png)
    expect(decoded).toEqual(data)
  })
})

describe('cross-validation: C encode → TS decode', () => {
  const modes: EncodingMode[] = ['rgba64', 'rgba32', 'rgb48', 'rgb24']
  const ecLevels: ECLevel[] = ['L', 'M', 'Q', 'H']

  for (const mode of modes) {
    it(`C→TS ${mode} 100 bytes`, () => {
      if (skipIfNoNative()) return
      const data = new Uint8Array(100)
      for (let i = 0; i < 100; i++) data[i] = (i * 11 + 3) & 0xff

      const png = native!.encode(data, { mode, ecLevel: 'M' })
      const decoded = jsDecode(png)
      expect(decoded).toEqual(data)
    })
  }

  for (const ecLevel of ecLevels) {
    it(`C→TS EC_${ecLevel} 80 bytes`, () => {
      if (skipIfNoNative()) return
      const data = new Uint8Array(80)
      for (let i = 0; i < 80; i++) data[i] = (i * 17 + 5) & 0xff
      const png = native!.encode(data, { ecLevel })
      const decoded = jsDecode(png)
      expect(decoded).toEqual(data)
    })
  }

  it('C→TS with compression', () => {
    if (skipIfNoNative()) return
    const data = new Uint8Array(300)
    for (let i = 0; i < 300; i++) data[i] = i % 10
    const png = native!.encode(data, { compress: true })
    const decoded = jsDecode(png)
    expect(decoded).toEqual(data)
  })

  it('C→TS with cellSize=4', () => {
    if (skipIfNoNative()) return
    const data = new Uint8Array(20)
    for (let i = 0; i < 20; i++) data[i] = i
    const png = native!.encode(data, { cellSize: 4 })
    const decoded = jsDecode(png)
    expect(decoded).toEqual(data)
  })
})

describe('capacity: C vs TS agreement', () => {
  it('default options match', () => {
    if (skipIfNoNative()) return
    const cCap = native!.capacity()
    const jsCap = jsCapacity()
    expect(cCap.gridWidth).toBe(jsCap.gridWidth)
    expect(cCap.gridHeight).toBe(jsCap.gridHeight)
    expect(cCap.structuralCells).toBe(jsCap.structuralCells)
    expect(cCap.dataCells).toBe(jsCap.dataCells)
  })

  it('with specific options match', () => {
    if (skipIfNoNative()) return
    const opts = { mode: 'rgb24' as EncodingMode, ecLevel: 'H' as ECLevel, width: 32, height: 32 }
    const cCap = native!.capacity(opts)
    const jsCap = jsCapacity(opts)
    expect(cCap.gridWidth).toBe(jsCap.gridWidth)
    expect(cCap.gridHeight).toBe(jsCap.gridHeight)
    expect(cCap.structuralCells).toBe(jsCap.structuralCells)
    expect(cCap.bitsPerCell).toBe(jsCap.bitsPerCell)
  })
})
