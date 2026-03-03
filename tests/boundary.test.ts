/**
 * Boundary and stress tests: exact RS block boundaries,
 * max grid dimensions, min grid, large payloads, and
 * regression tests for fixed bugs.
 */

import { describe, it, expect } from 'vitest'
import { encode, decode, capacity } from '../src/index.js'
import { autoSize, usableCapacity } from '../src/auto-size.js'
import { ecSymbolCount } from '../src/reed-solomon.js'
import { dataCellCount, structuralCellCount, encodeHeader, decodeHeader } from '../src/grid.js'
import {
  EC_RATIO,
  RS_MAX_BLOCK,
  MIN_GRID_SIZE,
  MAX_GRID_SIZE,
  MAX_CELL_SIZE,
} from '../src/types.js'
import type { EncodingMode, ECLevel } from '../src/types.js'

/** Helper: create deterministic test data */
function makeData(len: number, seed = 0): Uint8Array {
  const data = new Uint8Array(len)
  for (let i = 0; i < len; i++) data[i] = (seed + i * 7 + 13) & 0xff
  return data
}

describe('RS block boundary round-trips', () => {
  // At EC level L (7%), dataPerBlock = 237, ecCount = 18, total = 255
  // These test data sizes that land exactly on block boundaries

  it('exact single block: 237 bytes at EC_L', () => {
    const data = makeData(237)
    expect(decode(encode(data, { ecLevel: 'L' }))).toEqual(data)
  })

  it('one byte over single block: 238 bytes at EC_L', () => {
    const data = makeData(238)
    expect(decode(encode(data, { ecLevel: 'L' }))).toEqual(data)
  })

  it('exact two blocks: 474 bytes at EC_L', () => {
    const data = makeData(474)
    expect(decode(encode(data, { ecLevel: 'L' }))).toEqual(data)
  })

  it('one byte over two blocks: 475 bytes at EC_L', () => {
    const data = makeData(475)
    expect(decode(encode(data, { ecLevel: 'L' }))).toEqual(data)
  })

  it('1 byte (minimum non-empty data)', () => {
    const data = new Uint8Array([0x42])
    expect(decode(encode(data))).toEqual(data)
  })

  it('exact block boundary for EC_H', () => {
    // EC_H (30%): find dataPerBlock
    const ecRatio = EC_RATIO['H']
    let dataPerBlock = RS_MAX_BLOCK - 2
    for (; dataPerBlock >= 1; dataPerBlock--) {
      const ec = ecSymbolCount(dataPerBlock, ecRatio)
      if (dataPerBlock + ec <= RS_MAX_BLOCK) break
    }
    // Test at exact boundary and boundary+1
    const data1 = makeData(dataPerBlock)
    const data2 = makeData(dataPerBlock + 1)
    expect(decode(encode(data1, { ecLevel: 'H' }))).toEqual(data1)
    expect(decode(encode(data2, { ecLevel: 'H' }))).toEqual(data2)
  })

  // Test many block counts
  for (const numBlocks of [1, 2, 3, 5, 10, 20]) {
    it(`exactly ${numBlocks} RS blocks at EC_L`, () => {
      const data = makeData(237 * numBlocks)
      expect(decode(encode(data, { ecLevel: 'L' }))).toEqual(data)
    })
  }
})

describe('grid dimension boundaries', () => {
  it('minimum grid (16x16) handles small data', () => {
    const data = makeData(10)
    const png = encode(data, { width: 16, height: 16 })
    expect(decode(png)).toEqual(data)
  })

  it('MAX_GRID_SIZE constant is 4095', () => {
    expect(MAX_GRID_SIZE).toBe(4095)
  })

  it('autoSize never returns > 4095', () => {
    // Test with a payload that requires a large grid
    const auto = autoSize(50000, 'rgba64', 'L', false)
    expect(auto.width).toBeLessThanOrEqual(4095)
    expect(auto.height).toBeLessThanOrEqual(4095)
  })

  it('autoSize returns minimum grid for empty data', () => {
    const auto = autoSize(0, 'rgba64', 'L', false)
    expect(auto.width).toBe(MIN_GRID_SIZE)
    expect(auto.height).toBe(MIN_GRID_SIZE)
  })

  it('header encodes/decodes grid dimensions 4095x4095', () => {
    const header = {
      version: 1,
      mode: 'rgba64' as EncodingMode,
      ecLevel: 'L' as ECLevel,
      compressed: false,
      gridWidth: 4095,
      gridHeight: 4095,
      dataLength: 1000,
    }
    const bytes = encodeHeader(header)
    const decoded = decodeHeader(bytes)
    expect(decoded.gridWidth).toBe(4095)
    expect(decoded.gridHeight).toBe(4095)
  })

  it('rectangular grid works', () => {
    const data = makeData(50)
    const png = encode(data, { width: 20, height: 30 })
    expect(decode(png)).toEqual(data)
  })

  it('wide rectangle works', () => {
    const data = makeData(50)
    const png = encode(data, { width: 40, height: 16 })
    expect(decode(png)).toEqual(data)
  })
})

