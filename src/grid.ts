/**
 * Grid layout: finder patterns, timing patterns, alignment, header,
 * and data cell ordering (serpentine fill).
 */

import type { CellMap, CellType, HeaderMeta } from './types.js'
import { FINDER_SIZE, ALIGNMENT_SIZE, MODE_ID, EC_ID, ID_TO_MODE, ID_TO_EC } from './types.js'
import { crc32 } from './crc32.js'

/**
 * Finder pattern colors (8-bit values).
 * Layer 0 (outer): brand indigo #4f46e5 → R=79, G=70, B=229
 * Layer 1: white #ffffff → R=255, G=255, B=255
 * Layer 2: brand violet #7c3aed → R=124, G=58, B=237
 * Layer 3 (center): brand indigo #4f46e5
 */
export const FINDER_COLORS_8 = [
  [79, 70, 229], // Layer 0 — outermost
  [255, 255, 255], // Layer 1
  [124, 58, 237], // Layer 2
  [79, 70, 229], // Layer 3 — center
] as const

/** 16-bit finder colors (8-bit × 257) */
export const FINDER_COLORS_16 = FINDER_COLORS_8.map((c) =>
  c.map((v) => v * 257),
) as unknown as readonly (readonly number[])[]

/**
 * Generate the 7×7 finder pattern pixel data for one finder.
 * Returns pixel data for the finder (in PNG pixel format).
 *
 * @param bitDepth - 8 or 16
 * @returns Pixel data for 7×7 cells (each cell = 1 pixel)
 */
export function generateFinderPixels(bitDepth: 8 | 16): Uint8Array {
  const bpp = bitDepth === 16 ? 8 : 4 // bytes per pixel
  const pixels = new Uint8Array(FINDER_SIZE * FINDER_SIZE * bpp)
  const colors = bitDepth === 16 ? FINDER_COLORS_16 : FINDER_COLORS_8
  const alphaMax = bitDepth === 16 ? 65535 : 255

  for (let y = 0; y < FINDER_SIZE; y++) {
    for (let x = 0; x < FINDER_SIZE; x++) {
      // Determine layer: distance from edge of 7×7 grid
      const distFromEdge = Math.min(x, y, FINDER_SIZE - 1 - x, FINDER_SIZE - 1 - y)
      const layer = Math.min(distFromEdge, 3)
      const color = colors[layer]
      const offset = (y * FINDER_SIZE + x) * bpp

      if (bitDepth === 16) {
        const view = new DataView(pixels.buffer, offset, 8)
        view.setUint16(0, color[0])
        view.setUint16(2, color[1])
        view.setUint16(4, color[2])
        view.setUint16(6, alphaMax)
      } else {
        pixels[offset] = color[0]
        pixels[offset + 1] = color[1]
        pixels[offset + 2] = color[2]
        pixels[offset + 3] = alphaMax
      }
    }
  }
  return pixels
}

/**
 * Generate the 5×5 alignment pattern (bottom-right corner).
 * Uses same color scheme as finder but smaller.
 */
export function generateAlignmentPixels(bitDepth: 8 | 16): Uint8Array {
  const bpp = bitDepth === 16 ? 8 : 4
  const pixels = new Uint8Array(ALIGNMENT_SIZE * ALIGNMENT_SIZE * bpp)
  const colors = bitDepth === 16 ? FINDER_COLORS_16 : FINDER_COLORS_8
  const alphaMax = bitDepth === 16 ? 65535 : 255

  for (let y = 0; y < ALIGNMENT_SIZE; y++) {
    for (let x = 0; x < ALIGNMENT_SIZE; x++) {
      const distFromEdge = Math.min(x, y, ALIGNMENT_SIZE - 1 - x, ALIGNMENT_SIZE - 1 - y)
      const layer = Math.min(distFromEdge, 3) // 0=outer, 1=middle, 2=center
      const color = colors[layer]
      const offset = (y * ALIGNMENT_SIZE + x) * bpp

      if (bitDepth === 16) {
        const view = new DataView(pixels.buffer, offset, 8)
        view.setUint16(0, color[0])
        view.setUint16(2, color[1])
        view.setUint16(4, color[2])
        view.setUint16(6, alphaMax)
      } else {
        pixels[offset] = color[0]
        pixels[offset + 1] = color[1]
        pixels[offset + 2] = color[2]
        pixels[offset + 3] = alphaMax
      }
    }
  }
  return pixels
}

/**
 * Allocate a grid and classify each cell.
 * Returns a CellMap with cell types and ordered data/header coordinates.
 *
 * Grid layout (quiet zone excluded from cell coordinates):
 * - (0,0) to (FINDER_SIZE-1, FINDER_SIZE-1): top-left finder
 * - (w-FINDER_SIZE, 0) to (w-1, FINDER_SIZE-1): top-right finder
 * - (0, h-FINDER_SIZE) to (FINDER_SIZE-1, h-1): bottom-left finder
 * - (w-ALIGN_SIZE, h-ALIGN_SIZE) to (w-1, h-1): bottom-right alignment
 * - Timing: row FINDER_SIZE and column FINDER_SIZE (between finders)
 *
 * Quiet zone is 1 cell around the outside (not included in the cell grid).
 * The grid dimensions passed here are the INNER grid (excluding quiet zone).
 */
