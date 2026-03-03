/**
 * Block interleaving for burst error resistance.
 * Distributes codewords across RS blocks so that a localized
 * corruption affects symbols in different blocks rather than
 * overwhelming a single block's EC capacity.
 */

/**
 * Interleave multiple RS blocks into a single stream.
 * Takes codewords from each block round-robin.
 *
 * E.g., blocks [[A0,A1,A2], [B0,B1,B2]] → [A0,B0,A1,B1,A2,B2]
 */
export function interleave(blocks: Uint8Array[]): Uint8Array {
  if (blocks.length === 0) return new Uint8Array(0)
  if (blocks.length === 1) return blocks[0]

  const maxLen = Math.max(...blocks.map((b) => b.length))
  const total = blocks.reduce((sum, b) => sum + b.length, 0)
  const result = new Uint8Array(total)
  let pos = 0

  for (let i = 0; i < maxLen; i++) {
    for (const block of blocks) {
      if (i < block.length) {
        result[pos++] = block[i]
      }
    }
  }

  return result
}

/**
 * Deinterleave a stream back into RS blocks.
 *
 * @param stream - Interleaved byte stream
 * @param blockSizes - Array of block sizes (sum must equal stream.length)
 */
export function deinterleave(stream: Uint8Array, blockSizes: number[]): Uint8Array[] {
  if (blockSizes.length === 0) return []
  if (blockSizes.length === 1) return [stream.slice()]

  const blocks = blockSizes.map((size) => new Uint8Array(size))
  const cursors = new Array(blockSizes.length).fill(0)
  const maxLen = Math.max(...blockSizes)
  let pos = 0

  for (let i = 0; i < maxLen; i++) {
    for (let b = 0; b < blocks.length; b++) {
      if (i < blockSizes[b]) {
        blocks[b][cursors[b]++] = stream[pos++]
      }
    }
  }

  return blocks
}
