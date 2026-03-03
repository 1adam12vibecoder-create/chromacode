/**
 * Error correction tests: inject corruption into encoded images
 * and verify the decoder recovers the original data.
 */

import { describe, it, expect } from 'vitest'
import { encode, decode } from '../src/index.js'
import { readPng, writePng } from '../src/png.js'
import type { EncodingMode, ECLevel } from '../src/types.js'
import { QUIET_ZONE, FINDER_SIZE } from '../src/types.js'

/** Helper: create deterministic test data */
function makeData(len: number, seed = 0): Uint8Array {
  const data = new Uint8Array(len)
  for (let i = 0; i < len; i++) data[i] = (seed + i * 7 + 13) & 0xff
  return data
}

/** Helper: corrupt N data cells in a pixel buffer by flipping all channel bytes */
function corruptCells(
  pixels: Uint8Array,
  pixelWidth: number,
  bitDepth: 8 | 16,
  mode: EncodingMode,
  gridWidth: number,
  cellSize: number,
  cellCount: number,
  startCell: number,
): void {
  const bpp = bitDepth === 16 ? 8 : 4

  // Corrupt data cells starting after header and structural cells.
  // We target cells in the middle of the data region to avoid header corruption.
  // Data cells start after row 0 (which has finders), so target cells in mid-grid rows.
  const _midY = Math.floor(gridWidth / 2)
  for (let c = 0; c < cellCount; c++) {
    // Target pixels in the middle rows of the image
    const cellX = FINDER_SIZE + 1 + ((startCell + c) % (gridWidth - 2 * FINDER_SIZE - 1))
    const cellY = FINDER_SIZE + 1 + Math.floor((startCell + c) / (gridWidth - 2 * FINDER_SIZE - 1))
    const px = (cellX + QUIET_ZONE) * cellSize
    const py = (cellY + QUIET_ZONE) * cellSize
    const offset = (py * pixelWidth + px) * bpp
    // Flip all data channel bytes
    for (let b = 0; b < bpp; b++) {
      pixels[offset + b] ^= 0xff
    }
  }
}

describe('error correction on encoded images', () => {
  const _modes: EncodingMode[] = ['rgba64', 'rgba32', 'rgb48', 'rgb24']
  const ecLevels: ECLevel[] = ['L', 'M', 'Q', 'H']

  it('recovers from 1 corrupted cell with EC level L', () => {
    const data = makeData(100)
    const png = encode(data, { mode: 'rgba32', ecLevel: 'L' })
    const image = readPng(png)

    // Corrupt 1 data cell in the pixel buffer
    corruptCells(image.pixels, image.width, image.bitDepth, 'rgba32', 20, 1, 1, 5)

    const corruptedPng = writePng(image.pixels, image.width, image.height, image.bitDepth)
    const recovered = decode(corruptedPng)
    expect(recovered).toEqual(data)
  })

  it('recovers from multiple corrupted cells with EC level H', () => {
    const data = makeData(50)
    const png = encode(data, { mode: 'rgba32', ecLevel: 'H' })
    const image = readPng(png)

    // EC level H provides ~30% redundancy — corrupt a few cells
    corruptCells(image.pixels, image.width, image.bitDepth, 'rgba32', 18, 1, 3, 10)

    const corruptedPng = writePng(image.pixels, image.width, image.height, image.bitDepth)
    const recovered = decode(corruptedPng)
    expect(recovered).toEqual(data)
  })

  for (const ecLevel of ecLevels) {
    it(`uncorrupted round-trip succeeds for EC level ${ecLevel}`, () => {
      const data = makeData(200)
      const png = encode(data, { ecLevel })
      const result = decode(png)
      expect(result).toEqual(data)
    })
  }
})

describe('error detection: uncorrectable corruption throws', () => {
  it('throws when too many cells are corrupted', () => {
    const data = makeData(200)
    const png = encode(data, { mode: 'rgba32', ecLevel: 'L', cellSize: 1 })
    const image = readPng(png)

    // Wipe the entire pixel buffer to zeros — destroys header CRC, all finders,
    // and all data cells. This corruption is far beyond any EC level's capacity.
    image.pixels.fill(0)

    const corruptedPng = writePng(image.pixels, image.width, image.height, image.bitDepth)
    expect(() => decode(corruptedPng)).toThrow()
  })
})
