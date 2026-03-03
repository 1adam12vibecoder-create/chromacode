/**
 * Reed-Solomon encoder/decoder over GF(2^8).
 *
 * Convention: codeword c[0..n-1] represents the polynomial
 *   c(x) = c[0]*x^{n-1} + c[1]*x^{n-2} + ... + c[n-1]*x^0
 *
 * Generator: g(x) = product of (x - alpha^i) for i = 0..ecCount-1
 * Encoding ensures c(alpha^i) = 0 for i = 0..ecCount-1 (systematic form).
 *
 * Position j in the array corresponds to power n-1-j.
 * Error locator for position j: X_j = alpha^{n-1-j}.
 */

import { EXP, LOG, add, mul, polyMul } from './gf256.js'

/**
 * Build generator polynomial.
 * g(x) = (x - alpha^0)(x - alpha^1)...(x - alpha^{ecSymbols-1})
 * Stored highest-degree first.
 */
export function generatorPoly(ecSymbols: number): Uint8Array {
  let g: Uint8Array<ArrayBufferLike> = new Uint8Array([1])
  for (let i = 0; i < ecSymbols; i++) {
    g = polyMul(g, new Uint8Array([1, EXP[i]]))
  }
  return g
}

/**
 * Encode: append EC symbols to data. Returns [...data, ...ec].
 */
export function rsEncode(data: Uint8Array, ecCount: number): Uint8Array {
  const gen = generatorPoly(ecCount)
  const result = new Uint8Array(data.length + ecCount)
  result.set(data)

  const feedback = new Uint8Array(ecCount)
  for (let i = 0; i < data.length; i++) {
    const coeff = add(data[i], feedback[0])
    feedback.copyWithin(0, 1)
    feedback[ecCount - 1] = 0
    if (coeff !== 0) {
      for (let j = 0; j < ecCount; j++) {
        feedback[j] = add(feedback[j], mul(coeff, gen[j + 1]))
      }
    }
  }

  result.set(feedback, data.length)
  return result
}

/**
 * Compute syndromes: S_i = r(alpha^i) via Horner's.
 * For a valid codeword, all syndromes are 0.
 */
function computeSyndromes(received: Uint8Array, ecCount: number): number[] {
  const synd: number[] = new Array(ecCount)
  for (let i = 0; i < ecCount; i++) {
    const a = EXP[i]
    let val = 0
    for (let j = 0; j < received.length; j++) {
      val = add(mul(val, a), received[j])
    }
    synd[i] = val
  }
  return synd
}

/**
 * Berlekamp-Massey: find error locator polynomial Lambda(x).
 * Lambda(x) = 1 + L1*x + L2*x^2 + ...
 * Stored as: lambda[i] = coefficient of x^i (lambda[0] = 1).
 */
function berlekampMassey(synd: number[], ecCount: number): number[] {
  const C = [1] // current LFSR
  let B = [1] // previous LFSR
  let L = 0 // current length
  let m = 1 // step since last length change
  let b = 1 // previous discrepancy

  for (let n = 0; n < ecCount; n++) {
    // Discrepancy
    let d = synd[n]
    for (let i = 1; i < C.length; i++) {
      d = add(d, mul(C[i], synd[n - i]))
    }

    if (d === 0) {
      m++
      continue
    }

    const T = C.slice()
    const coeff = mul(d, EXP[(255 - LOG[b]) % 255]) // d * b^{-1}

    // C = C + coeff * x^m * B
    const needed = B.length + m
    while (C.length < needed) C.push(0)
    for (let i = 0; i < B.length; i++) {
      C[i + m] = add(C[i + m], mul(coeff, B[i]))
    }

    if (2 * L <= n) {
      L = n + 1 - L
      B = T
      b = d
      m = 1
    } else {
      m++
    }
  }

  return C
}

/**
 * Chien search: find error positions.
 *
 * For position p in array (0-indexed), X_p = alpha^{n-1-p}.
 * Lambda has root at X_p^{-1} = alpha^{-(n-1-p)} = alpha^{(p-n+1) mod 255}.
 * We check each candidate p = 0..n-1.
 */
function chienSearch(lambda: number[], n: number): number[] {
  const positions: number[] = []
  const degree = lambda.length - 1

  for (let p = 0; p < n; p++) {
    // Compute x = X_p^{-1} = alpha^{p - n + 1} mod 255
    const exp = (((p - n + 1) % 255) + 255) % 255
    const x = exp === 0 ? 1 : EXP[exp]

    // Evaluate Lambda(x)
    let val = lambda[0] // = 1
    let xPow = 1
    for (let j = 1; j < lambda.length; j++) {
      xPow = mul(xPow, x)
      val = add(val, mul(lambda[j], xPow))
    }

    if (val === 0) {
      positions.push(p)
    }
  }

  if (positions.length !== degree) {
    throw new Error(
      `Chien search found ${positions.length} roots but expected ${degree} — uncorrectable errors`,
    )
  }
  return positions
}

