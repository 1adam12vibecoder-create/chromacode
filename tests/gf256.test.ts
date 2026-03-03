import { describe, it, expect } from 'vitest'
import { EXP, LOG, add, mul, div, inverse, pow, polyEval, polyMul } from '../src/gf256.js'

describe('GF(2^8) tables', () => {
  it('EXP[0] = 1 (alpha^0 = 1)', () => {
    expect(EXP[0]).toBe(1)
  })

  it('EXP table wraps at 255', () => {
    for (let i = 0; i < 255; i++) {
      expect(EXP[i]).toBe(EXP[i + 255])
    }
  })

  it('LOG and EXP are inverses', () => {
    for (let i = 1; i < 256; i++) {
      expect(EXP[LOG[i]]).toBe(i)
    }
  })

  it('generates all non-zero elements', () => {
    const seen = new Set<number>()
    for (let i = 0; i < 255; i++) {
      seen.add(EXP[i])
    }
    expect(seen.size).toBe(255)
    expect(seen.has(0)).toBe(false)
  })
})

describe('GF(2^8) arithmetic', () => {
  it('addition is XOR', () => {
    expect(add(0, 0)).toBe(0)
    expect(add(1, 1)).toBe(0) // self-inverse
    expect(add(0x53, 0xca)).toBe(0x53 ^ 0xca)
  })

  it('multiplication by 0 is 0', () => {
    expect(mul(0, 100)).toBe(0)
    expect(mul(100, 0)).toBe(0)
  })

  it('multiplication by 1 is identity', () => {
    for (let i = 0; i < 256; i++) {
      expect(mul(i, 1)).toBe(i)
    }
  })

  it('multiplication is commutative', () => {
    expect(mul(3, 7)).toBe(mul(7, 3))
    expect(mul(0x53, 0xca)).toBe(mul(0xca, 0x53))
  })

  it('division reverses multiplication', () => {
    for (let a = 1; a < 256; a += 17) {
      for (let b = 1; b < 256; b += 23) {
        const product = mul(a, b)
        expect(div(product, b)).toBe(a)
        expect(div(product, a)).toBe(b)
      }
    }
  })

  it('division by zero throws', () => {
    expect(() => div(1, 0)).toThrow('Division by zero')
  })

  it('inverse: a * inverse(a) = 1', () => {
    for (let a = 1; a < 256; a++) {
      expect(mul(a, inverse(a))).toBe(1)
    }
  })

  it('inverse of zero throws', () => {
    expect(() => inverse(0)).toThrow('Zero has no inverse')
  })

  it('pow matches repeated multiplication', () => {
    expect(pow(2, 0)).toBe(1)
    expect(pow(2, 1)).toBe(2)
    expect(pow(2, 8)).toBe(mul(mul(mul(2, 2), mul(2, 2)), mul(mul(2, 2), mul(2, 2))))
    expect(pow(0, 5)).toBe(0)
    expect(pow(0, 0)).toBe(1) // convention
  })
})

describe('GF(2^8) polynomial operations', () => {
  it('polyEval evaluates correctly', () => {
    // p(x) = 3x^2 + 2x + 1 → coefficients [3, 2, 1] (high to low)
    const p = new Uint8Array([3, 2, 1])
    expect(polyEval(p, 0)).toBe(1) // p(0) = 1
    expect(polyEval(p, 1)).toBe(add(add(3, 2), 1)) // p(1) = 3 XOR 2 XOR 1 = 0
  })

  it('polyMul multiplies correctly', () => {
    // (x + 1)(x + 2) = x^2 + 3x + 2 in GF(2^8)
    const a = new Uint8Array([1, 1]) // x + 1
    const b = new Uint8Array([1, 2]) // x + 2
    const result = polyMul(a, b)
    expect(result.length).toBe(3)
    expect(result[0]).toBe(1) // x^2 coefficient
    expect(result[1]).toBe(add(2, 1)) // 2 XOR 1 = 3
    expect(result[2]).toBe(mul(1, 2)) // 2
  })
})
