/**
 * Zero-dependency PNG encoder/decoder.
 * Supports RGBA color type (6) at 8-bit and 16-bit depth.
 * Uses node:zlib for deflate/inflate.
 */

import { deflateSync, inflateSync } from 'node:zlib'
import { crc32Multi } from './crc32.js'

const PNG_SIGNATURE = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])

export interface PngImage {
  /** Raw pixel data (RGBA). 8-bit: 4 bytes/pixel. 16-bit: 8 bytes/pixel (big-endian). */
  pixels: Uint8Array
  width: number
  height: number
  bitDepth: 8 | 16
}

/** Write a PNG chunk: length (4) + type (4) + data + CRC (4) */
function writeChunk(type: string, data: Uint8Array): Uint8Array {
  const typeBytes = new TextEncoder().encode(type)
  const length = data.length
  const chunk = new Uint8Array(12 + length)
  const view = new DataView(chunk.buffer)

  view.setUint32(0, length)
  chunk.set(typeBytes, 4)
  chunk.set(data, 8)
  const crc = crc32Multi(typeBytes, data)
  view.setUint32(8 + length, crc)

  return chunk
}

/**
 * Write RGBA pixel data as a PNG file.
 *
 * @param pixels - Raw RGBA pixel data.
 *   8-bit: 4 bytes per pixel (R,G,B,A each 1 byte).
 *   16-bit: 8 bytes per pixel (R,G,B,A each 2 bytes big-endian).
 * @param width - Image width in pixels
 * @param height - Image height in pixels
 * @param bitDepth - 8 or 16
 */
export function writePng(
  pixels: Uint8Array,
  width: number,
  height: number,
  bitDepth: 8 | 16 = 16,
): Uint8Array {
  const bytesPerPixel = bitDepth === 16 ? 8 : 4
  const expectedSize = width * height * bytesPerPixel
  if (pixels.length !== expectedSize) {
    throw new Error(
      `Pixel data size mismatch: got ${pixels.length}, expected ${expectedSize} (${width}x${height}x${bytesPerPixel})`,
    )
  }

  // IHDR: width(4) + height(4) + bitDepth(1) + colorType(1) + compression(1) + filter(1) + interlace(1) = 13
  const ihdr = new Uint8Array(13)
  const ihdrView = new DataView(ihdr.buffer)
  ihdrView.setUint32(0, width)
  ihdrView.setUint32(4, height)
  ihdr[8] = bitDepth
  ihdr[9] = 6 // RGBA
  ihdr[10] = 0 // deflate
  ihdr[11] = 0 // no filter (filter method 0)
  ihdr[12] = 0 // no interlace

  // Build raw scanlines with filter byte 0 (None) per row
  const rowBytes = width * bytesPerPixel
  const rawSize = height * (1 + rowBytes)
  const raw = new Uint8Array(rawSize)

  for (let y = 0; y < height; y++) {
    const rawOffset = y * (1 + rowBytes)
    raw[rawOffset] = 0 // filter type: None
    raw.set(pixels.subarray(y * rowBytes, (y + 1) * rowBytes), rawOffset + 1)
  }

  // Compress scanlines
  const compressed = deflateSync(Buffer.from(raw))

  // Assemble PNG
  const ihdrChunk = writeChunk('IHDR', ihdr)
  const idatChunk = writeChunk('IDAT', new Uint8Array(compressed))
  const iendChunk = writeChunk('IEND', new Uint8Array(0))

  const totalSize = PNG_SIGNATURE.length + ihdrChunk.length + idatChunk.length + iendChunk.length
  const png = new Uint8Array(totalSize)
  let offset = 0
  png.set(PNG_SIGNATURE, offset)
  offset += PNG_SIGNATURE.length
  png.set(ihdrChunk, offset)
  offset += ihdrChunk.length
  png.set(idatChunk, offset)
  offset += idatChunk.length
  png.set(iendChunk, offset)

  return png
}

/** Read a single PNG chunk starting at offset. Returns { type, data, nextOffset }. */
function readChunk(
  png: Uint8Array,
  offset: number,
): { type: string; data: Uint8Array; nextOffset: number } {
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength)
  const length = view.getUint32(offset)
  const typeBytes = png.subarray(offset + 4, offset + 8)
  const type = new TextDecoder().decode(typeBytes)
  const data = png.subarray(offset + 8, offset + 8 + length)

  // Verify CRC over type + data
  const storedCrc = view.getUint32(offset + 8 + length)
  const computedCrc = crc32Multi(typeBytes, data)
  if (storedCrc !== computedCrc) {
    throw new Error(`PNG chunk CRC mismatch in ${type} chunk`)
  }

  const nextOffset = offset + 12 + length
  return { type, data, nextOffset }
}

