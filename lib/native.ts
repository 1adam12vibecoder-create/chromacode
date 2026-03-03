/**
 * Native ChromaCode bindings — loads C addon via N-API, falls back to pure JS.
 */

import { createRequire } from 'node:module'
import type { EncodeOptions, CapacityInfo } from '../src/types.js'
import { encode as jsEncode } from '../src/encode.js'
import { decode as jsDecode } from '../src/decode.js'
import { capacity as jsCapacity } from '../src/capacity.js'

interface NativeAddon {
  encode(data: Uint8Array, options?: Partial<EncodeOptions>): Uint8Array
  decode(png: Uint8Array): Uint8Array
  capacity(options?: Partial<EncodeOptions>): CapacityInfo
}

let native: NativeAddon | null = null

try {
  const require = createRequire(import.meta.url)
  const addon = require('../build/Release/chromacode_native.node')
  native = addon as NativeAddon
} catch {
  // Native addon not built — will use pure JS fallback
  native = null
}

/** Whether the native C addon is loaded */
export const isNative = native !== null

/**
 * Encode binary data into a ChromaCode PNG image.
 * Uses native C implementation if available, otherwise falls back to pure JS.
 */
export function encode(data: Uint8Array, options?: Partial<EncodeOptions>): Uint8Array {
  if (native) {
    return native.encode(data, options)
  }
  return jsEncode(data, options)
}

/**
 * Decode a ChromaCode PNG image back to binary data.
 * Uses native C implementation if available, otherwise falls back to pure JS.
 */
export function decode(png: Uint8Array): Uint8Array {
  if (native) {
    return native.decode(png)
  }
  return jsDecode(png)
}

/**
 * Get capacity information for given encoding options.
 * Uses native C implementation if available, otherwise falls back to pure JS.
 */
export function capacity(options?: Partial<EncodeOptions>): CapacityInfo {
  if (native) {
    return native.capacity(options)
  }
  return jsCapacity(options)
}
