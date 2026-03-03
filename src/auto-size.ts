/**
 * Auto-calculate optimal grid dimensions for a given payload.
 */

import type { EncodingMode, ECLevel } from './types.js'
import { BYTES_PER_CELL, EC_RATIO, MIN_GRID_SIZE, MAX_GRID_SIZE, RS_MAX_BLOCK } from './types.js'
import { dataCellCount, headerSize } from './grid.js'
import { ecSymbolCount } from './reed-solomon.js'

/**
 * Calculate how many data bytes can fit in a grid of given dimensions,
 * after subtracting structural cells, header, and EC overhead.
 */
export function usableCapacity(
  width: number,
  height: number,
  mode: EncodingMode,
  ecLevel: ECLevel,
  hasSequence: boolean,
): number {
  const totalDataCells = dataCellCount(width, height)
  const bytesPerCell = BYTES_PER_CELL[mode]
  const hdrSize = headerSize(hasSequence)

  // Header cells needed
  const headerCells = Math.ceil(hdrSize / bytesPerCell)

  // Remaining cells for data + EC
  const remainingCells = totalDataCells - headerCells
  if (remainingCells <= 0) return 0

  // Total raw bytes available for data + EC
  const totalRawBytes = remainingCells * bytesPerCell
  const ecRatio = EC_RATIO[ecLevel]

  // Use the same block-splitting logic as the encoder:
  // find max dataPerBlock where dataPerBlock + ecSymbolCount(dataPerBlock) <= 255
  let dataPerBlock: number
  for (dataPerBlock = RS_MAX_BLOCK - 2; dataPerBlock >= 1; dataPerBlock--) {
    const ec = ecSymbolCount(dataPerBlock, ecRatio)
    if (dataPerBlock + ec <= RS_MAX_BLOCK) break
  }
  const ecPerBlock = ecSymbolCount(dataPerBlock, ecRatio)
  const blockTotal = dataPerBlock + ecPerBlock

  // How many full blocks fit in the available bytes?
  const numBlocks = Math.floor(totalRawBytes / blockTotal)
  if (numBlocks <= 0) {
    // Partial block: all available bytes minus EC overhead
    const ec = ecSymbolCount(Math.max(1, totalRawBytes), ecRatio)
    return Math.max(0, totalRawBytes - ec)
  }

  // Full blocks plus any remaining partial block
  let capacity = numBlocks * dataPerBlock
  const remaining = totalRawBytes - numBlocks * blockTotal
  if (remaining > 0) {
    const partialEc = ecSymbolCount(remaining, ecRatio)
    capacity += Math.max(0, remaining - partialEc)
  }

  return capacity
}

/**
 * Auto-calculate grid dimensions to fit the given data.
 * Tries square grids first, then slightly rectangular ones.
 *
 * @param dataLength - Bytes of payload data (before EC)
 * @param mode - Encoding mode
 * @param ecLevel - Error correction level
 * @param hasSequence - Whether sequence header fields are needed
 * @returns Grid dimensions { width, height }
 */
export function autoSize(
  dataLength: number,
  mode: EncodingMode,
  ecLevel: ECLevel,
  hasSequence: boolean,
): { width: number; height: number } {
  // For empty data, just need room for the header
  if (dataLength === 0) {
    const hdrSize = headerSize(hasSequence)
    const bytesPerCell = BYTES_PER_CELL[mode]
    const headerCells = Math.ceil(hdrSize / bytesPerCell)
    for (let size = MIN_GRID_SIZE; size <= MAX_GRID_SIZE; size++) {
      if (dataCellCount(size, size) >= headerCells) {
        return { width: size, height: size }
      }
    }
  }

  // Start with minimum grid and grow until data fits
  for (let size = MIN_GRID_SIZE; size <= MAX_GRID_SIZE; size++) {
    // Try square first
    const cap = usableCapacity(size, size, mode, ecLevel, hasSequence)
    if (cap >= dataLength) {
      return { width: size, height: size }
    }
  }

  throw new Error(`Data too large (${dataLength} bytes) — exceeds maximum grid capacity`)
}