export function allocateGrid(width: number, height: number): CellMap {
  // Initialize all cells as 'data'
  const cells: CellType[][] = Array.from(
    { length: height },
    () => new Array(width).fill('data') as CellType[],
  )

  // Top-left finder
  for (let y = 0; y < FINDER_SIZE; y++) {
    for (let x = 0; x < FINDER_SIZE; x++) {
      cells[y][x] = 'finder'
    }
  }

  // Top-right finder
  for (let y = 0; y < FINDER_SIZE; y++) {
    for (let x = width - FINDER_SIZE; x < width; x++) {
      cells[y][x] = 'finder'
    }
  }

  // Bottom-left finder
  for (let y = height - FINDER_SIZE; y < height; y++) {
    for (let x = 0; x < FINDER_SIZE; x++) {
      cells[y][x] = 'finder'
    }
  }

  // Bottom-right alignment
  for (let y = height - ALIGNMENT_SIZE; y < height; y++) {
    for (let x = width - ALIGNMENT_SIZE; x < width; x++) {
      cells[y][x] = 'alignment'
    }
  }

  // Timing patterns: row y=FINDER_SIZE and column x=FINDER_SIZE
  // Horizontal timing: row FINDER_SIZE, from x=FINDER_SIZE to x=width-FINDER_SIZE-1
  for (let x = FINDER_SIZE; x < width - FINDER_SIZE; x++) {
    cells[FINDER_SIZE][x] = 'timing'
  }
  // Vertical timing: column FINDER_SIZE, from y=FINDER_SIZE to y=height-FINDER_SIZE-1
  for (let y = FINDER_SIZE; y < height - FINDER_SIZE; y++) {
    cells[y][FINDER_SIZE] = 'timing'
  }

  // Collect data cells in serpentine order (left→right, then right→left, alternating rows)
  // Skip structural cells. First N data cells are header, rest are data.
  const allDataCoords: [number, number][] = []

  for (let y = 0; y < height; y++) {
    if (y % 2 === 0) {
      // Left to right
      for (let x = 0; x < width; x++) {
        if (cells[y][x] === 'data') {
          allDataCoords.push([x, y])
        }
      }
    } else {
      // Right to left
      for (let x = width - 1; x >= 0; x--) {
        if (cells[y][x] === 'data') {
          allDataCoords.push([x, y])
        }
      }
    }
  }

  // Header occupies the first HEADER_BYTES / bytesPerCell cells.
  // We mark them separately after knowing the mode.
  // For now, return all as "data" — the encoder will split header from data.
  // We do mark the first few as 'header' based on a fixed header size.
  // Header: 14 bytes max (no sequence) or 19 bytes (with sequence).
  // Since header size depends on sequence, we'll handle it at encode time.

  return {
    width,
    height,
    cells,
    dataCoords: allDataCoords,
    headerCoords: [], // Filled by encoder based on header size
  }
}

/** Number of header bytes (without sequence info) */
export const HEADER_SIZE_BASE = 12 // version(4b) + mode(4b) + ec(2b) + reserved(6b) + gridW(12b) + gridH(12b) + dataLen(32b) + crc16(16b) = 88 bits = 11 bytes → round to 12

/** Number of additional bytes for sequence info */
export const HEADER_SIZE_SEQUENCE = 4 // seq_id(16b) + seq_idx(8b) + seq_total(8b) = 32 bits

/**
 * Encode header metadata into bytes.
 *
 * Layout (bit-packed):
 * - version: 4 bits
 * - mode: 4 bits
 * - ecLevel: 2 bits
 * - hasSequence: 1 bit
 * - compressed: 1 bit
 * - reserved: 4 bits
 * - gridWidth: 12 bits
 * - gridHeight: 12 bits
 * - dataLength: 32 bits
 * - [sequence_id: 16 bits, sequence_index: 8 bits, sequence_total: 8 bits] (if hasSequence)
 * - CRC16: 16 bits (over preceding bytes)
 *
 * Total: 12 bytes base + 4 bytes sequence (optional) + 2 bytes CRC = 14 or 18 bytes
 */
