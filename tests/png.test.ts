import { describe, it, expect } from 'vitest'
import { writePng, readPng } from '../src/png.js'

describe('PNG codec', () => {
  describe('8-bit RGBA', () => {
    it('round-trips a 1x1 pixel', () => {
      const pixels = new Uint8Array([255, 0, 128, 200])
      const png = writePng(pixels, 1, 1, 8)
      const result = readPng(png)
      expect(result.width).toBe(1)
      expect(result.height).toBe(1)
      expect(result.bitDepth).toBe(8)
      expect(result.pixels).toEqual(pixels)
    })

    it('round-trips a 4x4 image', () => {
      const pixels = new Uint8Array(4 * 4 * 4)
      for (let i = 0; i < pixels.length; i++) {
        pixels[i] = (i * 37 + 13) & 0xff
      }
      const png = writePng(pixels, 4, 4, 8)
      const result = readPng(png)
      expect(result.width).toBe(4)
      expect(result.height).toBe(4)
      expect(result.bitDepth).toBe(8)
      expect(result.pixels).toEqual(pixels)
    })

    it('round-trips a 100x100 image with random data', () => {
      const w = 100,
        h = 100
      const pixels = new Uint8Array(w * h * 4)
      for (let i = 0; i < pixels.length; i++) {
        pixels[i] = (i * 127 + i * i) & 0xff
      }
      const png = writePng(pixels, w, h, 8)
      const result = readPng(png)
      expect(result.width).toBe(w)
      expect(result.height).toBe(h)
      expect(result.pixels).toEqual(pixels)
    })

    it('preserves extreme values (0x00 and 0xff)', () => {
      // 2x1 image: first pixel all zeros, second all 255
      const pixels = new Uint8Array([0, 0, 0, 0, 255, 255, 255, 255])
      const png = writePng(pixels, 2, 1, 8)
      const result = readPng(png)
      expect(result.pixels).toEqual(pixels)
    })
  })

  describe('16-bit RGBA', () => {
    it('round-trips a 1x1 pixel', () => {
      // 16-bit RGBA: 8 bytes per pixel (RRGGBBAA big-endian)
      const pixels = new Uint8Array(8)
      const view = new DataView(pixels.buffer)
      view.setUint16(0, 65535) // R
      view.setUint16(2, 0) // G
      view.setUint16(4, 32768) // B
      view.setUint16(6, 50000) // A
      const png = writePng(pixels, 1, 1, 16)
      const result = readPng(png)
      expect(result.width).toBe(1)
      expect(result.height).toBe(1)
      expect(result.bitDepth).toBe(16)
      expect(result.pixels).toEqual(pixels)
    })

    it('round-trips a 10x10 image', () => {
      const w = 10,
        h = 10
      const pixels = new Uint8Array(w * h * 8)
      const view = new DataView(pixels.buffer)
      for (let i = 0; i < w * h * 4; i++) {
        view.setUint16(i * 2, (i * 257 + i * i) & 0xffff)
      }
      const png = writePng(pixels, w, h, 16)
      const result = readPng(png)
      expect(result.width).toBe(w)
      expect(result.height).toBe(h)
      expect(result.bitDepth).toBe(16)
      expect(result.pixels).toEqual(pixels)
    })

    it('preserves full 16-bit range', () => {
      // 1x1 pixel with max values
      const pixels = new Uint8Array(8)
      const view = new DataView(pixels.buffer)
      view.setUint16(0, 65535)
      view.setUint16(2, 65535)
      view.setUint16(4, 65535)
      view.setUint16(6, 65535)
      const png = writePng(pixels, 1, 1, 16)
      const result = readPng(png)
      const rView = new DataView(result.pixels.buffer)
      expect(rView.getUint16(0)).toBe(65535)
      expect(rView.getUint16(2)).toBe(65535)
      expect(rView.getUint16(4)).toBe(65535)
      expect(rView.getUint16(6)).toBe(65535)
    })

    it('round-trips a 50x50 image with varied data', () => {
      const w = 50,
        h = 50
      const pixels = new Uint8Array(w * h * 8)
      const view = new DataView(pixels.buffer)
      for (let i = 0; i < w * h * 4; i++) {
        view.setUint16(i * 2, (i * 1337 + 42) & 0xffff)
      }
      const png = writePng(pixels, w, h, 16)
      const result = readPng(png)
      expect(result.pixels).toEqual(pixels)
    })
  })

  describe('error handling', () => {
    it('throws on wrong pixel data size', () => {
      expect(() => writePng(new Uint8Array(3), 1, 1, 8)).toThrow('size mismatch')
    })

    it('throws on invalid PNG signature', () => {
      expect(() => readPng(new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7]))).toThrow(
        'Invalid PNG signature',
      )
    })
  })
})
