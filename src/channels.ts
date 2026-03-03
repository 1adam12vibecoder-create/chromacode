/**
 * Cell-level data encoding/decoding.
 * Maps raw bytes to/from RGBA pixel values based on encoding mode.
 */

import type { EncodingMode } from './types.js'
import { BYTES_PER_CELL, BIT_DEPTH } from './types.js'

/**
 * Encode data bytes into RGBA pixel values for one cell.
 * Returns pixel bytes in PNG format (big-endian for 16-bit).
 *
 * @param data - Data bytes for this cell (length = BYTES_PER_CELL[mode])
 * @param mode - Encoding mode
 * @returns RGBA pixel bytes (always 4 or 8 bytes for 8/16-bit RGBA PNG)
 */
export function encodeCell(data: Uint8Array, mode: EncodingMode): Uint8Array {
  const depth = BIT_DEPTH[mode]

  if (depth === 16) {
    // 16-bit PNG: 8 bytes per pixel (R16, G16, B16, A16 big-endian)
    const pixel = new Uint8Array(8)
    const view = new DataView(pixel.buffer)

    if (mode === 'rgba64') {
      // 8 data bytes → R16(2) + G16(2) + B16(2) + A16(2)
      view.setUint16(0, (data[0] << 8) | data[1]) // R
      view.setUint16(2, (data[2] << 8) | data[3]) // G
      view.setUint16(4, (data[4] << 8) | data[5]) // B
      view.setUint16(6, (data[6] << 8) | data[7]) // A
    } else {
      // rgb48: 6 data bytes → R16(2) + G16(2) + B16(2), A = max
      view.setUint16(0, (data[0] << 8) | data[1]) // R
      view.setUint16(2, (data[2] << 8) | data[3]) // G
      view.setUint16(4, (data[4] << 8) | data[5]) // B
      view.setUint16(6, 65535) // A = max (not data)
    }
    return pixel
  } else {
    // 8-bit PNG: 4 bytes per pixel (R8, G8, B8, A8)
    const pixel = new Uint8Array(4)

    if (mode === 'rgba32') {
      // 4 data bytes → R8 + G8 + B8 + A8
      pixel[0] = data[0]
      pixel[1] = data[1]
      pixel[2] = data[2]
      pixel[3] = data[3]
    } else {
      // rgb24: 3 data bytes → R8 + G8 + B8, A = 255
      pixel[0] = data[0]
      pixel[1] = data[1]
      pixel[2] = data[2]
      pixel[3] = 255 // A = max (not data)
    }
    return pixel
  }
}

/**
 * Decode RGBA pixel values back to data bytes for one cell.
 *
 * @param pixel - RGBA pixel bytes from PNG
 * @param mode - Encoding mode
 * @returns Extracted data bytes (length = BYTES_PER_CELL[mode])
 */
export function decodeCell(pixel: Uint8Array, mode: EncodingMode): Uint8Array {
  const depth = BIT_DEPTH[mode]
  const bytesPerCell = BYTES_PER_CELL[mode]
  const result = new Uint8Array(bytesPerCell)

  if (depth === 16) {
    const view = new DataView(pixel.buffer, pixel.byteOffset, pixel.byteLength)

    if (mode === 'rgba64') {
      const r = view.getUint16(0)
      const g = view.getUint16(2)
      const b = view.getUint16(4)
      const a = view.getUint16(6)
      result[0] = (r >> 8) & 0xff
      result[1] = r & 0xff
      result[2] = (g >> 8) & 0xff
      result[3] = g & 0xff
      result[4] = (b >> 8) & 0xff
      result[5] = b & 0xff
      result[6] = (a >> 8) & 0xff
      result[7] = a & 0xff
    } else {
      // rgb48
      const r = view.getUint16(0)
      const g = view.getUint16(2)
      const b = view.getUint16(4)
      result[0] = (r >> 8) & 0xff
      result[1] = r & 0xff
      result[2] = (g >> 8) & 0xff
      result[3] = g & 0xff
      result[4] = (b >> 8) & 0xff
      result[5] = b & 0xff
    }
  } else {
    if (mode === 'rgba32') {
      result[0] = pixel[0]
      result[1] = pixel[1]
      result[2] = pixel[2]
      result[3] = pixel[3]
    } else {
      // rgb24
      result[0] = pixel[0]
      result[1] = pixel[1]
      result[2] = pixel[2]
    }
  }

  return result
}
