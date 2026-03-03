/**
 * GF(2^8) finite field arithmetic.
 * Primitive polynomial: 0x11d (x^8 + x^4 + x^3 + x^2 + 1)
 * Same as QR codes and AES.
 */

/** Exponentiation table: exp[i] = alpha^i in GF(2^8) */
export const EXP = new Uint8Array(512)

/** Logarithm table: log[x] = i where alpha^i = x (log[0] is undefined) */
export const LOG = new Uint8Array(256)

// Build tables
let x = 1
for (let i = 0; i < 255; i++) {
  EXP[i] = x
  LOG[x] = i
  x = x << 1
  if (x & 0x100) {
    x ^= 0x11d
  }
}
// Extend exp table for convenience (avoid modular reduction in multiply)
for (let i = 255; i < 512; i++) {
  EXP[i] = EXP[i - 255]
}

/** Addition in GF(2^8) is XOR */
export function add(a: number, b: number): number {
  return a ^ b
}

/** Subtraction in GF(2^8) is also XOR (same as addition) */
export const sub = add

/** Multiply two elements in GF(2^8) */
export function mul(a: number, b: number): number {
  if (a === 0 || b === 0) return 0
  return EXP[LOG[a] + LOG[b]]
}

/** Divide a by b in GF(2^8). b must not be 0. */
export function div(a: number, b: number): number {
  if (b === 0) throw new Error('Division by zero in GF(2^8)')
  if (a === 0) return 0
  return EXP[(LOG[a] + 255 - LOG[b]) % 255]
}

/** Multiplicative inverse: a^(-1) in GF(2^8) */
export function inverse(a: number): number {
  if (a === 0) throw new Error('Zero has no inverse in GF(2^8)')
  return EXP[255 - LOG[a]]
}

/** Raise a to power n in GF(2^8) */
export function pow(a: number, n: number): number {
  if (a === 0) return n === 0 ? 1 : 0
  return EXP[(LOG[a] * n) % 255]
}

/**
 * Evaluate polynomial at x.
 * poly[0] is highest degree coefficient.
 */
export function polyEval(poly: Uint8Array, x: number): number {
  if (x === 0) return poly[poly.length - 1]
  let result = poly[0]
  for (let i = 1; i < poly.length; i++) {
    result = add(mul(result, x), poly[i])
  }
  return result
}

/**
 * Multiply two polynomials in GF(2^8).
 * Coefficients: index 0 = highest degree.
 */
export function polyMul(a: Uint8Array, b: Uint8Array): Uint8Array {
  const result = new Uint8Array(a.length + b.length - 1)
  for (let i = 0; i < a.length; i++) {
    for (let j = 0; j < b.length; j++) {
      result[i + j] = add(result[i + j], mul(a[i], b[j]))
    }
  }
  return result
}
