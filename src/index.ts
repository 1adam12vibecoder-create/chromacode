/**
 * ChromaCode: Multi-dimensional visual data encoding.
 *
 * Encodes binary data into PNG images using color + opacity channels,
 * with Reed-Solomon error correction. Designed for digital-first extraction
 * (byte-perfect from embedded PNGs, not camera scanning).
 */

export { encode } from './encode.js'
export { decode } from './decode.js'
export { capacity } from './capacity.js'

export type { EncodeOptions, CapacityInfo, EncodingMode, ECLevel, SequenceInfo } from './types.js'
