/**
 * Capacity calculator: how much data fits in a ChromaCode image.
 */

import type { EncodeOptions, CapacityInfo } from './types.js'
import { DEFAULT_OPTIONS, BYTES_PER_CELL, BITS_PER_CELL, EC_RATIO, RS_MAX_BLOCK } from './types.js'
import { structuralCellCount, dataCellCount, headerSize } from './grid.js'
import { ecSymbolCount } from './reed-solomon.js'
import { autoSize } from './auto-size.js'

/**
 * Get capacity information for given encoding options.
 * If width/height are not specified, returns info for the minimum grid
 * that can hold at least 1 byte.
 */
export function capacity(options?: Partial<EncodeOptions>): CapacityInfo {
  const opts = { ...DEFAULT_OPTIONS, ...options }
  const { mode, ecLevel, sequence } = opts
  const hasSequence = sequence !== undefined
  const bytesPerCell = BYTES_PER_CELL[mode]
  const bitsPerCell = BITS_PER_CELL[mode]
  const ecRatio = EC_RATIO[ecLevel]

  let gridWidth: number
  let gridHeight: number

  if (opts.width && opts.height) {
    gridWidth = opts.width
    gridHeight = opts.height
  } else {
    // Use minimum grid that fits at least 1 byte
    const auto = autoSize(1, mode, ecLevel, hasSequence)
    gridWidth = auto.width
    gridHeight = auto.height
  }

  const totalCells = gridWidth * gridHeight
  const structural = structuralCellCount(gridWidth, gridHeight)
  const totalDataCells = dataCellCount(gridWidth, gridHeight)
  const hdrSize = headerSize(hasSequence)
  const headerCells = Math.ceil(hdrSize / bytesPerCell)
  const payloadDataCells = totalDataCells - headerCells

  // Calculate usable data bytes after EC overhead
  const rawBytes = payloadDataCells * bytesPerCell

  // Determine EC overhead
  let dataBytes: number
  let ecBytes: number

  if (rawBytes <= 0) {
    dataBytes = 0
    ecBytes = 0
  } else if (rawBytes <= RS_MAX_BLOCK) {
    const ec = ecSymbolCount(rawBytes, ecRatio)
    dataBytes = Math.max(0, rawBytes - ec)
    ecBytes = ec
  } else {
    const numBlocks = Math.ceil(rawBytes / RS_MAX_BLOCK)

    // Find data per block (same logic as encoder)
    let dataPerBlock: number
    for (dataPerBlock = RS_MAX_BLOCK - 2; dataPerBlock >= 1; dataPerBlock--) {
      const ec = ecSymbolCount(dataPerBlock, ecRatio)
      if (dataPerBlock + ec <= RS_MAX_BLOCK) break
    }
    const ecPerBlock = ecSymbolCount(dataPerBlock, ecRatio)
    dataBytes = dataPerBlock * numBlocks
    ecBytes = ecPerBlock * numBlocks
  }

  return {
    gridWidth,
    gridHeight,
    totalCells,
    dataCells: totalDataCells,
    bitsPerCell,
    dataBytes,
    ecBytes,
    structuralCells: structural,
  }
}
