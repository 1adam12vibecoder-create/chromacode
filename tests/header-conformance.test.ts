/**
 * Header format conformance tests: verify bit-exact header layout
 * per the PROTOCOL.md specification.
 *
 * Header layout (bit-packed):
 * Byte 0:   version(4b) | mode(4b)
 * Byte 1:   ecLevel(2b) | hasSequence(1b) | compressed(1b) | reserved(4b)
 * Bytes 2-4: gridWidth(12b) | gridHeight(12b)
 * Bytes 5-8: dataLength(32b big-endian)
 * [Bytes 9-12: seq_id(16b) | seq_index(8b) | seq_total(8b)]  if hasSequence
 * Last 2 bytes: CRC16 (lower 16 of CRC32 over preceding bytes)
 */

import { describe, it, expect } from 'vitest'
import { encodeHeader, decodeHeader, headerSize } from '../src/grid.js'
import { crc32 } from '../src/crc32.js'
import type { HeaderMeta, EncodingMode, ECLevel } from '../src/types.js'
import { MODE_ID, EC_ID } from '../src/types.js'

describe('header byte layout', () => {
  it('byte 0: version and mode nibbles', () => {
    const header: HeaderMeta = {
      version: 1,
      mode: 'rgba64',
      ecLevel: 'L',
      compressed: false,
      gridWidth: 16,
      gridHeight: 16,
      dataLength: 0,
    }
    const buf = encodeHeader(header)

    // version=1 in high nibble, mode=0 (rgba64) in low nibble
    expect(buf[0]).toBe(0x10)
  })

  it('byte 0: all version/mode combinations', () => {
    const modes: EncodingMode[] = ['rgba64', 'rgba32', 'rgb48', 'rgb24']
    for (let v = 0; v <= 15; v++) {
      for (const mode of modes) {
        const header: HeaderMeta = {
          version: v,
          mode,
          ecLevel: 'L',
          compressed: false,
          gridWidth: 16,
          gridHeight: 16,
          dataLength: 0,
        }
        const buf = encodeHeader(header)
        expect((buf[0] >> 4) & 0x0f).toBe(v)
        expect(buf[0] & 0x0f).toBe(MODE_ID[mode])
      }
    }
  })

  it('byte 1: EC level bits', () => {
    const levels: ECLevel[] = ['L', 'M', 'Q', 'H']
    for (const ecLevel of levels) {
      const header: HeaderMeta = {
        version: 1,
        mode: 'rgba64',
        ecLevel,
        compressed: false,
        gridWidth: 16,
        gridHeight: 16,
        dataLength: 0,
      }
      const buf = encodeHeader(header)
      expect((buf[1] >> 6) & 0x03).toBe(EC_ID[ecLevel])
    }
  })

  it('byte 1: hasSequence flag (bit 5)', () => {
    const noSeq: HeaderMeta = {
      version: 1,
      mode: 'rgba64',
      ecLevel: 'L',
      compressed: false,
      gridWidth: 16,
      gridHeight: 16,
      dataLength: 0,
    }
    const withSeq: HeaderMeta = {
      ...noSeq,
      sequence: { id: 1, index: 0, total: 2 },
    }
    expect(encodeHeader(noSeq)[1] & 0x20).toBe(0)
    expect(encodeHeader(withSeq)[1] & 0x20).toBe(0x20)
  })

  it('byte 1: compressed flag (bit 4)', () => {
    const uncompressed: HeaderMeta = {
      version: 1,
      mode: 'rgba64',
      ecLevel: 'L',
      compressed: false,
      gridWidth: 16,
      gridHeight: 16,
      dataLength: 0,
    }
    const compressed: HeaderMeta = { ...uncompressed, compressed: true }
    expect(encodeHeader(uncompressed)[1] & 0x10).toBe(0)
    expect(encodeHeader(compressed)[1] & 0x10).toBe(0x10)
  })

  it('bytes 2-4: 12-bit grid dimensions', () => {
    const header: HeaderMeta = {
      version: 1,
      mode: 'rgba64',
      ecLevel: 'L',
      compressed: false,
      gridWidth: 0xabc, // 2748
      gridHeight: 0xdef, // 3567
      dataLength: 0,
    }
    const buf = encodeHeader(header)

    // gridWidth (12 bits): 0xABC
    // buf[2] = high 8 bits of gridWidth = 0xAB
    // buf[3] high nibble = low 4 bits of gridWidth = 0xC
    const gw = ((buf[2] << 4) | (buf[3] >> 4)) & 0xfff
    expect(gw).toBe(0xabc)

    // gridHeight (12 bits): 0xDEF
    // buf[3] low nibble = high 4 bits of gridHeight = 0xD
    // buf[4] = low 8 bits of gridHeight = 0xEF
    const gh = (((buf[3] & 0x0f) << 8) | buf[4]) & 0xfff
    expect(gh).toBe(0xdef)
  })

  it('bytes 5-8: dataLength big-endian', () => {
    const header: HeaderMeta = {
      version: 1,
      mode: 'rgba64',
      ecLevel: 'L',
      compressed: false,
      gridWidth: 100,
      gridHeight: 100,
      dataLength: 0x12345678,
    }
    const buf = encodeHeader(header)
    const view = new DataView(buf.buffer, buf.byteOffset)
    expect(view.getUint32(5)).toBe(0x12345678)
  })

  it('dataLength max value (0xFFFFFFFF)', () => {
    const header: HeaderMeta = {
      version: 1,
      mode: 'rgba64',
      ecLevel: 'L',
      compressed: false,
      gridWidth: 100,
      gridHeight: 100,
      dataLength: 0xffffffff,
    }
    const buf = encodeHeader(header)
    const decoded = decodeHeader(buf)
    expect(decoded.dataLength).toBe(0xffffffff)
  })

  it('bytes 9-12: sequence fields', () => {
    const header: HeaderMeta = {
      version: 1,
      mode: 'rgba64',
      ecLevel: 'L',
      compressed: false,
      gridWidth: 16,
      gridHeight: 16,
      dataLength: 100,
      sequence: { id: 0x1234, index: 5, total: 10 },
    }
    const buf = encodeHeader(header)
    const view = new DataView(buf.buffer, buf.byteOffset)

    expect(view.getUint16(9)).toBe(0x1234) // seq_id
    expect(buf[11]).toBe(5) // seq_index
    expect(buf[12]).toBe(10) // seq_total
  })

  it('sequence boundary values', () => {
    const header: HeaderMeta = {
      version: 1,
      mode: 'rgba64',
      ecLevel: 'L',
      compressed: false,
      gridWidth: 16,
      gridHeight: 16,
      dataLength: 0,
      sequence: { id: 0xffff, index: 255, total: 255 },
    }
    const decoded = decodeHeader(encodeHeader(header))
    expect(decoded.sequence!.id).toBe(0xffff)
    expect(decoded.sequence!.index).toBe(255)
    expect(decoded.sequence!.total).toBe(255)
  })

  it('CRC16 is lower 16 bits of CRC32', () => {
    const header: HeaderMeta = {
      version: 1,
      mode: 'rgba64',
      ecLevel: 'L',
      compressed: false,
      gridWidth: 50,
      gridHeight: 50,
      dataLength: 1000,
    }
    const buf = encodeHeader(header)
    const size = 14 // no sequence
    const crcData = buf.subarray(0, size - 2)
    const expectedCrc = crc32(crcData) & 0xffff
    const view = new DataView(buf.buffer, buf.byteOffset)
    expect(view.getUint16(size - 2)).toBe(expectedCrc)
  })

  it('header sizes are correct', () => {
    expect(headerSize(false)).toBe(14)
    expect(headerSize(true)).toBe(18)
  })
})

describe('header round-trip for all field combinations', () => {
  const modes: EncodingMode[] = ['rgba64', 'rgba32', 'rgb48', 'rgb24']
  const ecLevels: ECLevel[] = ['L', 'M', 'Q', 'H']

  for (const mode of modes) {
    for (const ecLevel of ecLevels) {
      for (const compressed of [false, true]) {
        it(`round-trips: ${mode} / EC_${ecLevel} / compressed=${compressed}`, () => {
          const header: HeaderMeta = {
            version: 1,
            mode,
            ecLevel,
            compressed,
            gridWidth: 42,
            gridHeight: 99,
            dataLength: 12345,
          }
          const decoded = decodeHeader(encodeHeader(header))
          expect(decoded.version).toBe(1)
          expect(decoded.mode).toBe(mode)
          expect(decoded.ecLevel).toBe(ecLevel)
          expect(decoded.compressed).toBe(compressed)
          expect(decoded.gridWidth).toBe(42)
          expect(decoded.gridHeight).toBe(99)
          expect(decoded.dataLength).toBe(12345)
          expect(decoded.sequence).toBeUndefined()
        })
      }
    }
  }
})
