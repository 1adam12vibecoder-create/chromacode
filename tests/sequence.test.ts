/**
 * Sequence / multi-image tests: verify that the sequence header fields
 * survive the full encode → decode pipeline, and that autoSize accounts
 * for the extra 4-byte header expansion.
 */

import { describe, it, expect } from 'vitest'
import { encode, decode } from '../src/index.js'
import { autoSize, usableCapacity } from '../src/auto-size.js'
import { decodeHeader, headerSize } from '../src/grid.js'
import { readPng } from '../src/png.js'
import { decodeCell } from '../src/channels.js'
import { allocateGrid } from '../src/grid.js'
import type { EncodingMode, ECLevel } from '../src/types.js'
import { BYTES_PER_CELL } from '../src/types.js'

function makeData(len: number, seed = 0): Uint8Array {
  const data = new Uint8Array(len)
  for (let i = 0; i < len; i++) data[i] = (seed + i * 7 + 13) & 0xff
  return data
}

describe('sequence encode → decode round-trip', () => {
  it('data survives encode with sequence option', () => {
    const data = makeData(100)
    const png = encode(data, { sequence: { id: 42, index: 0, total: 3 } })
    const recovered = decode(png)
    expect(recovered).toEqual(data)
  })

  it('sequence with all modes', () => {
    const modes: EncodingMode[] = ['rgba64', 'rgba32', 'rgb48', 'rgb24']
    for (const mode of modes) {
      const data = makeData(50)
      const png = encode(data, {
        mode,
        sequence: { id: 1000, index: 1, total: 5 },
      })
      expect(decode(png)).toEqual(data)
    }
  })

  it('sequence with all EC levels', () => {
    const ecLevels: ECLevel[] = ['L', 'M', 'Q', 'H']
    for (const ecLevel of ecLevels) {
      const data = makeData(50)
      const png = encode(data, {
        ecLevel,
        sequence: { id: 9999, index: 0, total: 2 },
      })
      expect(decode(png)).toEqual(data)
    }
  })

  it('sequence boundary values (max id, index, total)', () => {
    const data = makeData(30)
    const png = encode(data, {
      sequence: { id: 0xffff, index: 255, total: 255 },
    })
    expect(decode(png)).toEqual(data)
  })

  it('sequence with compression', () => {
    // Compressible data
    const data = new Uint8Array(500).fill(0xab)
    const png = encode(data, {
      compress: true,
      sequence: { id: 7, index: 0, total: 1 },
    })
    expect(decode(png)).toEqual(data)
  })

  it('sequence metadata is preserved in header through PNG', () => {
    const data = makeData(50)
    const seq = { id: 0x1234, index: 5, total: 10 }
    const png = encode(data, { mode: 'rgba32', sequence: seq })

    // Read the PNG and extract the header manually
    const image = readPng(png)
    const bpp = image.bitDepth === 16 ? 8 : 4
    const mode: EncodingMode = 'rgba32'
    const bytesPerCell = BYTES_PER_CELL[mode]
    const cellSize = 1 // default

    const gridWidth = Math.floor(image.width / cellSize) - 2
    const gridHeight = Math.floor(image.height / cellSize) - 2
    const grid = allocateGrid(gridWidth, gridHeight)

    // Read header cells
    const hdrSize = headerSize(true) // 18 bytes with sequence
    const headerCells = Math.ceil(hdrSize / bytesPerCell)
    const headerBytes = new Uint8Array(headerCells * bytesPerCell)
    for (let i = 0; i < headerCells; i++) {
      const [cx, cy] = grid.dataCoords[i]
      const px = (cx + 1) * cellSize
      const py = (cy + 1) * cellSize
      const offset = (py * image.width + px) * bpp
      const pixel = image.pixels.subarray(offset, offset + bpp)
      const cellData = decodeCell(pixel, mode)
      headerBytes.set(cellData, i * bytesPerCell)
    }

    const header = decodeHeader(headerBytes.subarray(0, hdrSize))
    expect(header.sequence).toBeDefined()
    expect(header.sequence!.id).toBe(0x1234)
    expect(header.sequence!.index).toBe(5)
    expect(header.sequence!.total).toBe(10)
  })
})

describe('autoSize with sequence', () => {
  it('headerSize is 18 with sequence', () => {
    expect(headerSize(true)).toBe(18)
    expect(headerSize(false)).toBe(14)
  })

  it('autoSize with hasSequence=true returns valid grid', () => {
    const auto = autoSize(100, 'rgba64', 'L', true)
    expect(auto.width).toBeGreaterThanOrEqual(16)
    expect(auto.height).toBeGreaterThanOrEqual(16)
  })

  it('autoSize with sequence may need slightly larger grid', () => {
    // For very tight payloads, the 4-byte header expansion matters
    // Find a payload size where sequence forces a larger grid
    const modes: EncodingMode[] = ['rgba32', 'rgb24']
    for (const mode of modes) {
      const noSeqAuto = autoSize(200, mode, 'H', false)
      const seqAuto = autoSize(200, mode, 'H', true)
      // Sequence grid should be >= no-sequence grid
      expect(seqAuto.width * seqAuto.height).toBeGreaterThanOrEqual(
        noSeqAuto.width * noSeqAuto.height,
      )
    }
  })

  it('usableCapacity accounts for sequence header', () => {
    const modes: EncodingMode[] = ['rgba64', 'rgba32', 'rgb48', 'rgb24']
    for (const mode of modes) {
      const capNoSeq = usableCapacity(30, 30, mode, 'L', false)
      const capSeq = usableCapacity(30, 30, mode, 'L', true)
      // With sequence, capacity should be <= non-sequence capacity
      // (the 4 extra bytes may get absorbed by RS block rounding in some modes)
      expect(capSeq).toBeLessThanOrEqual(capNoSeq)
    }
    // For rgb24 (3 bytes/cell), the difference should be measurable:
    // ceil(14/3) = 5 cells vs ceil(18/3) = 6 cells → 1 cell = 3 bytes less
    const cap24NoSeq = usableCapacity(30, 30, 'rgb24', 'L', false)
    const cap24Seq = usableCapacity(30, 30, 'rgb24', 'L', true)
    expect(cap24Seq).toBeLessThan(cap24NoSeq)
  })
})
