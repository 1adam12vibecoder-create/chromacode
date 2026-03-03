/**
 * CRC32 computation for PNG chunk integrity.
 * Uses pre-computed 256-entry lookup table.
 */

const TABLE = new Uint32Array(256)

// Build CRC32 lookup table (polynomial 0xEDB88320)
for (let i = 0; i < 256; i++) {
  let c = i
  for (let j = 0; j < 8; j++) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  }
  TABLE[i] = c
}

/** Compute CRC32 of a byte buffer */
export function crc32(data: Uint8Array): number {
  let crc = 0xffffffff
  for (let i = 0; i < data.length; i++) {
    crc = TABLE[(crc ^ data[i]) & 0xff] ^ (crc >>> 8)
  }
  return (crc ^ 0xffffffff) >>> 0
}

/** Compute CRC32 over multiple buffers (for PNG chunk type + data) */
export function crc32Multi(...buffers: Uint8Array[]): number {
  let crc = 0xffffffff
  for (const data of buffers) {
    for (let i = 0; i < data.length; i++) {
      crc = TABLE[(crc ^ data[i]) & 0xff] ^ (crc >>> 8)
    }
  }
  return (crc ^ 0xffffffff) >>> 0
}
