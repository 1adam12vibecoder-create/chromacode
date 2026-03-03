/**
 * ChromaCode decoder: PNG image → data.
 *
 * Pipeline:
 * 1. Read PNG → pixel buffer
 * 2. Detect quiet zone / cell size from finder patterns
 * 3. Extract grid dimensions
 * 4. Read header from first N data cells
 * 5. Extract data cells in serpentine order
 * 6. Decode channels → interleaved stream
 * 7. Deinterleave → RS blocks
 * 8. RS decode each block (correct errors)
 * 9. Concatenate data
 * 10. Optional inflate decompression
 */

import { inflateSync } from 'node:zlib'
import type { EncodingMode } from './types.js'
import { BYTES_PER_CELL, EC_RATIO, RS_MAX_BLOCK, QUIET_ZONE } from './types.js'
import { rsDecode, ecSymbolCount } from './reed-solomon.js'
import { deinterleave } from './interleave.js'
import { allocateGrid, decodeHeader, headerSize } from './grid.js'
import { decodeCell } from './channels.js'
import { readPng } from './png.js'

/**
 * Decode a ChromaCode PNG image back to binary data.
 */
export function decode(png: Uint8Array): Uint8Array {
  // Step 1: Read PNG
  const image = readPng(png)
  const { pixels, width: pixelWidth, height: pixelHeight, bitDepth } = image
  const bpp = bitDepth === 16 ? 8 : 4

  // Step 2: Detect cell size by finding the top-left finder pattern
  // The TL finder starts at (QUIET_ZONE * cellSize, QUIET_ZONE * cellSize)
  // in pixel coordinates. We detect it by scanning for the finder's outer color.
  const cellSize = detectCellSize(pixels, pixelWidth, pixelHeight, bitDepth)

  // Step 3: Extract grid dimensions from pixel dimensions
  const gridWidth = Math.floor(pixelWidth / cellSize) - 2 * QUIET_ZONE
  const gridHeight = Math.floor(pixelHeight / cellSize) - 2 * QUIET_ZONE

  if (gridWidth < 12 || gridHeight < 12) {
    throw new Error(`Grid too small: ${gridWidth}×${gridHeight}`)
  }

  // Helper: read a cell's pixel value (top-left pixel of the cell)
  const readCell = (cellX: number, cellY: number): Uint8Array => {
    const px = (cellX + QUIET_ZONE) * cellSize
    const py = (cellY + QUIET_ZONE) * cellSize
    const offset = (py * pixelWidth + px) * bpp
    return pixels.subarray(offset, offset + bpp)
  }

  // Step 4: Allocate grid to get data cell coordinates
  const grid = allocateGrid(gridWidth, gridHeight)

  // Read header: first N data cells
  // We need to read enough cells to get the header, which tells us the mode.
  // Start by trying the maximum header size (18 bytes / smallest cell = 18/3 = 6 cells)
  // We'll read in rgba64 mode first (8 bytes/cell), then re-read if needed.

  // Actually, we can determine the bit depth from the PNG itself.
  // The mode is encoded in the header. We need to bootstrap:
  // Read enough cells to get the first header byte (which contains version + mode).
  // Then we know the bytes per cell and can read the full header.

  // For any mode, the first header byte is at offset 0 in the first cell's data.
  // Read the first cell with the most conservative mode (smallest bytes per cell).
  // First cell's first byte always contains version(4b) | mode(4b).

  // Read the first data cell raw pixels
  const firstCellPixel = readCell(...grid.dataCoords[0])

  // Determine mode from first byte: try all modes to read byte 0
  // In all modes, the first data byte maps to the red channel high byte (16-bit) or red byte (8-bit)
  let modeNibble: number
  if (bitDepth === 16) {
    // First pixel R channel: high byte of uint16
    const view = new DataView(
      firstCellPixel.buffer,
      firstCellPixel.byteOffset,
      firstCellPixel.byteLength,
    )
    const r16 = view.getUint16(0)
    modeNibble = r16 >> 8 // First byte of data = high byte of R16
  } else {
    // 8-bit: first byte = R channel
    modeNibble = firstCellPixel[0]
  }

  // Extract mode from the first header byte
  const modeId = modeNibble & 0x0f
  const modeMap: Record<number, EncodingMode> = {
    0: 'rgba64',
    1: 'rgba32',
    2: 'rgb48',
    3: 'rgb24',
  }
  const mode = modeMap[modeId]
  if (!mode) throw new Error(`Unknown mode ID in header: ${modeId}`)

  const bytesPerCell = BYTES_PER_CELL[mode]
  const hasSeqByte1 = readHeaderByte1(grid, readCell, mode, bitDepth)
  const hasSequence = (hasSeqByte1 & 0x20) !== 0
  const hdrSize = headerSize(hasSequence)
  const headerCells = Math.ceil(hdrSize / bytesPerCell)

  // Read full header
  const headerBytes = new Uint8Array(headerCells * bytesPerCell)
  for (let i = 0; i < headerCells; i++) {
    const [cx, cy] = grid.dataCoords[i]
    const pixel = readCell(cx, cy)
    const cellData = decodeCell(pixel, mode)
    headerBytes.set(cellData, i * bytesPerCell)
  }

  const header = decodeHeader(headerBytes.subarray(0, hdrSize))

  // Verify grid dimensions match
  if (header.gridWidth !== gridWidth || header.gridHeight !== gridHeight) {
    throw new Error(
      `Grid dimension mismatch: header says ${header.gridWidth}×${header.gridHeight}, ` +
        `image gives ${gridWidth}×${gridHeight}`,
    )
  }

  // Step 5-6: Read data cells and decode
  const dataCoords = grid.dataCoords.slice(headerCells)
  const payloadLen = header.dataLength
  const ecRatio = EC_RATIO[header.ecLevel]

  // Reconstruct block structure from payload length
  let dataPerBlock: number
  let ecCount: number

  if (payloadLen === 0) {
    // Empty data case
    return new Uint8Array(0)
  }

  // Find the same data-per-block as encoder
  for (dataPerBlock = RS_MAX_BLOCK - 2; dataPerBlock >= 1; dataPerBlock--) {
    ecCount = ecSymbolCount(dataPerBlock, ecRatio)
    if (dataPerBlock + ecCount <= RS_MAX_BLOCK) break
  }
  const numBlocks = Math.ceil(payloadLen / dataPerBlock!)
  const blockSizes: number[] = []

  for (let i = 0; i < numBlocks; i++) {
    const start = i * dataPerBlock!
    const end = Math.min(start + dataPerBlock!, payloadLen)
    const blockDataLen = end - start
    const blockEcCount = ecSymbolCount(blockDataLen, ecRatio)
    blockSizes.push(blockDataLen + blockEcCount)
  }

  const totalStreamBytes = blockSizes.reduce((s, b) => s + b, 0)
  const totalStreamCells = Math.ceil(totalStreamBytes / bytesPerCell)

  // Read interleaved stream from data cells
  const rawStream = new Uint8Array(totalStreamCells * bytesPerCell)
  for (let i = 0; i < totalStreamCells && i < dataCoords.length; i++) {
    const [cx, cy] = dataCoords[i]
    const pixel = readCell(cx, cy)
    const cellData = decodeCell(pixel, mode)
    rawStream.set(cellData, i * bytesPerCell)
  }

  const interleavedStream = rawStream.subarray(0, totalStreamBytes)

  // Step 7: Deinterleave
  const rsBlocks = deinterleave(interleavedStream, blockSizes)

  // Step 8: RS decode each block
  const dataChunks: Uint8Array[] = []
  for (let i = 0; i < numBlocks; i++) {
    const blockDataLen = Math.min(dataPerBlock!, payloadLen - i * dataPerBlock!)
    const blockEcCount = rsBlocks[i].length - blockDataLen
    const decoded = rsDecode(rsBlocks[i], blockEcCount)
    dataChunks.push(decoded)
  }

  // Step 9: Concatenate
  const totalData = dataChunks.reduce((s, c) => s + c.length, 0)
  const result = new Uint8Array(totalData)
  let offset = 0
  for (const chunk of dataChunks) {
    result.set(chunk, offset)
    offset += chunk.length
  }

  // Truncate to exact data length
  const trimmed = result.subarray(0, payloadLen)

  // Step 10: Decompress if needed
  if (header.compressed) {
    return new Uint8Array(inflateSync(Buffer.from(trimmed)))
  }

  return trimmed
}