export function encodeHeader(meta: HeaderMeta): Uint8Array {
  const hasSeq = meta.sequence !== undefined
  const size = hasSeq ? 18 : 14

  const buf = new Uint8Array(size)
  const view = new DataView(buf.buffer)

  // Byte 0: version (4 bits) | mode (4 bits)
  buf[0] = ((meta.version & 0x0f) << 4) | (MODE_ID[meta.mode] & 0x0f)

  // Byte 1: ecLevel (2 bits) | hasSequence (1 bit) | compressed (1 bit) | reserved (4 bits)
  buf[1] = ((EC_ID[meta.ecLevel] & 0x03) << 6) | (hasSeq ? 0x20 : 0) | (meta.compressed ? 0x10 : 0)

  // Bytes 2-3: gridWidth (12 bits) | gridHeight high nibble (4 bits)
  // Bytes 4: gridHeight low byte (8 bits)
  const gw = meta.gridWidth & 0xfff
  const gh = meta.gridHeight & 0xfff
  buf[2] = (gw >> 4) & 0xff
  buf[3] = ((gw & 0x0f) << 4) | ((gh >> 8) & 0x0f)
  buf[4] = gh & 0xff

  // Bytes 5-8: dataLength (32 bits big-endian)
  view.setUint32(5, meta.dataLength)

  // Bytes 9-(size-3): sequence if present
  let offset = 9
  if (hasSeq) {
    const seq = meta.sequence!
    view.setUint16(offset, seq.id)
    offset += 2
    buf[offset++] = seq.index
    buf[offset] = seq.total
  }

  // Last 2 bytes: CRC16 (lower 16 bits of CRC32 over preceding bytes)
  const crcData = buf.subarray(0, size - 2)
  const crc = crc32(crcData) & 0xffff
  view.setUint16(size - 2, crc)

  return buf
}

/**
 * Decode header bytes back to metadata.
 */
export function decodeHeader(buf: Uint8Array): HeaderMeta {
  if (buf.length < 14) {
    throw new Error(`Header too short: ${buf.length} bytes (need at least 14)`)
  }

  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)

  const version = (buf[0] >> 4) & 0x0f
  const modeId = buf[0] & 0x0f
  const ecId = (buf[1] >> 6) & 0x03
  const hasSeq = (buf[1] & 0x20) !== 0
  const compressed = (buf[1] & 0x10) !== 0

  const expectedSize = hasSeq ? 18 : 14
  if (buf.length < expectedSize) {
    throw new Error(`Header too short for sequence data: ${buf.length} < ${expectedSize}`)
  }

  // Verify CRC
  const crcData = buf.subarray(0, expectedSize - 2)
  const expectedCrc = crc32(crcData) & 0xffff
  const actualCrc = view.getUint16(expectedSize - 2)
  if (expectedCrc !== actualCrc) {
    throw new Error(`Header CRC mismatch: expected ${expectedCrc}, got ${actualCrc}`)
  }

  const gridWidth = ((buf[2] << 4) | (buf[3] >> 4)) & 0xfff
  const gridHeight = (((buf[3] & 0x0f) << 8) | buf[4]) & 0xfff
  const dataLength = view.getUint32(5)

  const mode = ID_TO_MODE[modeId]
  const ecLevel = ID_TO_EC[ecId]
  if (!mode) throw new Error(`Unknown mode ID: ${modeId}`)
  if (!ecLevel) throw new Error(`Unknown EC level ID: ${ecId}`)

  const result: HeaderMeta = {
    version,
    mode,
    ecLevel,
    compressed,
    gridWidth,
    gridHeight,
    dataLength,
  }

  if (hasSeq) {
    result.sequence = {
      id: view.getUint16(9),
      index: buf[11],
      total: buf[12],
    }
  }

  return result
}

/**
 * Get header size in bytes for given options.
 */
export function headerSize(hasSequence: boolean): number {
  return hasSequence ? 18 : 14
}

/**
 * Count structural cells (finder + alignment + timing) for a given grid size.
 */
export function structuralCellCount(width: number, height: number): number {
  // 3 finders: 3 × 7×7 = 147
  const finders = 3 * FINDER_SIZE * FINDER_SIZE
  // 1 alignment: 5×5 = 25
  const alignment = ALIGNMENT_SIZE * ALIGNMENT_SIZE
  // Timing patterns along row FINDER_SIZE and column FINDER_SIZE,
  // subtract 1 for the intersection cell at (FINDER_SIZE, FINDER_SIZE)
  const hTiming = Math.max(0, width - 2 * FINDER_SIZE)
  const vTiming = Math.max(0, height - 2 * FINDER_SIZE)
  const timingTotal = Math.max(0, hTiming + vTiming - 1)

  return finders + alignment + timingTotal
}

/**
 * Count data cells (total cells - structural cells) for a given grid size.
 */
export function dataCellCount(width: number, height: number): number {
  return width * height - structuralCellCount(width, height)
}

/**
 * Generate timing pattern pixel data for a single cell.
 * Alternating between two colors based on cell index.
 */
export function timingCellPixel(index: number, bitDepth: 8 | 16): Uint8Array {
  const bpp = bitDepth === 16 ? 8 : 4
  const pixel = new Uint8Array(bpp)

  // Alternating dark/light pattern
  const isDark = index % 2 === 0
  const colors = bitDepth === 16 ? FINDER_COLORS_16 : FINDER_COLORS_8
  const color = isDark ? colors[0] : colors[1]
  const alphaMax = bitDepth === 16 ? 65535 : 255

  if (bitDepth === 16) {
    const view = new DataView(pixel.buffer)
    view.setUint16(0, color[0])
    view.setUint16(2, color[1])
    view.setUint16(4, color[2])
    view.setUint16(6, alphaMax)
  } else {
    pixel[0] = color[0]
    pixel[1] = color[1]
    pixel[2] = color[2]
    pixel[3] = alphaMax
  }

  return pixel
}