/**
 * Apply PNG scanline un-filtering.
 *
 * Supports all 5 filter types:
 * 0=None, 1=Sub, 2=Up, 3=Average, 4=Paeth
 */
function unfilter(
  raw: Uint8Array,
  width: number,
  height: number,
  bytesPerPixel: number,
): Uint8Array {
  const rowBytes = width * bytesPerPixel
  const pixels = new Uint8Array(width * height * bytesPerPixel)

  for (let y = 0; y < height; y++) {
    const rawRowStart = y * (1 + rowBytes)
    const filterType = raw[rawRowStart]
    const srcRow = raw.subarray(rawRowStart + 1, rawRowStart + 1 + rowBytes)
    const dstOffset = y * rowBytes

    for (let x = 0; x < rowBytes; x++) {
      const a = x >= bytesPerPixel ? pixels[dstOffset + x - bytesPerPixel] : 0
      const b = y > 0 ? pixels[dstOffset - rowBytes + x] : 0
      const c = x >= bytesPerPixel && y > 0 ? pixels[dstOffset - rowBytes + x - bytesPerPixel] : 0

      let val: number
      switch (filterType) {
        case 0: // None
          val = srcRow[x]
          break
        case 1: // Sub
          val = (srcRow[x] + a) & 0xff
          break
        case 2: // Up
          val = (srcRow[x] + b) & 0xff
          break
        case 3: // Average
          val = (srcRow[x] + Math.floor((a + b) / 2)) & 0xff
          break
        case 4: // Paeth
          val = (srcRow[x] + paethPredictor(a, b, c)) & 0xff
          break
        default:
          throw new Error(`Unknown PNG filter type: ${filterType}`)
      }
      pixels[dstOffset + x] = val
    }
  }

  return pixels
}

function paethPredictor(a: number, b: number, c: number): number {
  const p = a + b - c
  const pa = Math.abs(p - a)
  const pb = Math.abs(p - b)
  const pc = Math.abs(p - c)
  if (pa <= pb && pa <= pc) return a
  if (pb <= pc) return b
  return c
}

/**
 * Read a PNG file and extract RGBA pixel data.
 *
 * @param png - PNG file bytes
 * @returns Parsed image with pixel data, dimensions, and bit depth
 */
export function readPng(png: Uint8Array): PngImage {
  // Verify signature
  for (let i = 0; i < 8; i++) {
    if (png[i] !== PNG_SIGNATURE[i]) {
      throw new Error('Invalid PNG signature')
    }
  }

  let offset = 8
  let width = 0
  let height = 0
  let bitDepth: 8 | 16 = 8
  let colorType: number
  const idatChunks: Uint8Array[] = []

  while (offset < png.length) {
    const chunk = readChunk(png, offset)
    offset = chunk.nextOffset

    if (chunk.type === 'IHDR') {
      const view = new DataView(chunk.data.buffer, chunk.data.byteOffset, chunk.data.byteLength)
      width = view.getUint32(0)
      height = view.getUint32(4)
      bitDepth = chunk.data[8] as 8 | 16
      colorType = chunk.data[9]
      if (colorType !== 6) {
        throw new Error(`Unsupported PNG color type: ${colorType} (only RGBA/6 supported)`)
      }
      if (bitDepth !== 8 && bitDepth !== 16) {
        throw new Error(`Unsupported bit depth: ${bitDepth} (only 8 and 16 supported)`)
      }
    } else if (chunk.type === 'IDAT') {
      idatChunks.push(chunk.data)
    } else if (chunk.type === 'IEND') {
      break
    }
  }

  if (width === 0 || height === 0) {
    throw new Error('Missing IHDR chunk')
  }
  if (idatChunks.length === 0) {
    throw new Error('Missing IDAT chunk')
  }

  // Concatenate IDAT chunks
  const totalIdatLen = idatChunks.reduce((sum, c) => sum + c.length, 0)
  const compressedData = new Uint8Array(totalIdatLen)
  let pos = 0
  for (const chunk of idatChunks) {
    compressedData.set(chunk, pos)
    pos += chunk.length
  }

  // Decompress
  const raw = new Uint8Array(inflateSync(Buffer.from(compressedData)))

  // Unfilter
  const bytesPerPixel = bitDepth === 16 ? 8 : 4
  const pixels = unfilter(raw, width, height, bytesPerPixel)

  return { pixels, width, height, bitDepth }
}
