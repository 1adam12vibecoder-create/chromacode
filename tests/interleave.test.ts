import { describe, it, expect } from 'vitest'
import { interleave, deinterleave } from '../src/interleave.js'

describe('interleaving', () => {
  it('interleaves two equal blocks', () => {
    const a = new Uint8Array([1, 2, 3])
    const b = new Uint8Array([4, 5, 6])
    const result = interleave([a, b])
    expect(result).toEqual(new Uint8Array([1, 4, 2, 5, 3, 6]))
  })

  it('interleaves three blocks', () => {
    const a = new Uint8Array([1, 2])
    const b = new Uint8Array([3, 4])
    const c = new Uint8Array([5, 6])
    const result = interleave([a, b, c])
    expect(result).toEqual(new Uint8Array([1, 3, 5, 2, 4, 6]))
  })

  it('handles unequal block sizes', () => {
    const a = new Uint8Array([1, 2, 3])
    const b = new Uint8Array([4, 5])
    const result = interleave([a, b])
    // Round-robin: a[0]=1, b[0]=4, a[1]=2, b[1]=5, a[2]=3
    expect(result).toEqual(new Uint8Array([1, 4, 2, 5, 3]))
  })

  it('handles single block', () => {
    const a = new Uint8Array([1, 2, 3])
    const result = interleave([a])
    expect(result).toEqual(a)
  })

  it('handles empty input', () => {
    const result = interleave([])
    expect(result).toEqual(new Uint8Array(0))
  })

  it('round-trips with deinterleave (equal blocks)', () => {
    const blocks = [
      new Uint8Array([10, 20, 30]),
      new Uint8Array([40, 50, 60]),
      new Uint8Array([70, 80, 90]),
    ]
    const stream = interleave(blocks)
    const restored = deinterleave(stream, [3, 3, 3])
    for (let i = 0; i < blocks.length; i++) {
      expect(restored[i]).toEqual(blocks[i])
    }
  })

  it('round-trips with deinterleave (unequal blocks)', () => {
    const blocks = [new Uint8Array([1, 2, 3, 4]), new Uint8Array([5, 6, 7])]
    const stream = interleave(blocks)
    const restored = deinterleave(stream, [4, 3])
    expect(restored[0]).toEqual(blocks[0])
    expect(restored[1]).toEqual(blocks[1])
  })
})