/**
 * Forney's algorithm: compute error magnitudes.
 *
 * Omega(x) = Lambda(x) * S(x) mod x^{ecCount}
 * where S(x) = S_0 + S_1*x + ... + S_{ecCount-1}*x^{ecCount-1}
 *
 * For position p: X_p = alpha^{n-1-p}, X_p^{-1} = alpha^{(p-n+1) mod 255}
 * e_p = X_p * Omega(X_p^{-1}) / Lambda'(X_p^{-1})
 */
function forney(
  synd: number[],
  lambda: number[],
  positions: number[],
  n: number,
  ecCount: number,
): number[] {
  // Omega(x) = Lambda(x) * S(x) mod x^ecCount
  const omega: number[] = new Array(ecCount).fill(0)
  for (let i = 0; i < ecCount; i++) {
    for (let j = 0; j < lambda.length && j <= i; j++) {
      omega[i] = add(omega[i], mul(lambda[j], synd[i - j]))
    }
  }

  // Lambda'(x): formal derivative
  // In GF(2), d/dx [c_j * x^j] = c_j * x^{j-1} if j odd, 0 if j even
  const lp: number[] = []
  for (let j = 1; j < lambda.length; j += 2) {
    while (lp.length < j) lp.push(0)
    lp[j - 1] = lambda[j]
  }
  if (lp.length === 0) lp.push(0)

  const magnitudes: number[] = new Array(positions.length)
  for (let k = 0; k < positions.length; k++) {
    const p = positions[k]

    // X_p = alpha^{n-1-p}
    const xpExp = (n - 1 - p) % 255
    const Xp = xpExp === 0 ? 1 : EXP[xpExp]

    // X_p^{-1}
    const xpInvExp = (((p - n + 1) % 255) + 255) % 255
    const XpInv = xpInvExp === 0 ? 1 : EXP[xpInvExp]

    // Evaluate Omega(XpInv)
    let omegaVal = 0
    let xPow = 1
    for (let i = 0; i < omega.length; i++) {
      omegaVal = add(omegaVal, mul(omega[i], xPow))
      xPow = mul(xPow, XpInv)
    }

    // Evaluate Lambda'(XpInv)
    let lpVal = 0
    xPow = 1
    for (let i = 0; i < lp.length; i++) {
      lpVal = add(lpVal, mul(lp[i] || 0, xPow))
      xPow = mul(xPow, XpInv)
    }

    if (lpVal === 0) {
      throw new Error('Forney: lambda prime evaluates to zero — uncorrectable')
    }

    // e_p = Xp * Omega(XpInv) / Lambda'(XpInv)
    magnitudes[k] = mul(Xp, mul(omegaVal, EXP[(255 - LOG[lpVal]) % 255]))
  }

  return magnitudes
}

/**
 * Decode a Reed-Solomon codeword, correcting errors.
 * Returns corrected data (without EC symbols).
 */
export function rsDecode(received: Uint8Array, ecCount: number): Uint8Array {
  const n = received.length
  const dataLen = n - ecCount

  const synd = computeSyndromes(received, ecCount)

  if (synd.every((s) => s === 0)) {
    return received.slice(0, dataLen)
  }

  const lambda = berlekampMassey(synd, ecCount)
  const numErrors = lambda.length - 1

  if (numErrors === 0) {
    throw new Error('BM found no errors but syndromes non-zero')
  }
  if (numErrors > Math.floor(ecCount / 2)) {
    throw new Error(
      `Too many errors (${numErrors}) for EC capacity (max ${Math.floor(ecCount / 2)})`,
    )
  }

  const positions = chienSearch(lambda, n)
  const magnitudes = forney(synd, lambda, positions, n, ecCount)

  const corrected = new Uint8Array(received)
  for (let i = 0; i < positions.length; i++) {
    corrected[positions[i]] = add(corrected[positions[i]], magnitudes[i])
  }

  // Verify
  const checkSynd = computeSyndromes(corrected, ecCount)
  if (!checkSynd.every((s) => s === 0)) {
    throw new Error('Reed-Solomon correction failed verification')
  }

  return corrected.slice(0, dataLen)
}

/**
 * Calculate EC symbol count for a given data length and EC ratio.
 */
export function ecSymbolCount(dataLen: number, ecRatio: number): number {
  const ec = Math.ceil((dataLen * ecRatio) / (1 - ecRatio))
  return Math.max(2, ec)
}