/**
 * Read header byte 1 (contains hasSequence flag) by reading the second byte
 * from the appropriate cell.
 */
function readHeaderByte1(
  grid: ReturnType<typeof allocateGrid>,
  readCell: (cx: number, cy: number) => Uint8Array,
  mode: EncodingMode,
  _bitDepth: 8 | 16,
): number {
  const bytesPerCell = BYTES_PER_CELL[mode]

  if (bytesPerCell >= 2) {
    // Byte 1 is in the first cell
    const [cx, cy] = grid.dataCoords[0]
    const pixel = readCell(cx, cy)
    const cellData = decodeCell(pixel, mode)
    return cellData[1]
  } else {
    // Byte 1 is in the second cell (only for hypothetical 1-byte/cell modes, which we don't have)
    const [cx, cy] = grid.dataCoords[1]
    const pixel = readCell(cx, cy)
    const cellData = decodeCell(pixel, mode)
    return cellData[0]
  }
}

/**
 * Detect cell size by examining the top-left finder pattern.
 * Scans from the quiet zone boundary to find the first finder-colored pixel,
 * then measures the cell size.
 */
function detectCellSize(
  pixels: Uint8Array,
  pixelWidth: number,
  _pixelHeight: number,
  bitDepth: 8 | 16,
): number {
  const bpp = bitDepth === 16 ? 8 : 4

  // The finder starts at pixel (QUIET_ZONE * cellSize, QUIET_ZONE * cellSize).
  // We know QUIET_ZONE = 1, so the finder starts at (cellSize, cellSize).
  // Before that is the quiet zone (transparent).
  // Scan row 0 to find where the quiet zone ends (first non-zero alpha)
  // then that's the cellSize boundary.

  // Actually, scan the first row. The quiet zone has alpha=0, then at x=cellSize
  // the finder starts with the outer color (full alpha).
  // So find the first pixel with non-zero alpha.

  // For cell size detection: scan along y=0 row.
  // Quiet zone pixels have alpha=0, finder pixels have full alpha.
  // The first pixel with full alpha is at x = QUIET_ZONE * cellSize.

  // Then to determine cellSize: the outer color of the finder continues for
  // cellSize pixels, then transitions to white (layer 1) at x = (QUIET_ZONE+1)*cellSize.

  // First, find start of finder (first non-transparent pixel in row y)
  // Try multiple rows for robustness
  for (let testY = 0; testY < Math.min(50, _pixelHeight); testY++) {
    let finderStart = -1

    for (let x = 0; x < pixelWidth; x++) {
      const offset = (testY * pixelWidth + x) * bpp
      const alpha =
        bitDepth === 16 ? (pixels[offset + 6] << 8) | pixels[offset + 7] : pixels[offset + 3]

      if (alpha > 0) {
        finderStart = x
        break
      }
    }

    if (finderStart < 0) continue

    // cellSize = finderStart / QUIET_ZONE
    const cellSize = Math.round(finderStart / QUIET_ZONE)
    if (cellSize < 1) continue

    // Verify: at (finderStart, testY) we should see the outer finder color
    // and at (finderStart + cellSize, testY + cellSize) we should see white (if in finder range)
    return cellSize
  }

  // Fallback: assume cellSize = 1
  return 1
}