describe('cell size boundaries', () => {
  it('cellSize=1 (minimum)', () => {
    const data = makeData(50)
    expect(decode(encode(data, { cellSize: 1 }))).toEqual(data)
  })

  it('cellSize=MAX_CELL_SIZE (32)', () => {
    const data = makeData(10)
    expect(decode(encode(data, { cellSize: MAX_CELL_SIZE }))).toEqual(data)
  })

  for (const cellSize of [1, 2, 3, 4, 8, 16]) {
    it(`round-trips with cellSize=${cellSize}`, () => {
      const data = makeData(20)
      expect(decode(encode(data, { cellSize }))).toEqual(data)
    })
  }
})

describe('data size stress tests', () => {
  it('100 KB payload', () => {
    const data = makeData(100_000)
    expect(decode(encode(data))).toEqual(data)
  }, 30_000)

  it('near-max capacity for a 100x100 grid', () => {
    const cap = capacity({ width: 100, height: 100, mode: 'rgba64', ecLevel: 'L' })
    // Encode at ~90% of reported capacity to be safe
    const safeSize = Math.floor(cap.dataBytes * 0.9)
    if (safeSize > 0) {
      const data = makeData(safeSize)
      expect(decode(encode(data, { width: 100, height: 100 }))).toEqual(data)
    }
  }, 30_000)
})

describe('all mode x ecLevel combinations', () => {
  const modes: EncodingMode[] = ['rgba64', 'rgba32', 'rgb48', 'rgb24']
  const ecLevels: ECLevel[] = ['L', 'M', 'Q', 'H']

  for (const mode of modes) {
    for (const ecLevel of ecLevels) {
      it(`${mode} + EC_${ecLevel}: round-trip 100 bytes`, () => {
        const data = makeData(100, modes.indexOf(mode) * 4 + ecLevels.indexOf(ecLevel))
        expect(decode(encode(data, { mode, ecLevel }))).toEqual(data)
      })
    }
  }
})

describe('structural cell counting consistency', () => {
  for (const size of [16, 20, 32, 50, 100, 200]) {
    it(`structural + data = total for ${size}x${size}`, () => {
      const total = size * size
      const structural = structuralCellCount(size, size)
      const dataCells = dataCellCount(size, size)
      expect(structural + dataCells).toBe(total)
    })
  }

  it('structural count for rectangular grid', () => {
    const w = 30,
      h = 40
    const total = w * h
    const structural = structuralCellCount(w, h)
    const dataCells = dataCellCount(w, h)
    expect(structural + dataCells).toBe(total)
    expect(structural).toBeGreaterThan(0)
    expect(dataCells).toBeGreaterThan(0)
  })
})

describe('usableCapacity is conservative (never overestimates)', () => {
  const modes: EncodingMode[] = ['rgba64', 'rgba32', 'rgb48', 'rgb24']
  const ecLevels: ECLevel[] = ['L', 'M', 'Q', 'H']

  for (const mode of modes) {
    for (const ecLevel of ecLevels) {
      it(`encode succeeds at usableCapacity for ${mode} EC_${ecLevel} 30x30`, () => {
        const cap = usableCapacity(30, 30, mode, ecLevel, false)
        if (cap > 0) {
          const data = makeData(cap)
          // Should not throw — usableCapacity should never overestimate
          const png = encode(data, { mode, ecLevel, width: 30, height: 30 })
          expect(decode(png)).toEqual(data)
        }
      })
    }
  }
})
