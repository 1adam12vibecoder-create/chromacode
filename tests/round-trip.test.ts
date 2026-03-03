import { describe, it, expect } from 'vitest'
import { encode, decode } from '../src/index.js'

function randomData(length: number, seed: number = 42): Uint8Array {
  const data = new Uint8Array(length)
  let s = seed
  for (let i = 0; i < length; i++) {
    s = (s * 1103515245 + 12345) & 0x7fffffff
    data[i] = s & 0xff
  }
  return data
}

describe('round-trip: encode → decode', () => {
  it('empty data', () => {
    const data = new Uint8Array(0)
    const png = encode(data)
    const result = decode(png)
    expect(result).toEqual(data)
  })

  it('single byte', () => {
    const data = new Uint8Array([42])
    const png = encode(data)
    const result = decode(png)
    expect(result).toEqual(data)
  })

  it('100 bytes (rgba64, default)', () => {
    const data = randomData(100)
    const png = encode(data)
    const result = decode(png)
    expect(result).toEqual(data)
  })

  it('1000 bytes', () => {
    const data = randomData(1000)
    const png = encode(data)
    const result = decode(png)
    expect(result).toEqual(data)
  })

  it('5000 bytes', () => {
    const data = randomData(5000)
    const png = encode(data)
    const result = decode(png)
    expect(result).toEqual(data)
  })

  it('rgba32 mode', () => {
    const data = randomData(500)
    const png = encode(data, { mode: 'rgba32' })
    const result = decode(png)
    expect(result).toEqual(data)
  })

  it('rgb48 mode', () => {
    const data = randomData(500)
    const png = encode(data, { mode: 'rgb48' })
    const result = decode(png)
    expect(result).toEqual(data)
  })

  it('rgb24 mode', () => {
    const data = randomData(500)
    const png = encode(data, { mode: 'rgb24' })
    const result = decode(png)
    expect(result).toEqual(data)
  })

  it('with EC level M', () => {
    const data = randomData(500)
    const png = encode(data, { ecLevel: 'M' })
    const result = decode(png)
    expect(result).toEqual(data)
  })

  it('with EC level Q', () => {
    const data = randomData(200)
    const png = encode(data, { ecLevel: 'Q' })
    const result = decode(png)
    expect(result).toEqual(data)
  })

  it('with EC level H', () => {
    const data = randomData(200)
    const png = encode(data, { ecLevel: 'H' })
    const result = decode(png)
    expect(result).toEqual(data)
  })

  it('cellSize 2', () => {
    const data = randomData(200)
    const png = encode(data, { cellSize: 2 })
    const result = decode(png)
    expect(result).toEqual(data)
  })

  it('cellSize 3', () => {
    const data = randomData(100)
    const png = encode(data, { cellSize: 3 })
    const result = decode(png)
    expect(result).toEqual(data)
  })

  it('with compression', () => {
    // Highly compressible data (repeated pattern)
    const data = new Uint8Array(1000)
    for (let i = 0; i < 1000; i++) data[i] = i % 4
    const png = encode(data, { compress: true })
    const result = decode(png)
    expect(result).toEqual(data)
  })

  it('3100 bytes (SignNada 10-signer payload)', () => {
    const data = randomData(3100)
    const png = encode(data)
    const result = decode(png)
    expect(result).toEqual(data)
  })

  it('10000 bytes', () => {
    const data = randomData(10000)
    const png = encode(data)
    const result = decode(png)
    expect(result).toEqual(data)
  })
})
