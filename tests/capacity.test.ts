import { describe, it, expect } from 'vitest'
import { capacity } from '../src/capacity.js'

describe('capacity', () => {
  it('returns valid info for defaults', () => {
    const info = capacity()
    expect(info.gridWidth).toBeGreaterThanOrEqual(16)
    expect(info.gridHeight).toBeGreaterThanOrEqual(16)
    expect(info.totalCells).toBe(info.gridWidth * info.gridHeight)
    expect(info.dataCells + info.structuralCells).toBe(info.totalCells)
    expect(info.bitsPerCell).toBe(64) // rgba64
    expect(info.dataBytes).toBeGreaterThan(0)
    expect(info.ecBytes).toBeGreaterThanOrEqual(0)
  })

  it('larger grid has more capacity', () => {
    const small = capacity({ width: 20, height: 20 })
    const large = capacity({ width: 50, height: 50 })
    expect(large.dataBytes).toBeGreaterThan(small.dataBytes)
  })

  it('higher EC level reduces data capacity', () => {
    const low = capacity({ width: 50, height: 50, ecLevel: 'L' })
    const high = capacity({ width: 50, height: 50, ecLevel: 'H' })
    expect(high.dataBytes).toBeLessThan(low.dataBytes)
  })

  it('rgba64 has more capacity than rgba32 at same grid size', () => {
    const r64 = capacity({ width: 50, height: 50, mode: 'rgba64' })
    const r32 = capacity({ width: 50, height: 50, mode: 'rgba32' })
    expect(r64.dataBytes).toBeGreaterThan(r32.dataBytes)
  })

  it('specified dimensions are used', () => {
    const info = capacity({ width: 100, height: 80 })
    expect(info.gridWidth).toBe(100)
    expect(info.gridHeight).toBe(80)
  })
})
