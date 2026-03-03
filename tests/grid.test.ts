import { describe, it, expect } from 'vitest'
import {
  allocateGrid,
  encodeHeader,
  decodeHeader,
  structuralCellCount,
  dataCellCount,
  generateFinderPixels,
  generateAlignmentPixels,
  headerSize,
} from '../src/grid.js'
import { FINDER_SIZE, ALIGNMENT_SIZE } from '../src/types.js'

describe('grid allocation', () => {
  it('allocates a minimal grid', () => {
    const grid = allocateGrid(20, 20)
    expect(grid.width).toBe(20)
    expect(grid.height).toBe(20)
    // Check corners
    expect(grid.cells[0][0]).toBe('finder')
    expect(grid.cells[0][19]).toBe('finder')
    expect(grid.cells[19][0]).toBe('finder')
    expect(grid.cells[19][19]).toBe('alignment')
  })

  it('marks timing cells', () => {
    const grid = allocateGrid(20, 20)
    // Horizontal timing at row FINDER_SIZE, between finders
    expect(grid.cells[FINDER_SIZE][FINDER_SIZE]).toBe('timing')
    expect(grid.cells[FINDER_SIZE][10]).toBe('timing')
    // Vertical timing at column FINDER_SIZE, between finders
    expect(grid.cells[10][FINDER_SIZE]).toBe('timing')
  })

  it('generates serpentine data coordinates', () => {
    const grid = allocateGrid(20, 20)
    expect(grid.dataCoords.length).toBeGreaterThan(0)
    // All data coords should point to cells marked 'data'
    for (const [x, y] of grid.dataCoords) {
      expect(grid.cells[y][x]).toBe('data')
    }
  })

  it('total cells = structural + data', () => {
    const w = 30,
      h = 25
    const structural = structuralCellCount(w, h)
    const data = dataCellCount(w, h)
    expect(structural + data).toBe(w * h)
  })

  it('data coords count matches dataCellCount', () => {
    const w = 20,
      h = 20
    const grid = allocateGrid(w, h)
    expect(grid.dataCoords.length).toBe(dataCellCount(w, h))
  })
})

describe('header encoding', () => {
  it('round-trips basic header', () => {
    const meta = {
      version: 1,
      mode: 'rgba64' as const,
      ecLevel: 'L' as const,
      compressed: false,
      gridWidth: 100,
      gridHeight: 80,
      dataLength: 5000,
    }
    const encoded = encodeHeader(meta)
    expect(encoded.length).toBe(14)
    const decoded = decodeHeader(encoded)
    expect(decoded).toEqual(meta)
  })

  it('round-trips header with sequence', () => {
    const meta = {
      version: 1,
      mode: 'rgba32' as const,
      ecLevel: 'H' as const,
      compressed: false,
      gridWidth: 200,
      gridHeight: 150,
      dataLength: 100000,
      sequence: { id: 12345, index: 2, total: 5 },
    }
    const encoded = encodeHeader(meta)
    expect(encoded.length).toBe(18)
    const decoded = decodeHeader(encoded)
    expect(decoded).toEqual(meta)
  })

  it('detects corruption via CRC', () => {
    const meta = {
      version: 1,
      mode: 'rgb48' as const,
      ecLevel: 'M' as const,
      compressed: false,
      gridWidth: 50,
      gridHeight: 50,
      dataLength: 1000,
    }
    const encoded = encodeHeader(meta)
    encoded[3] ^= 0xff // corrupt a byte
    expect(() => decodeHeader(encoded)).toThrow('CRC mismatch')
  })

  it('headerSize returns correct values', () => {
    expect(headerSize(false)).toBe(14)
    expect(headerSize(true)).toBe(18)
  })

  it('handles max grid dimensions (12-bit = 4095)', () => {
    const meta = {
      version: 15,
      mode: 'rgb24' as const,
      ecLevel: 'Q' as const,
      compressed: true,
      gridWidth: 4095,
      gridHeight: 4095,
      dataLength: 0xffffffff,
    }
    const encoded = encodeHeader(meta)
    const decoded = decodeHeader(encoded)
    expect(decoded).toEqual(meta)
  })
})

describe('finder/alignment patterns', () => {
  it('generates 7x7 finder at 8-bit', () => {
    const pixels = generateFinderPixels(8)
    expect(pixels.length).toBe(FINDER_SIZE * FINDER_SIZE * 4)
    // Center pixel should be indigo: R=79, G=70, B=229, A=255
    const centerOffset = (3 * FINDER_SIZE + 3) * 4
    expect(pixels[centerOffset]).toBe(79)
    expect(pixels[centerOffset + 1]).toBe(70)
    expect(pixels[centerOffset + 2]).toBe(229)
    expect(pixels[centerOffset + 3]).toBe(255)
  })

  it('generates 7x7 finder at 16-bit', () => {
    const pixels = generateFinderPixels(16)
    expect(pixels.length).toBe(FINDER_SIZE * FINDER_SIZE * 8)
    // Center pixel should be indigo: 79*257=20303, 70*257=17990, 229*257=58853, A=65535
    const centerOffset = (3 * FINDER_SIZE + 3) * 8
    const view = new DataView(pixels.buffer, centerOffset, 8)
    expect(view.getUint16(0)).toBe(20303)
    expect(view.getUint16(2)).toBe(17990)
    expect(view.getUint16(4)).toBe(58853)
    expect(view.getUint16(6)).toBe(65535)
  })

  it('generates 5x5 alignment at 8-bit', () => {
    const pixels = generateAlignmentPixels(8)
    expect(pixels.length).toBe(ALIGNMENT_SIZE * ALIGNMENT_SIZE * 4)
  })
})
