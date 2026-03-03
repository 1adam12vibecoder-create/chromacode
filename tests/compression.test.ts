/**
 * Compression edge case tests: verify the compress option across all modes,
 * the fallback when deflate makes data larger, and large compressible payloads.
 */

import { describe, it, expect } from 'vitest'
import { encode, decode } from '../src/index.js'
import { readPng } from '../src/png.js'
import { decodeCell } from '../src/channels.js'
import { allocateGrid, decodeHeader, headerSize } from '../src/grid.js'
import type { EncodingMode, ECLevel } from '../src/types.js'
import { BYTES_PER_CELL } from '../src/types.js'

function makeData(len: number, seed = 0): Uint8Array {
  const data = new Uint8Array(len)
  for (let i = 0; i < len; i++) data[i] = (seed + i * 7 + 13) & 0xff
  return data
}

describe('compression fallback: incompressible data', () => {
  it('random data with compress=true still round-trips', () => {
    // Random (pseudo) data — deflate will produce equal or larger output,
    // so the encoder should fall back to uncompressed
    const data = makeData(200)
    const png = encode(data, { compress: true })
    expect(decode(png)).toEqual(data)
  })

  it('compressed flag is false when deflate makes data larger', () => {
    // Pseudo-random data: deflate won't help
    const data = makeData(100)
    const png = encode(data, { compress: true })

    // Read header from the PNG to check the compressed flag
    const image = readPng(png)
    const bpp = image.bitDepth === 16 ? 8 : 4
    const mode: EncodingMode = 'rgba64' // default mode
    const bytesPerCell = BYTES_PER_CELL[mode]
    const gridWidth = image.width - 2
    const gridHeight = image.height - 2
    const grid = allocateGrid(gridWidth, gridHeight)

    const hdrSize = headerSize(false)
    const headerCells = Math.ceil(hdrSize / bytesPerCell)
    const headerBytes = new Uint8Array(headerCells * bytesPerCell)
    for (let i = 0; i < headerCells; i++) {
      const [cx, cy] = grid.dataCoords[i]
      const px = (cx + 1) * 1 // cellSize=1, quietZone=1
      const py = (cy + 1) * 1
      const offset = (py * image.width + px) * bpp
      const pixel = image.pixels.subarray(offset, offset + bpp)
      headerBytes.set(decodeCell(pixel, mode), i * bytesPerCell)
    }
    const header = decodeHeader(headerBytes.subarray(0, hdrSize))
    // Data is pseudo-random, deflate shouldn't help — compressed flag false
    expect(header.compressed).toBe(false)
  })
})

describe('compression with all modes', () => {
  const modes: EncodingMode[] = ['rgba64', 'rgba32', 'rgb48', 'rgb24']

  for (const mode of modes) {
    it(`compress=true round-trips with ${mode}`, () => {
      // Compressible data (repeating pattern)
      const data = new Uint8Array(300)
      for (let i = 0; i < 300; i++) data[i] = i % 4
      const png = encode(data, { mode, compress: true })
      expect(decode(png)).toEqual(data)
    })
  }
})

describe('compression with all EC levels', () => {
  const ecLevels: ECLevel[] = ['L', 'M', 'Q', 'H']

  for (const ecLevel of ecLevels) {
    it(`compress=true round-trips with EC_${ecLevel}`, () => {
      const data = new Uint8Array(200).fill(0xcd)
      const png = encode(data, { ecLevel, compress: true })
      expect(decode(png)).toEqual(data)
    })
  }
})

describe('large compressible payloads', () => {
  it('20 KB of zeros with compression', () => {
    const data = new Uint8Array(20_000)
    const png = encode(data, { compress: true })
    expect(decode(png)).toEqual(data)
  })

  it('compressed PNG is smaller than uncompressed', () => {
    // Highly repetitive data should compress significantly
    const data = new Uint8Array(5000).fill(0x42)
    const pngCompressed = encode(data, { compress: true })
    const pngUncompressed = encode(data, { compress: false })
    expect(pngCompressed.length).toBeLessThan(pngUncompressed.length)
  })
})

describe('compression with empty data', () => {
  it('compress=true with empty data round-trips', () => {
    const data = new Uint8Array(0)
    const png = encode(data, { compress: true })
    expect(decode(png)).toEqual(data)
  })
})
