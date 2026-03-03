/**
 * ChromaCode encoder: data → PNG image.
 *
 * Pipeline:
 * 1. Optional deflate compression
 * 2. Split data into RS blocks
 * 3. RS encode each block (add EC symbols)
 * 4. Interleave blocks
 * 5. Auto-size grid (if dimensions not specified)
 * 6. Allocate grid
 * 7. Encode header into header cells
 * 8. Encode data into data cells via channel encoding
 * 9. Render finders, timing, alignment, data cells into pixel buffer
 * 10. Write PNG
 */

import { deflateSync } from 'node:zlib'
import type { EncodeOptions, HeaderMeta } from './types.js'
import {
  DEFAULT_OPTIONS,
  BYTES_PER_CELL,
  EC_RATIO,
  RS_MAX_BLOCK,
  BIT_DEPTH,
  PROTOCOL_VERSION,
  QUIET_ZONE,
  FINDER_SIZE,
  ALIGNMENT_SIZE,
  MAX_CELL_SIZE,
} from './types.js'
import { rsEncode, ecSymbolCount } from './reed-solomon.js'
import { interleave } from './interleave.js'
import { autoSize } from './auto-size.js'
import {
  allocateGrid,
  encodeHeader,
  headerSize,
  generateFinderPixels,
  generateAlignmentPixels,
  timingCellPixel,
} from './grid.js'
import { encodeCell } from './channels.js'
import { writePng } from './png.js'

/**
 * Encode binary data into a ChromaCode PNG image.
 */
