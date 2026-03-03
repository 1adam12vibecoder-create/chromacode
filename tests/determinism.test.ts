/**
 * Determinism tests: verify that encoding the same data with the same
 * options always produces the exact same PNG output.
 */

import { describe, it, expect } from 'vitest'
import { encode } from '../src/index.js'
import type { EncodingMode, ECLevel } from '../src/types.js'

function makeData(len: number, seed = 0): Uint8Array {
  const data = new Uint8Array(len)
  for (let i = 0; i < len; i++) data[i] = (seed + i * 7 + 13) & 0xff
  return data
}

describe('encoding determinism', () => {
  it('same data + same options = identical PNG bytes', () => {
    const data = makeData(500)
    const opts = { mode: 'rgba64' as EncodingMode, ecLevel: 'M' as ECLevel, cellSize: 1 }
    const png1 = encode(data, opts)
    const png2 = encode(data, opts)
    expect(png1).toEqual(png2)
  })

  it('deterministic across 10 iterations', () => {
    const data = makeData(200)
    const reference = encode(data)
    for (let i = 0; i < 10; i++) {
      expect(encode(data)).toEqual(reference)
    }
  })

  for (const mode of ['rgba64', 'rgba32', 'rgb48', 'rgb24'] as EncodingMode[]) {
    it(`deterministic for ${mode}`, () => {
      const data = makeData(100)
      const png1 = encode(data, { mode })
      const png2 = encode(data, { mode })
      expect(png1).toEqual(png2)
    })
  }

  it('deterministic with compression', () => {
    const data = new Uint8Array(500).fill(0xab) // Compressible data
    const opts = { compress: true }
    const png1 = encode(data, opts)
    const png2 = encode(data, opts)
    expect(png1).toEqual(png2)
  })

  it('different data produces different PNG', () => {
    const data1 = makeData(100, 0)
    const data2 = makeData(100, 1)
    const png1 = encode(data1)
    const png2 = encode(data2)
    expect(png1).not.toEqual(png2)
  })

  it('different mode produces different PNG', () => {
    const data = makeData(100)
    const png1 = encode(data, { mode: 'rgba64' })
    const png2 = encode(data, { mode: 'rgba32' })
    expect(png1).not.toEqual(png2)
  })

  it('different EC level produces different PNG', () => {
    const data = makeData(100)
    const png1 = encode(data, { ecLevel: 'L' })
    const png2 = encode(data, { ecLevel: 'H' })
    expect(png1).not.toEqual(png2)
  })
})
