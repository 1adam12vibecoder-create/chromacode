import { describe, it, expect } from 'vitest'
import { encodeCell, decodeCell } from '../src/channels.js'
import type { EncodingMode } from '../src/types.js'

describe('channel encoding', () => {
  const modes: EncodingMode[] = ['rgba64', 'rgba32', 'rgb48', 'rgb24']
  const bytesPerCell: Record<EncodingMode, number> = {
    rgba64: 8,
    rgba32: 4,
    rgb48: 6,
    rgb24: 3,
  }

  for (const mode of modes) {
    describe(mode, () => {
      it('round-trips data', () => {
        const bpc = bytesPerCell[mode]
        const data = new Uint8Array(bpc)
        for (let i = 0; i < bpc; i++) data[i] = (i * 37 + 100) & 0xff
        const pixel = encodeCell(data, mode)
        const decoded = decodeCell(pixel, mode)
        expect(decoded).toEqual(data)
      })

      it('round-trips zeros', () => {
        const bpc = bytesPerCell[mode]
        const data = new Uint8Array(bpc)
        const pixel = encodeCell(data, mode)
        const decoded = decodeCell(pixel, mode)
        expect(decoded).toEqual(data)
      })

      it('round-trips max values', () => {
        const bpc = bytesPerCell[mode]
        const data = new Uint8Array(bpc)
        data.fill(0xff)
        const pixel = encodeCell(data, mode)
        const decoded = decodeCell(pixel, mode)
        expect(decoded).toEqual(data)
      })
    })
  }

  it('rgba32 preserves alpha channel as data', () => {
    const data = new Uint8Array([10, 20, 30, 40])
    const pixel = encodeCell(data, 'rgba32')
    expect(pixel[3]).toBe(40) // alpha = data byte
  })

  it('rgb24 sets alpha to 255', () => {
    const data = new Uint8Array([10, 20, 30])
    const pixel = encodeCell(data, 'rgb24')
    expect(pixel[3]).toBe(255)
  })

  it('rgb48 sets alpha to 65535', () => {
    const data = new Uint8Array([10, 20, 30, 40, 50, 60])
    const pixel = encodeCell(data, 'rgb48')
    const view = new DataView(pixel.buffer)
    expect(view.getUint16(6)).toBe(65535)
  })
})