export function encode(data: Uint8Array, options?: Partial<EncodeOptions>): Uint8Array {
  const opts: EncodeOptions = { ...DEFAULT_OPTIONS, ...options }
  if (opts.cellSize < 1 || opts.cellSize > MAX_CELL_SIZE) {
    throw new Error(`cellSize must be between 1 and ${MAX_CELL_SIZE}, got ${opts.cellSize}`)
  }
  const { mode, cellSize, ecLevel, compress, sequence } = opts

  // Step 1: Optional compression
  let payload = data
  let isCompressed = false
  if (compress && data.length > 0) {
    const compressed = new Uint8Array(deflateSync(Buffer.from(data)))
    if (compressed.length < data.length) {
      payload = compressed
      isCompressed = true
    }
  }

  const payloadLen = payload.length
  const bytesPerCell = BYTES_PER_CELL[mode]
  const bitDepth = BIT_DEPTH[mode]
  const ecRatio = EC_RATIO[ecLevel]
  const hasSequence = sequence !== undefined

  // Step 2-3: Split into RS blocks and encode
  const totalDataBytes = payloadLen
  let blocks: Uint8Array[]

  if (totalDataBytes === 0) {
    // Empty data: no RS blocks needed
    blocks = []
  } else {
    // Determine block structure
    // Each RS block: data + ec symbols ≤ 255
    // ecCount = ecSymbolCount(dataPerBlock, ecRatio)
    // We need: dataPerBlock + ecCount ≤ 255

    // Find optimal data per block
    let dataPerBlock: number
    let ecCount: number

    // Start with max possible data per block
    for (dataPerBlock = RS_MAX_BLOCK - 2; dataPerBlock >= 1; dataPerBlock--) {
      ecCount = ecSymbolCount(dataPerBlock, ecRatio)
      if (dataPerBlock + ecCount <= RS_MAX_BLOCK) break
    }
    const numBlocks = Math.ceil(totalDataBytes / dataPerBlock!)
    blocks = []

    for (let i = 0; i < numBlocks; i++) {
      const start = i * dataPerBlock!
      const end = Math.min(start + dataPerBlock!, totalDataBytes)
      const blockData = payload.slice(start, end)
      const blockEcCount = ecSymbolCount(blockData.length, ecRatio)
      const encoded = rsEncode(blockData, blockEcCount)
      blocks.push(encoded)
    }
  }

  // Step 4: Interleave
  const interleavedStream = interleave(blocks)

  // Step 5: Calculate grid dimensions
  const hdrSize = headerSize(hasSequence)
  const headerCells = Math.ceil(hdrSize / bytesPerCell)
  const dataCells = Math.ceil(interleavedStream.length / bytesPerCell)
  const neededDataCells = headerCells + dataCells

  let gridWidth: number
  let gridHeight: number

  if (opts.width && opts.height) {
    gridWidth = opts.width
    gridHeight = opts.height
  } else {
    const auto = autoSize(payloadLen, mode, ecLevel, hasSequence)
    gridWidth = auto.width
    gridHeight = auto.height
  }

  // Step 6: Allocate grid
  const grid = allocateGrid(gridWidth, gridHeight)

  if (grid.dataCoords.length < neededDataCells) {
    throw new Error(
      `Grid too small: need ${neededDataCells} data cells but only ${grid.dataCoords.length} available. ` +
        `Try larger dimensions or smaller data.`,
    )
  }

  // Split data coords into header and data portions
  const headerCoords = grid.dataCoords.slice(0, headerCells)
  const dataCoords = grid.dataCoords.slice(headerCells)

  // Step 7: Encode header
  const header: HeaderMeta = {
    version: PROTOCOL_VERSION,
    mode,
    ecLevel,
    compressed: isCompressed,
    gridWidth,
    gridHeight,
    dataLength: payloadLen,
    sequence,
  }
  const headerBytes = encodeHeader(header)

  // Step 8-9: Render into pixel buffer
  // Total pixel dimensions including quiet zone
  const pixelWidth = (gridWidth + 2 * QUIET_ZONE) * cellSize
  const pixelHeight = (gridHeight + 2 * QUIET_ZONE) * cellSize
  const bpp = bitDepth === 16 ? 8 : 4 // bytes per pixel in PNG
  const pixels = new Uint8Array(pixelWidth * pixelHeight * bpp)

  // Quiet zone: alpha=0 (transparent) — already zeroed for RGBA
  // For rgb modes, we'll leave quiet zone transparent too

  // Helper: set a cell's pixels (cellSize × cellSize block)
  const setCell = (cellX: number, cellY: number, pixelData: Uint8Array) => {
    // Account for quiet zone offset
    const baseX = (cellX + QUIET_ZONE) * cellSize
    const baseY = (cellY + QUIET_ZONE) * cellSize
    for (let dy = 0; dy < cellSize; dy++) {
      for (let dx = 0; dx < cellSize; dx++) {
        const px = baseX + dx
        const py = baseY + dy
        const offset = (py * pixelWidth + px) * bpp
        pixels.set(pixelData, offset)
      }
    }
  }

  // Render finder patterns
  const finderPixels = generateFinderPixels(bitDepth)
  const finderBpp = bpp

  // Top-left finder
  for (let fy = 0; fy < FINDER_SIZE; fy++) {
    for (let fx = 0; fx < FINDER_SIZE; fx++) {
      const srcOffset = (fy * FINDER_SIZE + fx) * finderBpp
      setCell(fx, fy, finderPixels.subarray(srcOffset, srcOffset + finderBpp))
    }
  }
  // Top-right finder
  for (let fy = 0; fy < FINDER_SIZE; fy++) {
    for (let fx = 0; fx < FINDER_SIZE; fx++) {
      const srcOffset = (fy * FINDER_SIZE + fx) * finderBpp
      setCell(
        gridWidth - FINDER_SIZE + fx,
        fy,
        finderPixels.subarray(srcOffset, srcOffset + finderBpp),
      )
    }
  }
  // Bottom-left finder
  for (let fy = 0; fy < FINDER_SIZE; fy++) {
    for (let fx = 0; fx < FINDER_SIZE; fx++) {
      const srcOffset = (fy * FINDER_SIZE + fx) * finderBpp
      setCell(
        fx,
        gridHeight - FINDER_SIZE + fy,
        finderPixels.subarray(srcOffset, srcOffset + finderBpp),
      )
    }
  }

  // Bottom-right alignment
  const alignPixels = generateAlignmentPixels(bitDepth)
  for (let ay = 0; ay < ALIGNMENT_SIZE; ay++) {
    for (let ax = 0; ax < ALIGNMENT_SIZE; ax++) {
      const srcOffset = (ay * ALIGNMENT_SIZE + ax) * bpp
      setCell(
        gridWidth - ALIGNMENT_SIZE + ax,
        gridHeight - ALIGNMENT_SIZE + ay,
        alignPixels.subarray(srcOffset, srcOffset + bpp),
      )
    }
  }

  // Render timing patterns
  // Horizontal timing: row FINDER_SIZE, x from FINDER_SIZE to gridWidth-FINDER_SIZE-1
  let timingIdx = 0
  for (let x = FINDER_SIZE; x < gridWidth - FINDER_SIZE; x++) {
    setCell(x, FINDER_SIZE, timingCellPixel(timingIdx++, bitDepth))
  }
  // Vertical timing: column FINDER_SIZE, y from FINDER_SIZE to gridHeight-FINDER_SIZE-1
  timingIdx = 0
  for (let y = FINDER_SIZE; y < gridHeight - FINDER_SIZE; y++) {
    setCell(FINDER_SIZE, y, timingCellPixel(timingIdx++, bitDepth))
  }

  // Render header cells
  const paddedHeader = new Uint8Array(headerCells * bytesPerCell)
  paddedHeader.set(headerBytes)
  for (let i = 0; i < headerCells; i++) {
    const cellData = paddedHeader.subarray(i * bytesPerCell, (i + 1) * bytesPerCell)
    const pixel = encodeCell(cellData, mode)
    const [cx, cy] = headerCoords[i]
    setCell(cx, cy, pixel)
  }

  // Render data cells
  const paddedData = new Uint8Array(dataCells * bytesPerCell)
  paddedData.set(interleavedStream)
  for (let i = 0; i < dataCells; i++) {
    const cellData = paddedData.subarray(i * bytesPerCell, (i + 1) * bytesPerCell)
    const pixel = encodeCell(cellData, mode)
    if (i < dataCoords.length) {
      const [cx, cy] = dataCoords[i]
      setCell(cx, cy, pixel)
    }
  }

  // Step 10: Write PNG
  return writePng(pixels, pixelWidth, pixelHeight, bitDepth)
}
