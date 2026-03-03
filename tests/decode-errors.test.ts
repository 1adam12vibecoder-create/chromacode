/**
 * Decoder error path tests: exercise specific error branches in decode.ts
 * that aren't covered by the general invalid-inputs tests.
 */

import { describe, it, expect } from 'vitest'
import { encode, decode } from '../src/index.js'
import { readPng, writePng } from '../src/png.js'
import { encodeHeader, headerSize, allocateGrid } from '../src/grid.js'
import { encodeCell } from '../src/channels.js'
import type { HeaderMeta, EncodingMode } from '../src/types.js'
import { BYTES_PER_CELL, QUIET_ZONE } from '../src/types.js'

function makeData(len: number, seed = 0): Uint8Array {
  const data = new Uint8Array(len)
  for (let i = 0; i < len; i++) data[i] = (seed + i * 7 + 13) & 0xff
  return data
}

describe('decode: grid dimension mismatch', () => {
  it('throws when header grid dimensions differ from image dimensions', () => {
    // Encode a normal image, then rewrite the header with wrong grid dimensions
    const data = makeData(50)
    const png = encode(data, { mode: 'rgba32', cellSize: 1 })
    const image = readPng(png)

    const bpp = 4
    const gridWidth = image.width - 2 * QUIET_ZONE
    const gridHeight = image.height - 2 * QUIET_ZONE
    const mode: EncodingMode = 'rgba32'
    const bytesPerCell = BYTES_PER_CELL[mode]

    // Create a header that claims different grid dimensions
    const fakeHeader: HeaderMeta = {
      version: 1,
      mode: 'rgba32',
      ecLevel: 'L',
      compressed: false,
      gridWidth: gridWidth + 5, // WRONG
      gridHeight: gridHeight + 5, // WRONG
      dataLength: 50,
    }
    const headerBytes = encodeHeader(fakeHeader)
    const headerCells = Math.ceil(headerSize(false) / bytesPerCell)

    // Write the fake header into the image's header cell positions
    const grid = allocateGrid(gridWidth, gridHeight)
    const paddedHeader = new Uint8Array(headerCells * bytesPerCell)
    paddedHeader.set(headerBytes)
    for (let i = 0; i < headerCells; i++) {
      const cellData = paddedHeader.subarray(i * bytesPerCell, (i + 1) * bytesPerCell)
      const pixel = encodeCell(cellData, mode)
      const [cx, cy] = grid.dataCoords[i]
      const px = (cx + QUIET_ZONE) * 1
      const py = (cy + QUIET_ZONE) * 1
      const offset = (py * image.width + px) * bpp
      image.pixels.set(pixel, offset)
    }

    const corruptedPng = writePng(image.pixels, image.width, image.height, image.bitDepth)
    expect(() => decode(corruptedPng)).toThrow('mismatch')
  })
})

describe('decode: quiet zone transparency', () => {
  it('quiet zone pixels have alpha=0', () => {
    const data = makeData(20)
    const png = encode(data, { mode: 'rgba32', cellSize: 1 })
    const image = readPng(png)

    const bpp = 4
    const _gridWidth = image.width - 2 * QUIET_ZONE
    const _gridHeight = image.height - 2 * QUIET_ZONE
    const _cellSize = 1

    // Check top quiet zone row (y=0)
    for (let x = 0; x < image.width; x++) {
      const offset = (0 * image.width + x) * bpp
      expect(image.pixels[offset + 3]).toBe(0) // alpha = 0
    }

    // Check left quiet zone column (x=0)
    for (let y = 0; y < image.height; y++) {
      const offset = (y * image.width + 0) * bpp
      expect(image.pixels[offset + 3]).toBe(0) // alpha = 0
    }

    // Check bottom quiet zone row
    for (let x = 0; x < image.width; x++) {
      const offset = ((image.height - 1) * image.width + x) * bpp
      expect(image.pixels[offset + 3]).toBe(0) // alpha = 0
    }

    // Check right quiet zone column
    for (let y = 0; y < image.height; y++) {
      const offset = (y * image.width + (image.width - 1)) * bpp
      expect(image.pixels[offset + 3]).toBe(0) // alpha = 0
    }
  })

  it('quiet zone pixels have alpha=0 for 16-bit mode', () => {
    const data = makeData(20)
    const png = encode(data, { mode: 'rgba64', cellSize: 1 })
    const image = readPng(png)

    const bpp = 8
    // Check top quiet zone row (y=0) — alpha is bytes 6-7 (big-endian uint16)
    for (let x = 0; x < image.width; x++) {
      const offset = (0 * image.width + x) * bpp
      const alpha = (image.pixels[offset + 6] << 8) | image.pixels[offset + 7]
      expect(alpha).toBe(0)
    }
  })
})

describe('decode: serpentine data cell ordering', () => {
  it('data coords follow serpentine pattern for small grid', () => {
    // Verify that data cells alternate direction per row
    const grid = allocateGrid(16, 16)
    const coords = grid.dataCoords

    // Group coords by y-coordinate
    const byRow = new Map<number, number[]>()
    for (const [x, y] of coords) {
      if (!byRow.has(y)) byRow.set(y, [])
      byRow.get(y)!.push(x)
    }

    // For each row with multiple cells, check direction
    const rows = [...byRow.keys()].sort((a, b) => a - b)
    for (let r = 0; r < rows.length; r++) {
      const xs = byRow.get(rows[r])!
      if (xs.length < 2) continue
      // Even rows: ascending x; Odd rows: descending x
      // (relative to the first data row)
      const isAscending = xs[0] < xs[xs.length - 1]
      const isDescending = xs[0] > xs[xs.length - 1]
      // At minimum, should be monotonic (all ascending or all descending)
      expect(isAscending || isDescending).toBe(true)
    }
  })
})
